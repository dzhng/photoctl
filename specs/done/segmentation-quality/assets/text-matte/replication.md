# Complete CPU text-matting replication

The [official TeachDiffusionMatting implementation](https://github.com/xty435768/TeachDiffusionMatting)
is pinned at `91dfed6c6b1344c05a3388ff6095d86b98c66b1d`. The
[runner](run_portrait.py) preserves default SD 2.1 configuration, checkpoint-defined
student architecture, 512-square image input, 40 text tokens, VAE mode, original
preprocessing/composition and the complete two-scale high-resolution refiner.
The published long-edge cap remains 2048. Native landscape alpha is 2048×1365;
bilinear projection to the original photograph is for comparison only.

## Model provenance

ModelScope repository `cstyxiang/TeachDiffusionMatting`, revision
`8d7b7cd87b9b79dd74681f2fe97d8df77b7e8189`, was accessed through its official
international endpoint. Downloaded files were hashed against the pinned LFS
metadata before loading:

- `sd21_student_best.pth`: 1,735,533,978 bytes;
  SHA-256 `405b438868a2e8f6b5454206b024f2bda0f0b70fc89b48a0b71edb8aada044f2`.
- `sd2x_vae.pth`: 334,693,857 bytes;
  SHA-256 `dc74dadba55c8c153a99734ea331a4f179f73e4cd5caa4ee47ff430f441bfca3`.
- Language encoder `laion/CLIP-ViT-H-14-laion2B-s32B-b79K`, revision
  `1c2b8495b28150b8a4922ee1c8edee224c284c0c`: `model.safetensors`,
  3,944,552,236 bytes;
  SHA-256 `036e6e2bd49697511f4f8b8cb5ee465f93025f7a69a145eadeb9a881ace9b18d`.

Student, decoder and VAE loads were strict with no missing or unexpected keys.
CLIP's text module had no missing/mismatched keys; unused vision/projection keys
from the combined checkpoint are listed in each run report. Loading used
`weights_only=True`, with a narrow allowlist for checkpoint configuration types.
Model weights and tensor fixtures containing weights are not included here.
The ModelScope card's Apache-2.0 declaration does not resolve the source
repository's missing project-level license or upstream obligations.

## Sparse backend boundary

macOS lacks the required sparse library. The scratch
[dense backend](sparse-port/dense_refiner.py) retains active-site topology
independently of feature values, expands support under ordinary sparse
convolution, masks bias, and applies normalization only to active feature rows.
The original refiner's interpolation, morphology, composition and empty exits
are unchanged. Its byte-identical source copy has SHA-256
`07e80274efdf1eb7f9db82b786fc17429c4c500c7a9284168024c6fa12986caa`.

The [differential tests](sparse-port/test_equivalence.py) compare with unmodified
spconv 2.3.8 on Torch 2.3.0 CPU, including odd dimensions above the scale switch,
both refinement stages, empty exits, normalization offsets, mixed empty batches
and actual checkpoint tensors. The [recorded run](sparse-port/equivalence-run.log)
passes seven tests. The [Mac check](sparse-port/verify_mac.py) compares native
Torch 2.8.0 execution against exported original-library outputs and intermediate
features at FP32 tolerances of 1e-5 absolute/relative.

The Linux CPU reference uses one Torch thread: two-thread runs showed varying
few-pixel errors, whereas one-thread runs agreed. This isolates a runtime
sensitivity, not its underlying library/emulation cause. Only sparse convolutions
use spconv's training execution route because its CPU eval route cannot fuse
bias; batch normalization remains in evaluation mode. Disposable containers have
bounded CPU/memory, no network during tests, and mount only the scratch test
directory, not home directories or credentials.

## End-to-end fidelity check

The separate [code review](fidelity-review.log) found no confirmed fidelity defect
but correctly noted that synthetic refiner tests do not prove the whole harness.
The [upstream-entry check](verify_upstream_entry.py) therefore runs the original
entry point with only CPU placement, local checkpoint paths and safe loading
adaptations. All five outputs exactly match the harness on the explicit hair
portrait; [maximum differences are zero](upstream-entry-comparison.json).

That comparison shares the dense sparse backend, so it is not sufficient alone.
The actual image-derived refinement inputs were then passed through the
unmodified original spconv implementation. The
[real-portrait comparison](sparse-port/real-portrait-comparison.json) has identical
refinement masks and maximum alpha errors below 9e-7 at both scales. Together
these checks validate the altered execution boundaries on this portrait. They
do not claim bit-identical CUDA execution or independent end-to-end verification
of every holdout.

## Measurements and retained artifacts

All runs used CPU FP32, four Torch threads and the same model configuration.
These are single measurements, not performance distributions. JSON reports own
the detailed timings, source paths and runtime settings.

| Prompt | Forward seconds | Peak RSS, decimal GB |
| --- | ---: | ---: |
| `hair` | 4.607 | 8.33 |
| `the woman's curly hair` | 4.008 | 8.54 |
| `person` | 4.266 | 9.43 |
| `sky` | 5.457 | 9.45 |
| `road` | 5.462 | 9.55 |

The portrait folders and `holdouts/` retain all five native floating outputs and
their PNG representations. The review folders retain full images and every
feature crop. Scripts/logs are frozen research evidence, not production modules;
their absolute scratch paths identify the run environment and are not a portable
installer. The [visual verdict](critique.md) governs candidate acceptance.
