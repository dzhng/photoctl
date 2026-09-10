# Fixed person, sky and road holdouts

All three requested holdouts completed in the sole bounded batch. This report establishes execution and preserves diagnostic outputs; visual quality is not accepted here. The parent owns `review/` and all visual critique.

The runner is `../run_holdouts.py`; full event log `../holdouts-run-01.log`; external watchdog `../watchdog_holdouts.py` and record `../holdouts-watchdog-01.json`. Existing hair outputs, failed-attempt evidence, source checkout and environment were not changed. No downloads, product edits, commits, image/model uploads, morphology changes, threshold changes or retries occurred.

The batch reused the previously verified released checkpoint and existing isolated environment described in `../provenance.json`, `../requirements-frozen.txt` and `../report.md`. It strict-loaded the same 914 extracted keys once. One predictor was created per source; the portrait was encoded once for person, and the landscape once for sky and road. Each case had independently installed/removed intermediate capture hooks and its own outputs. Both source encodings retained the original 1008×1008 RGB transform and native feature geometry. Mask preprocessing was unchanged: binary seed → signed -10/+10 → bilinear 288×288 → original predictor threshold >0. Learned unknown threshold sigmoid >0.65 and all three alpha heads remained unchanged. Native final alpha is 576×576 and is bilinearly enlarged to original source coordinates. Ordinary CPU float32, four intra-op threads, one inter-op thread, fixed seed 0, no compilation.

## Results and measurements

The 300-second external batch watchdog reported exit 0, no timeout, 30.437496500 seconds subprocess wall. The model-load-through-artifact event interval was 28.628589375 seconds. These are single-run observations, not repeated benchmarks or isolated per-model latencies. The model and files had previously been accessed; do not call this a cold start.

| Case | Original width×height | Shared source encoding | Predict plus intermediate IO | Case including artifacts, excluding encoding | Cumulative process peak RSS |
|---|---|---:|---:|---:|---:|
| person | 1614×1080 | 5.022391334 s | 2.000538166 s | 2.381283917 s | 11,057,856,512 bytes |
| sky | 7008×4672 | 5.210163875 s | 1.199158708 s | 5.264721042 s | 12,917,080,064 bytes |
| road | 7008×4672 | same landscape encoding | 2.336670084 s | 6.409927167 s | 14,893,203,456 bytes |

RSS is the monotonically increasing process high-water mark, not each case's independent allocation. External sampled peak was 14,808,186,880 bytes. Every event in the full log records the cumulative process high-water mark.

All alphas are finite in [0,1]. Person range is 1.0346396e-13 to 0.999986947, fraction >0.5 is 39.6006012%; sky range is 6.3835878e-13 to 0.909460008, fraction >0.5 is 0.00602907%; road range is 1.2433454e-12 to 0.999993563, fraction >0.5 is 4.73042123%. These are diagnostics, not accuracy. In particular, sky is extremely sparse at this diagnostic threshold and needs the parent's complete visual inspection. No attempt was made to improve or reinterpret its result through threshold tuning.

## Frozen source and seed provenance

Person source `/private/tmp/openphoto-dxo-source.vH8WZH/source-t14_5.png`: SHA-256 `052ecfc6d93c615165f526bfe7db9765fcf4451f598c4ea96b560fd49a48746e`.

Sky and road source `/private/tmp/openphoto-zim.gDAkjs/holdout-jpeg-01/source.png`: SHA-256 `63dc1d626cebcf6f8e4e323a683ce106f38d404ef6a42fc1b4e2e84ff0f8f6e4`.

Seeds are the fixed binary unions under `/Users/david/dev/photoctl/specs/segmentation-quality/assets/sam3-native/visuals/`:

- Person `portrait-text-person-union/binary-mask.png`: `9b25bf787350b74698af5131436c3af19be4dc29fbcd0296246e66addb3f9369`.
- Sky `landscape-text-sky-union/binary-mask.png`: `3a570e0e73bfbf751a9da6194a741f9a01481c5956e1bb5a93b260db120c5b22`.
- Road `landscape-text-road-union/binary-mask.png`: `00968463bfb346148c89a8861ce29f3e651f1a599953654b353b010cbab78587`.

## Outputs

Each of `person/`, `sky/`, `road/` contains byte-preserved `source.png` and `seed.png`; original-resolution `alpha.float32.npy`, `alpha.f32`, `alpha.16bit.png` and `alpha.png`; native `alpha_pred3.npy`, `alpha-native-576.f32` and `alpha-native-576.16bit.png`; learned unknown logits `unknown_fusion.npy`; intermediate `alpha_pred1.npy` and `alpha_pred2.npy`; signed full-resolution and 288×288 seeds, actual binary 288×288 head input, original binary seed array and normalized 1008×1008 image array. `result.json` contains exact provenance and measurements, aggregated in `batch-result.json`.

Original and native raw float32 files were verified numerically equal to their NumPy arrays; both 16-bit PNGs were verified exactly equal to the intended rounded uint16 alpha. No inference was rerun for these serialization checks.

Full-resolution black, white, green composites and the 40% green overlay are provided for review. They use original RGB directly without foreground-color decontamination. No worker visual acceptance or PhotoLab equivalence claim is made. The upstream noncommercial licensing limitation and CC BY-NC versus CC BY-NC-SA discrepancy described in `../report.md` remain unchanged.
