# Single-mask versus multimask portrait control

Verdict: reject single-mask mode as a quality fix for either model size. Both
modes identify the broad hair mass; neither delivers detailed hair selection.

The [method record](method-and-results.json) and [distance report](distance-metrics.json)
own the exact two-run configuration and measurements. The official predictor
documents single-mask output as potentially better for non-ambiguous multi-point
prompts. This test retains its default stability fallback and the original twelve
points; the actual fallback branch was not instrumented.

In the [Small pair](small-pair.png) and [Large pair](large-pair.png), A is the
previous multimask argmax selection and B is single-mask output. Native B masks
are retained for [Small](small-mask.png) and [Large](large-mask.png).

An unprimed reviewer inspected the original full portrait, full source/overlay/
black/white/mask views for both modes and sizes, and every crop representation
for crown, right curls, face curl, bottom flyaways and flowers. Parent inspection
independently agrees with the principal defects:

- Small single-mask output deletes most of the hanging face curl, leaving islands,
  and loses more crown and upper-right hair. It improves eyebrow exclusion.
- Large single-mask output breaks the connector above the lower face-curl loop
  and removes its tip. It excludes some skin better but loses real hair with it.
- Both Large modes fill background gaps among crown/right curls into opaque masses.
- All four masks miss long bottom flyaways and substantial perimeter structure.
- Flowers and shoulder fabric remain excluded; the dense main hair mass remains
  selected. Those successes establish a coarse seed, not the requested quality.

Small's bottom-edge tradeoff has no clear winner: removing background also removes
hair. Large's earlier mode retains more bottom hair. The full scratch set remains
at `/private/tmp/openphoto-sam21-single.YDF0A8`; no production behavior changed.
