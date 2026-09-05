"""Pinned export kernels, numerical normalization, and fail-closed CPU parity verification."""
import argparse
import copy
import json
import sys
from pathlib import Path


def normalize_decoder_rank(path):
    import onnx

    model = onnx.load(path)
    nodes = {node.name: node for node in model.graph.node}
    sigmoid = nodes.get("/mask_decoder/iou_prediction_head/Sigmoid")
    sliced = nodes.get("/mask_decoder/Slice_8")
    rank = nodes.get("/mask_decoder/ArgMax")
    if (sigmoid is None or sliced is None or rank is None
            or sigmoid.op_type != "Sigmoid" or sliced.op_type != "Slice" or rank.op_type != "ArgMax"
            or len(sigmoid.input) != 1 or len(sliced.input) != 5
            or sliced.input[0] != sigmoid.output[0] or list(rank.input) != [sliced.output[0]]
            or {a.name: a.i for a in rank.attribute} != {"axis": -1, "keepdims": 0, "select_last_index": 0}
            or sum(node.op_type == "ArgMax" for node in model.graph.node) != 1):
        raise ValueError("Pinned decoder IoU ranking topology changed")
    # Sigmoid is strictly monotonic. Rank logits before the CPU kernel rounds tiny probabilities to ties.
    # Keep the probability branch untouched, including the existing first-index tie rule.
    logits = copy.deepcopy(sliced)
    logits.name = "photoctl_iou_rank_logits"
    logits.input[0] = sigmoid.input[0]
    logits.output[0] = "photoctl_iou_rank_logits_output"
    rank.input[0] = logits.output[0]
    index = next(i for i, node in enumerate(model.graph.node) if node.name == rank.name)
    model.graph.node.insert(index, logits)
    onnx.checker.check_model(model)
    onnx.save(model, path)


def verify_pair(model, encoder_path, decoder_path):
    import torch
    import onnxruntime
    from image_encoder import SAM2ImageEncoder
    from image_decoder import SAM2ImageDecoder
    from sam2_utils import compare_tensors_with_tolerance

    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    encoder = onnxruntime.InferenceSession(str(encoder_path), options, providers=["CPUExecutionProvider"])
    decoder = onnxruntime.InferenceSession(str(decoder_path), options, providers=["CPUExecutionProvider"])
    records = []

    def compare(name, expected, actual, mismatch_limit=0.1):
        actual = torch.from_numpy(actual).float()
        expected = expected.float()
        if (not torch.isfinite(expected).all() or not torch.isfinite(actual).all()
                or not compare_tensors_with_tolerance(name, expected, actual,
                                                     mismatch_percentage_tolerance=mismatch_limit)):
            raise ValueError(f"SAM export parity failed: {name}")
        difference = (expected - actual).abs()
        mismatches = difference > (5e-3 + 1e-4 * torch.maximum(expected.abs(), actual.abs()))
        records.append({"output": name, "max_abs_error": float(difference.max()),
                        "mismatch_percentage": float(mismatches.float().mean() * 100),
                        "allowed_mismatch_percentage": mismatch_limit})

    with torch.no_grad():
        torch.manual_seed(0)
        image = torch.randn(1, 3, 1024, 1024)
        expected_features = SAM2ImageEncoder(model)(image)
        actual_features = encoder.run(None, {"image": image.numpy()})
        for output, expected, actual in zip(encoder.get_outputs(), expected_features, actual_features, strict=True):
            compare(output.name, expected, actual, mismatch_limit=1)
        coordinates = torch.randint(0, 1024, (1, 5, 2), dtype=torch.float32)
        cases = [
            ("negative-seed0", coordinates, torch.zeros((1, 5), dtype=torch.int32)),
            ("positive", torch.tensor([[[512., 512.]]]), torch.ones((1, 1), dtype=torch.int32)),
            ("box", torch.tensor([[[128., 128.], [768., 768.]]]), torch.tensor([[2, 3]], dtype=torch.int32)),
        ]
        reference = SAM2ImageDecoder(model, multimask_output=False, dynamic_multimask_via_stability=True)
        for case, points, labels in cases:
            inputs = (*expected_features, points, labels, torch.zeros(1, 1, 256, 256),
                      torch.zeros(1), torch.tensor([1500, 1500], dtype=torch.int32))
            expected_outputs = reference(*inputs)
            isolated_inputs = tuple(value.numpy() for value in inputs)
            composed_inputs = (*actual_features, *isolated_inputs[len(expected_features):])
            for name, decoder_inputs in [(case, isolated_inputs), (f"end-to-end/{case}", composed_inputs)]:
                actual_outputs = decoder.run(None, {entry.name: decoder_inputs[i] for i, entry in enumerate(decoder.get_inputs())})
                for output, expected, actual in zip(decoder.get_outputs(), expected_outputs, actual_outputs, strict=True):
                    compare(f"{name}/{output.name}", expected, actual)
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sam2-dir", type=Path, required=True)
    parser.add_argument("--exporter-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.exporter_dir))
    import torch
    from sam2_utils import load_sam2_model
    from image_encoder import export_image_encoder_onnx
    from image_decoder import export_decoder_onnx

    torch.set_num_threads(1)
    torch.manual_seed(0)
    model = load_sam2_model(str(args.sam2_dir), "sam2_hiera_small", device="cpu")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    encoder = args.output_dir / "sam2_hiera_small_image_encoder.onnx"
    decoder = args.output_dir / "sam2_hiera_small_image_decoder.onnx"
    with torch.no_grad():
        export_image_encoder_onnx(model, str(encoder))
        export_decoder_onnx(model, str(decoder))
        normalize_decoder_rank(decoder)
        records = verify_pair(model, encoder, decoder)
    (args.output_dir / "verification.json").write_text(json.dumps(records, indent=2) + "\n")
    print("SAM encoder and decoder passed CPU parity verification", flush=True)


if __name__ == "__main__":
    main()
