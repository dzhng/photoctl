#!/usr/bin/env python3
"""Explicit installed-package regression; requires the pinned SAM export environment and checkpoint."""
import argparse
import importlib.util
import subprocess
import sys
import tempfile
import shutil
from pathlib import Path
import onnx
import onnxruntime
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument("--sam2-dir", type=Path, required=True)
parser.add_argument("--onnxruntime-dir", type=Path, required=True)
parser.add_argument("--checkpoint", type=Path, required=True)
parser.add_argument("--config", type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("export_sam2", Path(__file__).with_name("export-sam2.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
exporter.checkout(args.sam2_dir, exporter.SAM2_REVISION, "SAM 2")
exporter.checkout(args.onnxruntime_dir, exporter.ONNXRUNTIME_REVISION, "ONNX Runtime")
with tempfile.TemporaryDirectory(prefix="photoctl-sam-config-test-") as directory:
    shadow = Path(directory) / "sam2"
    environment = exporter.prepare_source_tree(args.sam2_dir, shadow, args.checkpoint, args.config)
    converter = args.onnxruntime_dir / "onnxruntime/python/tools/transformers/models/sam2"
    # The pinned external loader imports SAM before examining --sam2_dir. Exercise that actual order.
    probe = "from sam2_utils import load_sam2_model; import sys; load_sam2_model(sys.argv[1], 'sam2_hiera_small', device='cpu')"
    subprocess.run([sys.executable, "-c", probe, str(shadow)], cwd=converter, env=environment, check=True)
print("Pinned SAM 2.1 checkpoint loads through the export subprocess environment")

spec = importlib.util.spec_from_file_location("sam2_runtime", Path(__file__).with_name("sam2-export-runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
with tempfile.TemporaryDirectory(prefix="photoctl-sam-rank-test-") as directory:
    path = Path(directory) / "rank.onnx"
    nodes = [onnx.helper.make_node("Sigmoid", ["logits"], ["probability"], name="/mask_decoder/iou_prediction_head/Sigmoid")]
    constants = {"start": [1], "end": [4], "axis": [-1], "step": [1]}
    for name, value in constants.items():
        nodes.append(onnx.helper.make_node("Constant", [], [name], value=onnx.helper.make_tensor(name, onnx.TensorProto.INT64, [1], value)))
    nodes.extend([
        onnx.helper.make_node("Slice", ["probability", *constants], ["candidates"], name="/mask_decoder/Slice_8"),
        onnx.helper.make_node("ArgMax", ["candidates"], ["index"], name="/mask_decoder/ArgMax", axis=-1, keepdims=0, select_last_index=0),
    ])
    graph = onnx.helper.make_graph(nodes, "rank", [onnx.helper.make_tensor_value_info("logits", onnx.TensorProto.FLOAT, [1, 4])],
        [onnx.helper.make_tensor_value_info("index", onnx.TensorProto.INT64, [1]), onnx.helper.make_tensor_value_info("probability", onnx.TensorProto.FLOAT, [1, 4])])
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 16)], ir_version=8)
    onnx.save(model, path)
    before = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    runtime.normalize_decoder_rank(path)
    after = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    for values, expected in [([-5., -32., -28., -25.], 2), ([-5., -28., -28., -30.], 0), ([-5., 2., 4., 3.], 1)]:
        feed = {"logits": np.array([values], dtype=np.float32)}
        old_index, old_probabilities = before.run(None, feed)
        index, probabilities = after.run(None, feed)
        if values == [-5., -32., -28., -25.]:
            assert old_index.tolist() == [0], old_index
        assert index.tolist() == [expected], (values, index)
        assert np.array_equal(probabilities, old_probabilities)
    normalized = path.read_bytes()
    try:
        runtime.normalize_decoder_rank(path)
    except ValueError as error:
        assert "topology changed" in str(error)
    else:
        raise AssertionError("Unknown ranking topology must fail closed")
    assert path.read_bytes() == normalized
    print("IoU ranking preserves equal-score ties and probability outputs without saturation ties")

with tempfile.TemporaryDirectory(prefix="photoctl-sam-publication-test-") as directory:
    root = Path(directory)
    script = root / "export-sam2.py"
    shutil.copy2(Path(__file__).with_name("export-sam2.py"), script)
    # Substitute external download and worker boundaries; SAM/Hydra above remains the real installed package.
    (root / "huggingface_hub.py").write_text(
        "def hf_hub_download(repository, filename, revision):\n"
        f"    return {str(args.checkpoint)!r} if filename.endswith('.pt') else {str(args.config)!r}\n"
    )
    (root / "sam2-export-runtime.py").write_text("raise ValueError('SAM export parity failed: negative-seed0/low_res_masks')\n")
    manifest, generated = root / "models.json", root / "manifest.ts"
    manifest.write_text("previous release\n")
    generated.write_text("previous runtime\n")
    command = [sys.executable, str(script), "--sam2-dir", str(args.sam2_dir),
        "--onnxruntime-dir", str(args.onnxruntime_dir), "--output-dir", str(root / "output"),
        "--manifest", str(manifest), "--runtime-manifest", str(generated)]
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode != 0 and "SAM export parity failed" in result.stderr, result.stderr
    assert manifest.read_text() == "previous release\n"
    assert generated.read_text() == "previous runtime\n"
    assert not list((root / "output").glob("*.onnx"))
    print("A failed parity worker cannot replace either release manifest or publish model files")

    (root / "sam2-export-runtime.py").write_text('''import sys, onnx
from pathlib import Path
output = Path(sys.argv[sys.argv.index('--output-dir') + 1])
output.mkdir(parents=True)
for component, opset in [('image_encoder', 17), ('image_decoder', 16)]:
    info = lambda name: onnx.helper.make_tensor_value_info(name, onnx.TensorProto.FLOAT, [1])
    graph = onnx.helper.make_graph([onnx.helper.make_node('Identity', ['x'], ['y'])], 'fixture', [info('x')], [info('y')])
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid('', opset)])
    onnx.save(model, output / f'sam2_hiera_small_{component}.onnx')
''')
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode != 0 and "verification.json" in result.stderr, result.stderr
    assert not list((root / "output").glob("*.onnx")), "Incomplete evidence published model files"
    assert manifest.read_text() == "previous release\n"
    assert generated.read_text() == "previous runtime\n"
    print("Missing verification evidence cannot publish either model file")

    (root / "output" / "encoder.onnx").write_bytes(b"immutable candidate")
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode != 0 and "new or empty" in result.stderr, result.stderr
    assert (root / "output" / "encoder.onnx").read_bytes() == b"immutable candidate"
    print("Nonempty candidates cannot be overwritten")
