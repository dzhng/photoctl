# SAM export evidence

The release manifest pins real ONNX bytes, not a quality verdict. The checkpoint is publicly downloadable without credentials
from the [pinned Meta repository](https://huggingface.co/facebook/sam2.1-hiera-small/tree/ee5bba1d82bb8749febdf90f45e84b687142ba03).
Its 184,416,285 bytes hash to `6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38`.
The normalized graphs are approximately 132 MiB (encoder) and 16 MiB (decoder); exact release hashes belong to `fixtures/models.json`.
No model binaries are committed or publicly uploaded by this pass.

## Reproduction

Use Python 3.12 in an isolated environment and install `scripts/sam2-export-requirements.txt`. Clone the exact source revisions
printed by `python scripts/export-sam2.py --print-contract` into clean checkouts. Install that SAM checkout with
`SAM2_BUILD_CUDA=0 pip install --no-build-isolation --no-deps /path/to/sam2` after installing the requirements.
The [SAM installation contract](https://github.com/facebookresearch/sam2/blob/2b90b9f5ceec907a1c18123530e92e794ad901a4/INSTALL.md)
requires Torch 2.5.1 or newer and permits CPU-only installation; the
[pinned exporter](https://github.com/microsoft/onnxruntime/blob/3af6be475c8ce64d3fb0851706ec7e432ad2223c/onnxruntime/python/tools/transformers/models/sam2/README.md)
supports Python 3.10–3.12 and CPU export.

From the repository root, using the environment's Python:

```sh
HF_HUB_DISABLE_IMPLICIT_TOKEN=1 MPLBACKEND=Agg PYTHONDONTWRITEBYTECODE=1 python scripts/export-sam2.py \
  --sam2-dir /path/to/sam2 --onnxruntime-dir /path/to/onnxruntime --output-dir /path/to/new-candidate
python scripts/test-export-sam2.py --sam2-dir /path/to/sam2 --onnxruntime-dir /path/to/onnxruntime \
  --checkpoint /path/to/sam2.1_hiera_small.pt --config /path/to/sam2.1_hiera_s.yaml \
  --onnx-dir /path/to/new-candidate
```

The output directory must be new or empty; the exporter refuses to overwrite a nonempty candidate. It stages the complete
pair and report on the destination filesystem before one directory rename. Keep each candidate directory immutable once
shared with a runtime benchmark. The exporter emits `verification.json` beside
the graphs and updates both release manifests only after successful parity. A failed worker regression proves that existing
manifest bytes remain unchanged and no ONNX files are published. Missing-report and nonempty-destination regressions also
pin the publication boundary. The two metadata files live in separate directories and are not an atomic pair; if metadata
publication fails, rerun into another fresh candidate directory to regenerate both from the same verified release.
A local HTTP server can serve the pair to the existing
hash-verified model fetcher; public hosting is not a prerequisite for local runtime evidence.

## Numerical contract

The real installed SAM/Hydra regression first failed with unexpected SAM 2.1 checkpoint keys: the exporter's short config
name resolved to SAM 2.0 inside the installed package. The export subprocess now imports a private copy of the pinned source
with that config alias bound to the pinned SAM 2.1 config. Neither original checkout is modified.

The upstream converter can exit successfully after printing a parity failure. The worker instead checks the actual comparison
result and rejects non-finite outputs. Tolerances remain the upstream absolute `0.005`, relative `0.0001`, and mismatch
percentage limits: encoder less than 1%, decoder less than 0.1%.

Seed-zero noise with negative prompts exposed a second defect: tiny IoU probabilities rounded to the same value in ONNX's
CPU sigmoid, choosing a different mask (98.87% thresholded-mask mismatch; maximum low-resolution error 8.3891). Ranking
pre-sigmoid logits preserves the mathematical ordering of strictly monotonic sigmoid without introducing those artificial
ties. Only the pinned ranking path changes; probability outputs and first-index equal-logit ties remain unchanged. Unknown
graph topology fails closed. Actual ONNX runtime regressions cover saturation, equal logits, and ordinary scores.

The normalized real model passes seed-zero negative prompts plus positive-point and box prompts. All three encoder feature
outputs and all decoder logits have zero elements outside the original tolerance. Maximum low-resolution errors are
`0.0000123978`, `0.0000254810`, and `0.0000214577`, respectively. Positive and box thresholded outputs each differ by one
pixel out of 1500² (0.00004444%); negative output is exact. These random-input probes establish export parity, not whether
a photographed subject is correctly segmented.

The verifier also feeds actual ONNX encoder outputs into the decoder, while retaining the isolated decoder checks above.
Composed low-resolution errors are `0.0000185370`, `0.0000339746`, and `0.0000295639` for the same negative, positive,
and box cases, with zero logits outside the unchanged tolerance. Thresholded outputs differ by zero, two, and three pixels
out of 1500², respectively. A temporary encoder copy with alternating `±0.004` feature bias passes isolated encoder and
decoder checks but produces 17.67% out-of-tolerance composed negative-prompt logits. The regression first failed because
that error was accepted, then passed when composed verification rejected it. Frozen candidate graphs are never modified.

## Resource and acceptance boundary

Measured on Apple M5 Pro (18 CPU cores, 48 GiB RAM), Python 3.12.14, pinned CPU dependencies: the final staged export took
12.83 s and peaked at 3,001,057,280 bytes process RSS. Its graph hashes and release JSON exactly matched the preceding
normalized export. This is export-process memory, not the G6 inference budget. The isolated
environment, source checkouts, and checkpoint need roughly 1–1.5 GB plus generated graphs and temporary copies.

Native production tensor compatibility, multi-photo encoder-cache memory, image-derived click/area bands, and hair/foliage
inspection remain independent gates. No photographic quality, G6 success, or public distribution acceptance is claimed here.
