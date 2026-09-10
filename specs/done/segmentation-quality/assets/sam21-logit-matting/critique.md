# Confidence-trimap refinement loses requested scope

This refinement repairs the missing-hair rectangle but does not preserve the
hair-only request. Reject it as a repair pipeline. Unlike an intentional
whole-person request, the selected face, flowers, hand, neck and clothing here
are semantic leakage.

The [method report](method-and-results.json) records a single ViTMatte Small run
using original 2048 SAM logits: values below -log(99) become known background,
above log(99) known foreground, and the remainder unknown. These thresholds are
a fixed diagnostic, not calibrated confidence. No morphology, oracle points,
manual filling or tuning was applied. The rule makes about 77% of the image
unknown and only about 1% known foreground.

The [full comparison](full-overlay-ABC.png) and
[artifact comparison](artifact-context-overlay-ABC.png) show A=original binary,
B=raw matte, C=matte with known trimap values restored. Both
[raw](alpha-raw-16.png) and [constrained](alpha-constrained-16.png) alpha are
retained, with [distance measurements](distance-metrics.json).

The artifact interior becomes almost opaque, but selected coverage more than
doubles and two original negative flower points become strongly selected.
An unprimed reviewer inspected full states and all hair/artifact/neck crops:
B/C recover loops and long flyaways while also retaining broad background and
non-hair objects. C has almost no visible semantic advantage over B and adds
small holes inside the incorrectly selected flowers. Parent inspection agrees
on the repaired rectangle and extensive leakage.

Inference took 7.76 seconds with about 6.68 GB peak process RSS. Complete
float32 outputs, trimap and captures remain at
`/private/tmp/openphoto-sam21-matte.12idEA`. No production API or model changed.
