# Segmentation spike ledger

These are feasibility observations, not acceptance. Timings are single CPU runs
on the development Mac, not latency distributions or portable guarantees.

## Reference

The exact portrait appears in [DxO's public hero video](https://player.vimeo.com/video/1212277853),
embedded by [PhotoLab](https://www.dxo.com/en/dxo-photolab). Full frames are
1614×1080: unmasked at 14.5 seconds, hair overlay at 8.5 seconds. The user screenshot
clips the video's vertical extent. Source SHA-256:
`052ecfc6d93c615165f526bfe7db9765fcf4451f598c4ea96b560fd49a48746e`.
Compression, grading, cursor and overlay opacity prevent treating a color difference
as a ground-truth alpha mask. No permissive redistribution license was located.

## Measured candidates

| Experiment | Inference / peak RSS | Observed result; next question |
| --- | --- | --- |
| SegFormer face parser, whole image, no oracle | 2.52s / 1.64GB | Hair core found, some flowers included, coarse outer silhouette. Research-only model license also precludes product adoption. |
| ViTMatte-S, overlay-derived 32px trimap | 5.83s / 8.22GB | Wide halo and filled curl gaps. Overlay had incorrectly forced some gaps to foreground: not a fair model ceiling. |
| Same model, 128px inward / 32px outward uncertainty | 6.67s / 7.67GB | More curl loops and holes recovered; residual veil and skin fringe. Still oracle-assisted, not automatic selection. |
| SAM2-S, human-observed 5 positive / 7 negative points | 0.56s / 1.49GB | Face/flowers excluded; fine outer curls missing. Manual prompts are feasibility only. |
| SAM2-S, one automatic VLM call, same point budget | 0.91s / 1.49GB | All point labels honored; hair core separated. VLM call took 17.3s. No PhotoLab overlay or human corrections. |
| Automatic SAM2 → ViTMatte, 128px uniform uncertainty | 8.30s / 7.55GB matting | Outer curls recovered, but eye/eyebrow/forehead admitted. Broad uncertainty loses semantic exclusions. |
| Same candidate with nearest-point exterior guard | 4.0s / 8.94GB matting | Face leakage reduced; straight partitions cut lower curls and weaken top hair. Reject as product architecture. |
| Same automatic trimap, closed-form solver | 51.47s / 3.09GB | Extensive face, flower and background leakage. Solver replacement alone does not restore semantics. |
| ViTMatte with eroded negative-object interiors | 6.24s / 9.72GB matting, plus seven SAM calls | Eye/forehead mostly excluded, but eyebrow, skin inside ringlet, flower ghosts and right-edge background remain. Not accepted. |
| MAM ViT-B, frozen automatic points, both published guidance modes | 9.57s / 4.92GB | Mask guidance retains semantic exclusion but cuts curls and keeps thick skin/background fringe. Alpha guidance recovers strands but selects face/neck/flowers and clips at its bounding box. Independent full/crop review rejects both. |
| MattePro learned trimap → ViTMatte-S, frozen automatic points | 5.99s + 12.30s / 12.06GB | Face/neck marked definite foreground; refinement cannot correct them. All original points honored, but independent review rejects the actual selection. |
| Same models, one automatic overlay-feedback round | 6.68s + 9.14s / 9.58GB | Face exclusion improves but VLM misplaces new hair clicks on flowers; entire flowers become selected. An original background point is no longer honored. |
| Same models, automatic zoom verification of all proposed points | 7.57s + 12.10s / 8.78GB | Flowers/face mostly excluded, but cheek strip, missing forehead curl, upper-left hair wedge and outer wisps remain. Independent review: least wrong of these three, still rejected. |
| MediaPipe dedicated hair segmenter | 0.047s / 0.215GB | Fast semantic confidence, not alpha coverage. Missing forehead curl, right-hair holes and jaw ghost; independent review rejects as final mask. |
| MediaPipe confidence → ViTMatte-S | 12.10s / 7.97GB matting | Fixed confidence extremes define known regions; refinement retains the missing curl and jaw ghost. Rejected. |
| ZIM ViT-L, original automatic points and zoom-verified points | 8.02s encoder + 0.32s decoder / 6.94GB | Strongest full-frame candidate; independent review finds skin coverage inside forehead curls, cloudy right strands and missing lower flyaways. Extra points give no clear visual benefit. |
| Original-point ZIM → ViTMatte-S | 6.30s / 9.31GB additional matting | Independent review rejects both raw and constrained refinement: improved outer gaps do not compensate for erased solid bends of the hanging face curl. Direct ZIM remains less wrong. |

The guard changes only outside-SAM uncertain pixels more than 3px from the coarse
boundary, setting them to background when a negative point is nearer than a
positive. It is a diagnostic showing that exclusion guidance matters, not a sound
object-boundary model. Zero alpha at seven negative points does not prove the
intervening region is correct.

## Reproduction owners

- [SAM2](https://huggingface.co/facebook/sam2.1-hiera-small), revision
  `ee5bba1d82bb8749febdf90f45e84b687142ba03`, Transformers CPU reference.
  All three candidates retained; choose maximum predicted IoU mechanically before
  visual inspection. Its score is not independently measured accuracy.
- [ViTMatte-S](https://huggingface.co/hustvl/vitmatte-small-composition-1k), revision
  `6a58ad7646403c1df626fbd746900aec7361ea1d`. Raw and trimap-constrained alpha retained.
  Black/white composites use original RGB, so background-color contamination and
  alpha error are distinct possible causes of a visible fringe.
- [Face parser](https://huggingface.co/jonathandinu/face-parsing), revision
  `758b82e15a0178c9db39c1ff666a8b56e3a550c8`, whole-frame documented 512px preprocessing.
- [Matte Anything](https://github.com/hustvl/Matte-Anything) is the upstream
  semantic-selection/trimap/matting reference; [PyMatting](https://github.com/pymatting/pymatting)
  supplies the next classical-solver comparison.

The automatic VLM prompt requests hair only, five confident interior positives
and seven distributed adjacent non-target negatives. It receives only the clean
image. Coordinates are normalized 0–1000 then projected to original pixels.
`google/gemini-3.1-flash` failed 404; the public model list and a successful
structured request establish `google/gemini-3-flash` as the tested model instead.

## Independent visual verdict

An unprimed reviewer inspected all semantic/SAM candidates, all six matte variants,
full alpha/overlays, black/white composites and feature crops. Every candidate was
rejected as final selection. The oracle-assisted asymmetric trimap was the least
wrong detailed matte, while selected SAM candidate 1 was the useful coarse seed.
Neither establishes automatic parity. The reviewer distinguished RGB contamination
along real strands from actual alpha leakage: opaque loop interiors, recognizable
facial/flower shapes, broad gray areas and a vertical right-edge strip are genuine
selection errors. Nearest-point gating additionally deletes the forehead ringlet.

## Next experiment and acceptance discipline

Stop tuning uniform trimaps and spatial guards: both classical matting and learned
matting lose selection intent in uncertain regions. [MAM](https://github.com/SHI-Labs/Matting-Anything)
also failed despite receiving frozen SAM features. Its official Space declares MIT;
the combined checkpoint SHA-256 is
`b7d0781aa6edeab7b0d8195edf5b894402f9fa5b7220759825ff750c75450f08`.
The CPU replication loaded all weights strictly, with `weights_only=True`, and used
the published preprocessing and both refinement modes without visual tuning.
The retained [run report](assets/mam-report.json),
[alpha comparison](assets/mam-comparison.json) and
[independent critique](assets/mam-critique.md) describe the evidence. Final
[mask-guided](assets/mam-mask-guidance.png) and
[alpha-guided](assets/mam-alpha-guidance.png) mattes preserve both failures.
The mask-guided result changes only 2.43% of pixels by more than 16/255 from its
coarse mask; its edge energy is 56% of the earlier automatic ViTMatte result.
Those numbers locate the detail tradeoff, not an accuracy score.

The [MattePro](https://github.com/ChenyiZhang007/MattePro) experiment tests whether
learned refinement regions preserve image features and prompt intent better than
a uniform boundary band.
The [replication method](assets/mattepro-method.md) separates weight/forward parity
limits from the automatic-feedback and zoom-verification experiments.
Its README declares MIT code; confirm checkpoint redistribution terms before
adoption. Specialist hair selection and ZIM have now been measured. ZIM is the
strongest full-frame result, but neither establishes crop-level parity. The ZIM
refinement uses alpha ≤0.01 as known background and ≥0.99 as known foreground;
only the remaining region is unknown. Raw and constrained results are both retained.
Their mean absolute alpha distance from ZIM is approximately 0.00765, with 2.66%
of pixels changing by more than 0.1: movement, not an accuracy score.
The retained [ZIM run report](assets/zim-report.json) and
[refinement report](assets/zim-vitmatte-report.json) record provenance and runtime.
The [original-point](assets/zim-original12-alpha16.png),
[verified-point](assets/zim-verified25-alpha16.png) and
[refined](assets/zim-vitmatte-alpha16.png) alpha outputs preserve the measured masks.
The [independent refinement critique](assets/zim-refinement-critique.md) rejects
the tradeoff; do not promote the extra matting stage.
Do not assume hair-only quality proves generic selection. Keep the source and each
comparison's prompt budget frozen; retain every result.
[ZIM](https://github.com/naver-ai/ZIM) and
[SAM2Matting](https://github.com/FudanCVL/SAM2Matting) declare noncommercial terms;
they are not assumed product candidates. ZIM's official Hugging Face model-card
metadata instead declares CC BY 4.0; that disagreement must be resolved before
product adoption. MediaPipe's official hair-model card declares Apache 2.0, but
its measured quality is insufficient. SAM2Matting's README and LICENSE additionally
disagree on ShareAlike. [MAM2](https://github.com/ChenyiZhang007/Matting-Anything-2)
currently has only a release-soon README, not a runnable implementation.

Before promoting any candidate, compare full images and native feature crops
(top loops, right fringe, hair/face boundary, lower curls, flowers), obtain an
unprimed critique of the complete candidate set, then test photographic holdouts.
The existing canonical mask TIFF already stores fractional f32 coverage; preserve
that contract. SAM's current logits postprocessor creates binary coverage, so
refined alpha must bypass that threshold, not introduce a parallel mask store.
End-to-end CLI behavior and projection after crop/rotation remain
required; a Python reference alone cannot close implementation.

## ZIM photographic holdout: resolution matters

The old temporary developed render was no longer present. This probe uses the
same RAW fixture's full-resolution embedded JPEG, whose hash is recorded in the
[full-image report](assets/zim-holdout/full-report.json). It is not a pixel-identical
comparison with the earlier SAM developed render. Original fixture points and
crop coordinates are unchanged; all four outputs are retained and score argmax
selects candidate 3 for both sky and road.

Independent review rejects both whole-image selections. Wires are selected as sky,
foliage is blurred into broad silhouettes, and sky holes are missed. The path has
a good foreground core but loses its distant continuation and includes fence
elements and some adjacent grass/gravel. Broad coverage is 33.23% sky and 5.05%
road, demonstrating again that plausible area is not edge acceptance.

One diagnostic feeds the fixed wire and foliage crops directly into ZIM, each
with one manually chosen positive sky point. This is a resolution experiment,
not an automatic tiled pipeline. The [crop report](assets/zim-holdout/crop-report.json)
records about three seconds per crop and mean alpha changes of 0.0273/0.0269.
Compare [whole-image wires](assets/zim-holdout/full-wires-alpha.png) with
[crop-scale wires](assets/zim-holdout/crop-wires-alpha.png), and
[whole-image foliage](assets/zim-holdout/full-foliage-alpha.png) with
[crop-scale foliage](assets/zim-holdout/crop-foliage-alpha.png).
Independent review accepts the local wire crop: continuous thin-wire exclusion,
better pole exclusion and recognizable tree tips resolve the major failures.
Minor soft edges and an imperfect pole-top contour remain. Foliage is substantially
less wrong, but still rejected as complete selection because some clearly blue
internal gaps remain excluded. This does not establish whole-image quality,
automatic prompt propagation or seam-free recombination. The next diagnostic
should test automatic crop guidance on both portrait semantics and photographic
details before committing to a tiled architecture.

That [automatic-guidance test](assets/zim-auto-crops/critique.md) is now complete.
Local wires and foliage improve, but tight and wider-context portrait variants
regress against direct full-image ZIM. Retaining original VLM points is better
than inventing confident-mask prompts, but neither context variant is accepted.
Do not proceed to whole-image tiling on this evidence. The next independent
model replication is SAM2Matting's published prompt-driven pipeline, research
only under its stated noncommercial terms.

SAM2Matting's [replication record](assets/sam2matting/replication.md) now covers
the [frozen-point run](assets/sam2matting/points-report.json) and
[ZIM-mask-guided run](assets/sam2matting/mask-report.json), retaining both
[point-driven](assets/sam2matting/points-alpha16.png) and
[mask-guided](assets/sam2matting/mask-alpha16.png) outputs. Independent
[full/crop review](assets/sam2matting/critique.md) ranks direct ZIM above both.
Mask guidance improves the terminal face curl but loses more perimeter hair;
the point-driven path loses prominent curls. Neither is accepted.

## Official SAM 3 baseline: access prerequisite

The user's question identified an omission: all previous Meta baseline measurements
used SAM 2.1, not the current official SAM image model. Third-party SAM2Matting is
not a Meta release. No prior failure establishes that SAM 3 performs poorly here.

Meta's [current repository](https://github.com/facebookresearch/sam3) uses
`facebook/sam3` for its image builder. The March 2026 SAM 3.1 update primarily
changes multi-object video tracking; do not confuse that checkpoint with the
documented image path. Test native text prompting and the frozen points before
further derivative-model prioritization.

On 2026-09-09, the official `facebook/sam3` checkpoint endpoint returned HTTP 401
with `GatedRepo`. Hugging Face's credential resolver found no configured token.
No cached SAM 3 checkpoint was found in the standard Hugging Face/Torch caches.
The user must obtain access and authenticate locally, or provide an already
authorized checkpoint. Do not bypass the gate with an unofficial mirror or
accept license/access terms on the user's behalf. CUDA is the documented runtime
prerequisite; CPU feasibility remains to be checked separately from model quality.

The user subsequently requested access and challenged whether model generation
explains the quality gap. Meta's [interactive image benchmark, Table 6](https://arxiv.org/html/2511.16719v1#S6)
indeed places SAM 2.1 Large close to SAM 3: 66.4/66.1 mIoU at one click and
84.3/85.1 at five clicks. Production uses SAM 2.1 Small. The missing Small/Large
control must be run with identical official preprocessing, sources, prompts and
candidate selection. SAM 3 access does not block this public-checkpoint test.
The latest landscape probes cover sky, trees, wires and pavement, not a river;
do not claim they diagnose a river failure.

The [official size control](assets/sam21-size-control/replication.md) is complete:
all six calls used the same sources, frozen prompts and official inference path.
Its result isolates size from production integration;
[independent boundary review](assets/sam21-size-control/critique.md) rejects both
as detailed selections, with mixed improvements rather than a decisive Large win.
A separate [single-mask mode control](assets/sam21-mode-control/critique.md)
is rejected for both sizes: local exclusion improvements come at the expense of
actual curl continuity. Neither prompt satisfaction nor predicted IoU certifies
the requested detail. The next bounded diagnostic keeps the whole image and
prompts fixed while testing 2048 input instead of 1024; treat it as an
out-of-training-resolution experiment, not an official supported baseline.
That [resolution comparison](assets/sam21-resolution-control/critique.md) improves
most reviewed boundaries, with a rectangular missing-hair patch as the major
regression. The user prefers 2048 and specifically flags that artifact. Preserve
the direction while isolating the dropout; do not record this as a wholesale
rejection of higher resolution. An Apple-native comparison is also requested.

The [Apple-native portrait baseline](assets/apple-vision/critique.md) now covers
accurate person, person-instance and foreground-instance segmentation on the
current Mac. Accurate person is a useful crown-edge baseline; person-instance
retains some lower flyaways faintly. Neither provides hair-only semantics, and
foreground-instance output overfills the fine hair silhouette. Apple's new
iterative prompt API is closer to the required contract but needs macOS 27;
it remains untested, with no OS upgrade authorized.

The [orientation and fixed-mean controls](assets/sam21-orientation/critique.md)
confirm that the rectangular dropout originates in prediction and varies with
orientation. Neither those controls nor an intermediate resolution provide a
stable repair. [Confidence-trimap matting](assets/sam21-logit-matting/critique.md)
repairs the hole but expands a hair request into non-hair objects. This is
different from the user's legitimate request for optional whole-person scope;
the [scope contract](scope.md) preserves that distinction.

The [authenticated SAM 3 image baseline](assets/sam3-native/critique.md) is complete.
Native concepts distinguish hair/person and return separate instances in a
synthetic duplicate test. Fine hair, wire and foliage boundaries still fail;
interactive hair also deletes a prominent curl. Access and CPU feasibility are
resolved for this scratch probe, not a remaining blocker or production adoption.

The [full SDMatte replication](assets/sdmatte/critique.md) uses frozen native SAM 3
masks as guidance for hair/person and sky/road. It restores some curl openings,
person flyaways, tree peaks and distant pavement, but introduces disconnected
non-hair patches and unrelated poles/fences. Independent review rejects generic
adoption. This is a completed trained-refiner baseline, not an authentication or
runtime blocker; the [candidate research](refinement-candidates.md) distinguishes
it from unreleased or more difficult-to-replicate alternatives.

The [TeachDiffusionMatting replication](assets/text-matte/replication.md) now
covers both hair phrases and person/sky/road with its complete SD 2.1 student
and high-resolution stages. Strict checkpoints and both synthetic/real-feature
sparse equivalence checks pass; an adapted upstream entry point exactly matches
the portrait harness. [Independent review](assets/text-matte/critique.md) rejects
the measured results: hair expands to skin/clothing, person loses large hair
regions, sky is almost empty and road is mostly missing. The user prefers ZIM
among the shown options. Keep that preference distinct from PhotoLab parity.
The next trained-variant control is SAM2Matting-SAM3, not a repeat of its earlier
Tiny model or an abandonment of native SAM 3.

That [SAM3-trained matting control](assets/sam3-matting/critique.md) is complete.
It uses the saved native SAM 3 masks, not new prompts. Hair-only forehead
exclusion improves at the cost of actual outer/lower curls; ZIM remains less
wrong overall. Person improves locally but lacks clothing and fine hair, sky
nearly disappears, and road becomes transparent at the bend. A single sky
polarity control instead selects nearly the whole scene after inversion.
All outputs and independent reviews are retained; no variant is adopted.

The native-resolution [MatAnyone 2 comparison](assets/matanyone2/critique.md)
also completes without fallback. The supported person case and out-of-domain
hair case preserve SAM 3 scope but still miss lower curls and clothing.
Independent review prefers ZIM for hair and MatAnyone 2 among the displayed
person candidates, while rejecting both as target-correct. This is runtime
feasibility and local edge improvement, not a production adoption or parity claim.

The [released MGMatting RWP portrait probe](assets/mgmatting/critique.md) recovers
more lower flyaways but adds recognizable facial ghosts to hair selection and
still loses clothing for person. Independent review rejects both raw and
published cleanup results. The native-resolution gain is real but not enough;
the [research gap synthesis](research-gaps.md) owns the single remaining guidance
control and its stop condition.
