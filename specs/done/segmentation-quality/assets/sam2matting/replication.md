# SAM2Matting SAM2.1-T: two separately authorized research runs

The original point-driven interactive pipeline completed on CPU with a strict checkpoint load. A separately authorized mask-guided run subsequently completed and is documented below. This is a research replication artifact, not an adoption recommendation or a visual acceptance verdict. No product files were edited and no commits were made.

## Provenance

- Official repository: https://github.com/FudanCVL/SAM2Matting
- Git commit: `73dd721d77b56749248aefe5e8824d7f61b9d13c`.
- Model repository: https://huggingface.co/FudanCVL/SAM2Matting
- Model revision: `4315db9c60d27fde396b09765748a0ca6c97bed5`.
- File: `checkpoints/SAM2Matting-SAM2.1Tiny.pt`, 215,569,778 bytes.
- Verified checkpoint SHA-256: `5b9321e3b51bc20f5b84c208746cc083dd3053dd701590f2e88dc8640afcc39d` (matches server linked ETag).
- Original source: `/private/tmp/openphoto-dxo-source.vH8WZH/source-t14_5.png`, 1614×1080.
- Source SHA-256: `052ecfc6d93c615165f526bfe7db9765fcf4451f598c4ea96b560fd49a48746e`.
- Frozen prompts: `/private/tmp/openphoto-live.r2dGWB/hair-points.json`.
- Prompt file SHA-256: `3ea9da8d9533a523e5fd46cb1285e7b34a8855a4b3f8c2558cc9ff8db66b6b24`.
- Positive points: (968,108), (1323,346), (1469,594), (1291,886), (1130,648).
- Negative points: (888,572), (807,810), (484,432), (646,54), (161,540), (1372,1058), (484,994).
- Their recorded provenance is one automatic Gemini call on unmasked source. No reference overlay, corrected point, externally generated mask, or manual candidate selection entered this run.

## Pipeline and computational differences

The first-run seam follows official `interactive_sam2.py`: `build_sam2matting_video_predictor` → `init_state` → `reset_state` → `add_new_points_or_box` → `propagate_in_video`. A single PNG frame is a byte-identical copy of the source under the numerical filename required by the upstream loader. All 12 frozen points are passed at once with their existing labels through the public array API; the demo CLI itself exposes one positive point. The later mask-input variant is reported separately below.

The official loader resizes the frame to 1024×1024 and normalizes RGB using its existing constants. The model retains its original Tiny configuration, prompt handling, dynamic stability selection, ROI threshold 0.65, and three progressive alpha heads. Native alpha is 512×512 and upstream video inference resizes it bilinearly to original 1614×1080. No new morphological cleanup, trimap dilation, refinement, crop inference, or post hoc candidate choice was added.

CPU was selected using the public `device='cpu'` parameter. The demo's CUDA bfloat16 autocast context was omitted so computation used float32; existing internal tensor casts remain unchanged. No CUDA monkeypatch, model surgery, or precision approximation was introduced. This is a CPU float32 adaptation, not bit-identical CUDA bfloat16 reproduction.

One upstream behavior degraded: default hole filling (`fill_hole_area=8`) calls the unavailable CUDA `_C` connected-components extension. Upstream catches that import error and skips hole filling; the exact warning is in `run.log`. That fallback was preserved without replacement. Results therefore do not establish equivalence to fully enabled CUDA postprocessing.

Unlike the official permissive checkpoint helper, the runner calls `model.load_state_dict(weights, strict=True)`. It reported `<All keys matched successfully>`. Configuration and weights were not changed. Forward hooks only serialized outputs of the SAM mask decoder, unknown-region fusion, and alpha heads; they do not alter outputs. All captured outputs were retained.

Fresh venv: Python 3.12.14, torch 2.8.0, torchvision 0.23.0, NumPy 2.5.3, Pillow 12.3.0, hydra-core 1.3.6, omegaconf 2.3.1, iopath 0.1.10, tqdm 4.70.0. Torch and torchvision match the published pinned versions; Python differs from the documented 3.10. Only imports needed by this CPU path were installed; unused TensorRT/CUDA, SAM3, plotting, training, and video-encoding dependencies were omitted. The existing ZIM environment was used only as a Python interpreter source to create this venv and was not modified.

## Timing and resources

First run: one model configuration, one frame, one prompt call. Four intra-op CPU threads and one inter-op thread. No GPU, compilation, or retries.

- External watchdog: hard subprocess timeout 180 seconds, including startup and artifact work; exit code 0.
- Subprocess wall time: 6.4561 seconds.
- Model construction and strict weight load: 0.2073 seconds.
- Image encoding through propagation, including intermediate artifact IO: 3.8852 seconds.
- Final artifact creation: 0.3532 seconds.
- Measured model-load-through-artifacts interval: 4.4458 seconds.
- Process peak RSS on macOS: 7,242,055,680 bytes (~6.745 GiB).

These are single warm-filesystem measurements, not repeated benchmark statistics. Raw `outputs/run.json`, `watchdog.json`, and `run.log` preserve the measurements and warning.

## Retained outputs

Everything is under `outputs/`. `source.png` and `prompts.json` preserve the exact inputs. `alpha.float32.npy` is the unquantized model alpha at original resolution; `alpha.16bit.png` is rounded to uint16. The alpha is finite, min 3.4707e-21, max 0.9999758, and 22.7383% of image pixels exceed 0.5. This coverage is diagnostic, not accuracy.

