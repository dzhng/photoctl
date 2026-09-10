# One sky polarity control

This is a foreground-estimation polarity control with the same released trained SAM3Matting model. It is not a new model. The single requested call completed; no quality claim is made. Parent owns visual review and `../review/` was untouched.

## Explicit polarity convention

`original-sky-seed.png` is the unchanged native SAM3 sky binary union. `complemented-foreground-seed.png` is exactly `255 - original-sky-seed`, with no morphology or tuning. This complemented mask is the model input. Every model intermediate and direct predicted alpha is labelled **raw-foreground**. Every **derived-sky** alpha is computed by `float32(1) - raw_predicted_foreground_alpha`. No threshold or clipping is applied to the derived alpha; valid ranges are asserted. Thus a derived-sky result must never be presented as a direct sky prediction by the matting model.

The original image is `/private/tmp/openphoto-zim.gDAkjs/holdout-jpeg-01/source.png`, SHA-256 `63dc1d626cebcf6f8e4e323a683ce106f38d404ef6a42fc1b4e2e84ff0f8f6e4`, preserved in `source.png`. Original coordinates remain 7008×4672. Original sky seed is `/Users/david/dev/photoctl/specs/segmentation-quality/assets/sam3-native/visuals/landscape-text-sky-union/binary-mask.png`, SHA-256 `3a570e0e73bfbf751a9da6194a741f9a01481c5956e1bb5a93b260db120c5b22`. The complemented foreground PNG SHA-256 is `08d2090a99ed69fa51dc8ac9a73541d06d0e743a4e82148946cd14a61d08c127`.

## Execution

Same upstream revision, verified local checkpoint and isolated environment as `../provenance.json`; same two previously verified CPU portability edits, no further model source edits. Checkpoint revision `4315db9c60d27fde396b09765748a0ca6c97bed5`, SHA-256 `7102d695be6070b39acd67464f93207df725514a688b545ed1267d913d3b9c7d`. All 914 extracted keys strict-matched. CPU float32, four intra-op threads, one inter-op thread, fixed seed 0, no compilation, Hugging Face offline mode. One source encoding and exactly one predictor call.

The published image preprocessing remains 1008×1008 RGB, mean/std 0.5; complemented binary mask is converted to -10/+10 and bilinearly resized to 288×288, then thresholded at >0 inside the unmodified image predictor. Learned unknown threshold remains sigmoid >0.65; all three alpha heads run at native geometry. Native final alpha is 576×576, then bilinearly enlarged to 7008×4672. Both native and original derived sky alpha are inverted from their corresponding raw foreground float32 arrays. No road/hair variants, downloads, previous-output edits, commits, product changes or uploads occurred.

Single 300-second external watchdog, exit 0, no timeout or retries. Subprocess wall 21.756499000 seconds. Model load 2.978347666 seconds, source encode 5.011469625 seconds, predict including intermediate IO 2.163548708 seconds. Model-load-through-artifact interval 20.132214416 seconds. Process ru_maxrss recorded 9,204,776,960 bytes; external sampled RSS peak 9,232,187,392 bytes. Log events retain the cumulative process high-water mark. These are single-run observations after earlier model/file accesses, not cold-start benchmarks.

Raw original-resolution foreground alpha is finite, range 9.7210732e-14 to 0.999981523, fraction >0.5 is 5.2501703%. Derived sky alpha is finite, range 0.0000184774 to 1.0, fraction >0.5 is 94.7498297%. These diagnostics do not establish correctness; the parent's full visual review determines whether the control explains the earlier sky result.

## Artifacts and verification

`raw-foreground-alpha-original` and `raw-foreground-alpha-native-576` are direct model outputs. `derived-sky-alpha-original` and `derived-sky-alpha-native-576` are explicitly derived complements. Each stem has `.float32.npy`, `.f32`, `.16bit.png` and `.png` forms. `raw-foreground-unknown_fusion.npy` preserves learned logits and `raw-foreground-alpha_pred1/2/3.npy` preserve all progressive stages. Complemented signed original/288 seed, actual binary288 head input, both original binary seeds, and normalized1008 image are preserved.

Saved seeds were verified to be exact complements. At both output resolutions, saved derived float32 was verified exactly equal to float32(1) minus saved raw float32. Raw files were verified equal to NumPy arrays; 16-bit PNGs were verified equal to the intended rounded uint16 values. These were serialization checks, with no inference rerun.

Full black/white composites and 40% green overlays have explicit `raw-foreground-` or `derived-sky-` prefixes. They use original RGB, without foreground-color decontamination. Complete execution details are `result.json`, `../polarity-sky-run-01.log`, `../polarity-sky-watchdog-01.json`, `../run_polarity_sky.py` and `../watchdog_polarity_sky.py`. The upstream noncommercial license restrictions and CC BY-NC versus CC BY-NC-SA discrepancy remain unchanged.
