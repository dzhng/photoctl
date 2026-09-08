#!/usr/bin/env python3
"""Export photoctl's SAM 2.1 pair from immutable upstream revisions."""

import argparse, hashlib, json, os, shutil, subprocess, sys, tempfile
from pathlib import Path

MODEL_REPOSITORY = "facebook/sam2.1-hiera-small"
MODEL_REVISION = "ee5bba1d82bb8749febdf90f45e84b687142ba03"
SAM2_REVISION = "2b90b9f5ceec907a1c18123530e92e794ad901a4"
ONNXRUNTIME_REVISION = "3af6be475c8ce64d3fb0851706ec7e432ad2223c"
MODEL_TYPE = "sam2_hiera_small"


def contract():
    return {"schema": 1, "model": {"repository": MODEL_REPOSITORY, "revision": MODEL_REVISION},
            "sam2_revision": SAM2_REVISION, "onnxruntime_revision": ONNXRUNTIME_REVISION,
            "artifacts": [{"file": "encoder.onnx", "opset": 17},
                          {"file": "decoder.onnx", "opset": 16}]}


def checkout(path, revision, label):
    actual = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if actual != revision:
        raise SystemExit(f"{label} checkout must be {revision}; received {actual}")
    dirty = subprocess.check_output(
        ["git", "-C", str(path), "status", "--porcelain", "--untracked-files=all"], text=True
    ).strip()
    if dirty:
        raise SystemExit(f"{label} checkout must be clean")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def prepare_source_tree(source, destination, checkpoint, config):
    shutil.copytree(source, destination, symlinks=True)
    (destination / "checkpoints").mkdir(exist_ok=True)
    (destination / "sam2_configs").mkdir(exist_ok=True)
    shutil.copy2(checkpoint, destination / "checkpoints/sam2_hiera_small.pt")
    # The exporter uses a SAM 2.0 short name; Hydra resolves it inside the SAM package.
    config_alias = destination / "sam2/sam2_hiera_s.yaml"
    config_alias.unlink()
    shutil.copy2(config, config_alias)
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join(
        [str(destination.resolve()), environment.get("PYTHONPATH", "")]
    )
    return environment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--print-contract", action="store_true")
    parser.add_argument("--sam2-dir", type=Path)
    parser.add_argument("--onnxruntime-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--manifest", type=Path, default=Path("fixtures/models.json"))
    parser.add_argument("--runtime-manifest", type=Path, default=Path("packages/library/src/generated-model-manifest.ts"))
    args = parser.parse_args()
    if args.print_contract:
        print(json.dumps(contract(), sort_keys=True))
        return
    if not args.sam2_dir or not args.onnxruntime_dir or not args.output_dir:
        raise SystemExit("--sam2-dir, --onnxruntime-dir, and --output-dir are required")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise SystemExit("--output-dir must be new or empty; model candidates are immutable")
    checkout(args.sam2_dir, SAM2_REVISION, "SAM 2")
    checkout(args.onnxruntime_dir, ONNXRUNTIME_REVISION, "ONNX Runtime")
    try:
        import onnx
        from huggingface_hub import hf_hub_download
    except ImportError as error:
        raise SystemExit("export requires onnx and huggingface_hub") from error
    checkpoint = Path(hf_hub_download(MODEL_REPOSITORY, "sam2.1_hiera_small.pt", revision=MODEL_REVISION))
    config = Path(hf_hub_download(MODEL_REPOSITORY, "sam2.1_hiera_s.yaml", revision=MODEL_REVISION))
    converter = args.onnxruntime_dir / "onnxruntime/python/tools/transformers/models/sam2/convert_to_onnx.py"
    if not converter.is_file():
        raise SystemExit(f"missing pinned exporter: {converter}")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="photoctl-sam2-") as temporary:
        shadow, raw = Path(temporary) / "sam2", Path(temporary) / "onnx"
        environment = prepare_source_tree(args.sam2_dir, shadow, checkpoint, config)
        subprocess.run([sys.executable, str(Path(__file__).with_name("sam2-export-runtime.py").resolve()),
                        "--exporter-dir", str(converter.parent.resolve()), "--output-dir", str(raw),
                        "--sam2-dir", str(shadow)], cwd=converter.parent, env=environment, check=True)
        inputs = {"encoder.onnx": raw / f"{MODEL_TYPE}_image_encoder.onnx",
                  "decoder.onnx": raw / f"{MODEL_TYPE}_image_decoder.onnx"}
        expected = {item["file"]: item["opset"] for item in contract()["artifacts"]}
        artifacts = []
        with tempfile.TemporaryDirectory(prefix=".sam-candidate-", dir=args.output_dir.parent) as pending:
            staged = Path(pending) / "candidate"
            staged.mkdir()
            for name, source in inputs.items():
                model = onnx.load(source, load_external_data=False)
                opset = max(item.version for item in model.opset_import if item.domain in ("", "ai.onnx"))
                if opset != expected[name]:
                    raise SystemExit(f"unexpected {name} opset {opset}; expected {expected[name]}")
                destination = staged / name
                shutil.copy2(source, destination)
                artifacts.append({"file": name, "sha256": digest(destination), "opset": opset})
            shutil.copy2(raw / "verification.json", staged / "verification.json")
            os.replace(staged, args.output_dir)
    release = {"schema": 1,
               "source": {"repository": MODEL_REPOSITORY, "revision": MODEL_REVISION},
               "artifacts": artifacts}
    pending = args.manifest.with_suffix(args.manifest.suffix + ".tmp")
    pending.write_text(json.dumps(release, indent=2) + "\n")
    os.replace(pending, args.manifest)
    generated = ("import type { ModelManifest } from \"./models.js\";\n\n"
                 "// Generated by scripts/export-sam2.py after a real export; never hand-fill hashes.\n"
                 "export const PINNED_MODEL_RELEASE: ModelManifest = "
                 + json.dumps(release, indent=2) + ";\n")
    pending_runtime = args.runtime_manifest.with_suffix(args.runtime_manifest.suffix + ".tmp")
    pending_runtime.write_text(generated)
    os.replace(pending_runtime, args.runtime_manifest)


if __name__ == "__main__":
    main()