Full output views: `alpha.png`, `overlay-green-0.4.png`, `black.png`, `white.png`. Green overlay is RGB*(1−0.4*alpha)+green*(0.4*alpha). Black and white composites use the original RGB with alpha; no foreground color estimation or color decontamination was performed. Consequently composites can expose source-background color contamination independently of alpha accuracy.

Each view also has every requested nearest-neighbor 2× crop: `-top-2x.png` (820,15,1350,220), `-right-2x.png` (1380,170,1614,790), `-face-2x.png` (855,305,1170,680), `-bottom-2x.png` (1260,845,1614,1080), `-flowers-2x.png` (660,670,1060,920). Crops are diagnostic supplements to the preserved full frame.

Intermediate arrays: all tensor outputs from the one SAM mask decoder call (`sam_mask_decoder-0-*.npy`), unknown-region fusion logits (`unknown_fusion-0-0.npy`), all three progressive alpha outputs (`alpha_pred1/2/3-0-0.npy`), the initial prompt mask logits (`prompt-mask-logits.npy`), and propagated frame mask logits (`frame-0-mask-logits.npy`). The model returns no separate unknown-region visualization in this published configuration; its logits are nevertheless captured by the hook. All outputs from this sole run remain available; none were selected away.

The runner `run.py` and hard-timeout wrapper `watchdog.py` are preserved alongside the untouched upstream checkout and checkpoint. The separately authorized mask-input test has its own runner and artifact directory, described below.

## Second run: documented image matting with fixed ZIM binary mask

This run was authorized after the first report was completed, specifically to isolate dedicated matting refinement from Tiny point segmentation. It used the same source, checkpoint, strict load, CPU float32 adaptation, versions, and four-thread settings. Only one seed threshold and one model call were run; neither was tuned to the result.

Seed: `/private/tmp/openphoto-zim.gDAkjs/original12/alpha.f32`, little-endian float32 shaped 1080×1614. SHA-256 `86e8d25acd9293948328199008e9a0ab8a979366bbeb8bb53b584cdb35f44215`. The seed was thresholded once at alpha >= 0.5. Original seed bytes, binary PNG, and binary NumPy array are retained in `mask-guided-01/`.

The exact seam follows official `inference_image_sam2.py`: build `SAM2MattingImagePredictor(build_sam2matting(...))`, `set_image` using the original RGB image, `raw_mask` set to the full-resolution binary mask, `mask_input = binary.float()*20-10`, add batch/channel dimensions, bilinear resize to 256×256 with `align_corners=False`, and `predict(img=img, raw_mask=raw_mask, mask_input=mask_input, multimask_output=False)`. The published predictor internally thresholds this resized signed mask at >0, passes it directly to the alpha heads, and bilinearly enlarges the final alpha to original resolution. It does not invoke its SAM mask decoder on this seam. Its image transform and feature setup remain unchanged; they differ from the video pathway, so the two outputs are not a controlled seed-only comparison.

No missing CUDA extension is traversed in this image matting path; no postprocessing warning occurred. No inference source patch or monkeypatch was needed. Strict load again reported `<All keys matched successfully>`.

- External watchdog: 180 seconds, exit code 0; subprocess wall 12.6007 seconds (includes imports/startup).
- Build and strict load: 0.7102 seconds.
- Inference including intermediate IO: 3.4748 seconds.
- Final artifacts: 0.3052 seconds.
- Model-load-through-artifacts interval: 4.4901 seconds.
- Peak RSS: 7,326,564,352 bytes (~6.824 GiB).
- Alpha min 1.1246e-17, max 0.9999778, fraction >0.5: 25.0418%.

Numeric distance from the original continuous ZIM alpha, **not accuracy**: MAE 0.0186631, RMSE 0.0808254, mean signed change −0.0158954, absolute change >0.1 on 5.5688% of pixels and >0.5 on 0.7160%; maximum absolute change 0.863531. These prove the output changed and locate the scale of divergence, not whether either matte is correct.

`mask-guided-01/` retains the same full alpha float32/16-bit and alpha/green-overlay/black/white views with every requested 2× crop. All unknown fusion and alpha head outputs are retained, plus the exact signed 256×256 input. There is no SAM decoder output because the documented path does not call that decoder. The source seed and binary are also retained. `run_mask.py`, `watchdog_mask.py`, `run-mask.log`, `watchdog-mask.json`, and `mask-guided-01/run.json` provide execution provenance. No additional variants were run.

The full mask-guided overlay has been inspected to verify it depicts the expected source and hair target. Comparative visual acceptance remains with the parent's full/crop inspection and unprimed critique for both complete output sets.

## Visual review and license limits

The target is hair-only coverage including fine curls and edge strands while excluding face, flowers, clothes, and background. The full overlay has been inspected to confirm the artifact depicts the intended source and target. No comparative quality or acceptance claim is made here. Complete full/crop artifacts are handed to the parent for compare-screenshots and a fresh unprimed screenshot-critique, including weak regions rather than selected showcase crops.

Upstream README and Hugging Face metadata say CC BY-NC-SA 4.0. The repository LICENSE instead states CC BY-NC 4.0. Both explicitly prohibit commercial use; their share-alike discrepancy remains unresolved. This research run establishes neither commercial permission nor product eligibility.
