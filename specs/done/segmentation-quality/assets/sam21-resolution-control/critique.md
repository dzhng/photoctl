# Full-context resolution: improvement with a blocking artifact

The user prefers B (2048) over A (1024), except for the rectangular dropout in
the upper-left hair. Keep the higher-resolution direction; do not confuse
failure to meet the final quality target with failure to improve.

An independent unprimed review agrees that B improves the right curl, face curl,
bottom clump, broad treetop contour and road continuation. Wire handling is mixed
but slightly better overall: more wire is excluded and the upper halo narrows,
while lower-wire exclusion bands sometimes merge. The main regression is a
rectangular speckled hole through actual hair, visible in full views and the
top crop. The source contains hair there, not a background gap.

Neither result yet resolves long flyaways, porous tree canopies or thin wires.
B's distant road remains fragmented around fence crossings. Those are remaining
quality gaps, not reasons to reverse the user's preference for B.

## Evidence and limits

The [method report](method-and-results.json) records the exact experiment:
unchanged Large weights and prompts, input size 2048, and matching predictor
feature-reshape dimensions. This is outside the training resolution, not an
official supported benchmark. No production change was made.

Pair overlays show A=1024 and B=2048 for [hair](hair-pair.png),
[sky](sky-pair.png) and [road](road-pair.png). Retained B masks are
[hair](hair-mask.png), [sky](sky-mask.png) and [road](road-mask.png).
The [distance report](distance-metrics.json) measures change, not accuracy.
Inference took about 16–25 seconds, versus 2–4 seconds in the original control.

The reviewer inspected all three full overlay/mask/black/white pairs, all B
fixed crops and A comparison overlays, and all nine B candidate masks. Parent
inspection of full overlays and feature crops agrees. Full landscape images were
display-resized; detailed findings rely on the 2× crops. Unused candidates also
contain semantic errors and patterned holes; selection was not changed after
viewing them. Complete raw evidence remains at
`/private/tmp/openphoto-sam21-2048.DVycY8`.

## Next diagnostic

Check the saved logits before rendering, then run a single mirrored-input
portrait with correspondingly mirrored prompts and invert the output back to
the original coordinates. This tests spatial sensitivity of the dropout without
hand-filling it or changing the prompt budget. A changed result alone does not
identify a specific implementation defect or establish a robust fix.

The [completed orientation and fixed-mean controls](../sam21-orientation/critique.md)
confirm that the hole exists before rendering and changes under mirroring.
Neither mirroring nor averaging resolves it without remaining defects.
