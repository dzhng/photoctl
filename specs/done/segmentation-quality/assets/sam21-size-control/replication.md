# Official SAM 2.1 size control

This control isolates model size from production integration. Both official
checkpoints receive the same source pixels, prompts, preprocessing and candidate
selection. The [machine-readable record](method-and-results.json) owns exact
versions, checkpoint hashes, timings, prompts and selection scores.

The target is subject-complete selection with correct exclusions: hair without
skin, flowers or background; sky without solid branches or wires; pavement without
vegetation. Binary segmentation is not fractional alpha matting. Neither mask
agreement nor the model's predicted IoU establishes accuracy against this target.

## Comparable evidence

Pair images show Small on the left (A), Large on the right (B):

- [Hair](hair-overlay-pair.png)
- [Sky](sky-overlay-pair.png)
- [Road](road-overlay-pair.png)

Native selected masks are retained for
[Small hair](small/hair/selected-mask.png),
[Large hair](large/hair/selected-mask.png),
[Small sky](small/sky/selected-mask.png),
[Large sky](large/sky/selected-mask.png),
[Small road](small/road/selected-mask.png) and
[Large road](large/road/selected-mask.png).
The [distance report](distance-metrics.json) includes full-frame and fixed-crop
measurements. It measures differences, not PhotoLab parity.

All six runs completed without retries. Large inference took approximately
2.3–3.6 seconds versus 0.7 seconds for Small on this CPU configuration. Full-frame
mask disagreement was 1.86% for hair, 0.37% for sky and 0.15% for road; small
global differences do not make the boundary errors small.

The complete scratch capture set, including all eighteen candidate masks,
low-resolution float32 logits, full black/white composites and 2× feature crops,
is retained at `/private/tmp/openphoto-sam21-control.QOaGJ8`. It is not a runtime
dependency. The selected evidence above is the durable review record.

## Interpretation limits

The [independent boundary review](critique.md) rejects both as finished detailed
selection. Large recovers some curls but trades that for filled gaps and lost road
continuation; it does not solve the quality gap by size alone.

This is a size comparison under one fixed prompt policy, not the quality ceiling
of SAM 2.1. The official predictor documents that single-mask output can improve
non-ambiguous multi-point prompts; that is a separate bounded diagnostic. No
river source was measured. No production model or API was changed.
