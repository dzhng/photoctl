# One SAM3Matting hair refinement experiment

The corrected attempt completed on CPU and produced a finite 1614×1080 continuous alpha. This establishes execution of the released trained SAM3 matting variant, not visual quality or product eligibility. No semantic segmentation was rerun. Parent review owns captures and independent visual critique; `review/` is reserved for that work.

## Frozen inputs and model

- Upstream source: FudanCVL/SAM2Matting revision `73dd721d77b56749248aefe5e8824d7f61b9d13c`, copied through a local clone into this new scratch. Existing SAM3/Tiny source and environments were not modified.
- Model: `FudanCVL/SAM2Matting` revision `4315db9c60d27fde396b09765748a0ca6c97bed5`, only `checkpoints/SAM2Matting-SAM3.pt` acquired with `hf download` into `model/`.
- Verified size: 3,509,720,141 bytes. Verified SHA-256: `7102d695be6070b39acd67464f93207df725514a688b545ed1267d913d3b9c7d`.
- Original source: `/private/tmp/openphoto-dxo-source.vH8WZH/source-t14_5.png`, SHA-256 `052ecfc6d93c615165f526bfe7db9765fcf4451f598c4ea96b560fd49a48746e`.
- Frozen binary semantic hair union: `/Users/david/dev/photoctl/specs/segmentation-quality/assets/sam3-native/visuals/portrait-text-hair-union/binary-mask.png`, SHA-256 `03ae4bd90a3ffa911d77e971df3a3d360a108089182304951da00ef7d61cb5f3`.
- Source and seed are copied byte-for-byte to `outputs/source.png` and `outputs/seed.png`.

## Execution and fidelity

A fresh isolated Python 3.12.14 environment uses torch 2.8.0, torchvision 0.23.0, the previous native environment's frozen package versions, and loguru 0.7.3. Full versions are in `requirements-frozen.txt`. Ordinary float32, four intra-op CPU threads, one inter-op thread, inference mode, fixed seed 0, no compilation or TensorRT. The inference subprocess sets Hugging Face offline mode and uses the downloaded local file.

Only two upstream source adaptations were made, recorded in `portability.patch`: lazily import unused Triton EDT inside its error-point sampling function; allocate positional-cache tensors on CPU when CUDA is absent. The import probe failed first for missing Triton, then passed import but failed positional construction on CUDA allocation; both passed after their respective minimal fixes. The probe and this red/green history are preserved in `probe.py` and `provenance.json`. An upstream import-time CUDA autocast context warns that it disables itself on CPU. No CUDA autocast is added to the runner and no learned computation is replaced.

The exact official image seam extracts detector visual-backbone keys and tracker keys, strips the documented prefixes, constructs `build_sam3matting(checkpoint=None, device='cpu')`, and strict-loads all 914 keys with `<All keys matched successfully>`. The source RGB transform remains 1008×1008 and mean/std 0.5. The binary seed becomes signed -10/+10, resizes bilinearly to 288×288, then is thresholded at >0 inside the original predictor. The learned unknown threshold remains sigmoid >0.65. All three alpha heads run at native geometry, producing 144×144, 288×288 and 576×576 alpha. The last is bilinearly enlarged to the original 1614×1080. No text/video wrapper, first-instance selection, mask cleanup, dilation, feathering, or foreground-color estimation was used.

## Attempts and measurements

Attempt 1 strict-loaded all 914 keys, then failed before image encoding because a runner logging argument named `name` collided with a tensor metadata field. This was an execution defect, not a model failure. Its full runner is `run-01.py`, log `run-01.log`, watchdog `watchdog-01.json`, partial artifacts `attempt-01-partial/`. Exit 1; wall 6.064 seconds. No image inference occurred.

The only correction renamed the logging function's first argument to `event_type`; watchdog outputs were given attempt numbers to preserve the failed record. Corrected `run.py` executed once via `watchdog.py 2`, with a fresh external 300-second limit. Attempt 2 exited 0 without timeout:

- Total subprocess wall: 12.928196 seconds, including imports and shutdown.
- Image encoding and alpha computation, including intermediate array IO: 7.178999666 seconds.
- Model-load-through-artifact interval: 11.452946209 seconds.
- Process ru_maxrss: 11,247,616,000 bytes (~10.4755 GiB).
- External sampled peak RSS: 11,117,477,888 bytes (~10.354 GiB).

These are one-run measurements, not repeated benchmark statistics. The failed attempt warmed filesystem/model pages; do not describe attempt 2 as a cold start.

Final alpha is float32, finite, 1080×1614, minimum 2.5174475e-13, maximum 0.999975979, and fraction >0.5 of 0.238365689. Coverage is a diagnostic, not accuracy.

## Retained artifacts

`outputs/alpha.float32.npy` and `alpha.f32` preserve unquantized alpha; `alpha.16bit.png` is rounded to uint16, and `alpha.png` is the ordinary 8-bit view. `unknown_fusion.npy` preserves learned unknown-region logits; `alpha_pred1/2/3.npy` preserve every progressive alpha stage, including native 576×576 final alpha. `signed-seed-original.npy`, `signed-seed-288.npy`, `alpha-head-binary-seed-288.npy`, `seed-binary.npy`, and `normalized-image-1008.npy` preserve the input transformations. `result.json`, both run logs, both watchdog records, `provenance.json`, and all scripts preserve execution provenance.

`overlay-green-0.4.png`, `black.png`, `white.png`, and `green.png` are straightforward composites for the parent to review. They use the original source RGB and do not decontaminate foreground colors. No visual comparison or quality acceptance has been performed by this worker. No repository product edits, commits, image uploads or model uploads were made.

## License

The upstream README and HF metadata specify CC BY-NC-SA 4.0. The upstream LICENSE says CC BY-NC 4.0. Both prohibit commercial use; their share-alike discrepancy is unresolved. This isolated research run establishes neither commercial permission nor product eligibility.
