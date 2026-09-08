# Upstream predictor quality reference

## Verdict: neither mask-selection mode meets the edge target

The target remains clear sky up to actual foliage and wire boundaries, and continuous paved
road without adjacent grass or gravel. These are reference experiments, not production changes
or replacement baselines. Production retains the specified letterbox and strict-positive logit
projection. The model checkpoint and pinned upstream source are the same as the parent evidence.

The official `SAM2ImagePredictor` runs on CPU in float32 against a full-size RGB8 display PNG
derived from the same canonical image, with the same positive base-coordinate prompts. Its
standard ToTensor, antialiased square resize, and normalization are used, with holes/sprinkles
postprocessing disabled. This changes several preprocessing variables together; it tests the
upstream reference's quality, not which individual variable causes a difference from production.

`stock/` uses `multimask_output=False`. `stock-multi/` requests three candidates and selects the
highest model-predicted IoU score before viewing any masks. IoU is the model's estimate of
selection accuracy, not a comparison with a human-authored correct mask. All candidate scores
and the selected index are retained in its `reference.json`; no visually preferred candidate
was substituted. Both subjects select candidate index 1 in the multi-mask experiment.

Both variants include their clicks and stay within the broad source-authored area bands.
Single-mask sky/path areas are 31.0573% / 4.8586%; highest-score multi-mask areas are
31.2668% / 4.9530%. These passing coarse checks do not establish edge quality.

## Independent visual review

A fresh image-only review of the single-mask captures found broad unselected sky halos around
foliage, omitted gaps between branches, oversized wire exclusions, and gravel spill plus detached
non-pavement selections around the distant road bend. Both subjects fail, high confidence.

A separate fresh comparison received the complete single/multi capture sets under neutral A/B
labels. It verified matching contexts and alignment, then judged multi-mask marginally less wrong
for sky (medium confidence), and single-mask less wrong for road (high confidence). Both sky
masks retain coarse foliage halos and thick wire ribbons. The multi-mask road recovers some more
distant asphalt but selects more adjacent gravel. Neither meets the target. Direct inspection
agrees; this is not evidence that the foreground road is severely fragmented.

Standard upstream preprocessing and mask selection do not close this fixture's edge failure.
Any deterministic edge refinement beyond the specified bilinear projection is a separate design
decision and remains unimplemented pending direction; changing models is not implied by this probe.

## Capture completeness and reproduction

Each directory retains the ten changed full/detail coverage and cyan-overlay PNGs, its reference
results, and crop metrics. `changedShare` compares each detail with the original production
letterbox mask, not with the other upstream variant. The four unchanged contexts are byte-identical
to the parent directory's full, foliage, wire, and road context PNGs and are shared there. No
captured state was discarded; duplicate context storage is unnecessary. Crop coordinates,
nearest-neighbor 2× presentation, and overlay opacity are unchanged from the parent capture.

Reproduce using the parent source identity and prompts with the pinned SAM2 source/checkpoint:
convert the canonical display image to full-resolution RGB8 PNG, call `set_image`, then
`predict(point_coords=..., point_labels=[1], multimask_output=False)` for the single result.
Repeat with `True` and choose `argmax(scores)` before inspecting the images. Keep default
strict-positive binary output and zero holes/sprinkles refinement. These Python reference outputs
are not production-route or full-command resource evidence.
