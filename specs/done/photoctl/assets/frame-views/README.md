# Exact frame coordinates

The target is a base-space selection on an asymmetric red/green gradient with a blue landmark at
base coordinate `(33,28)`. Crop, quarter-turn, and straightening preserve that landmark's coordinate
meaning at both full and reduced source density. A detail view must extract the actual integer
raster rectangle, not multiply a full-resolution rectangle by a width ratio.

The captures come from public `develop` and `show` dispatch through built packages. `before/` and
`after/` retain native PNGs and nearest-neighbor 4× enlargements of every master and detail; the
enlargements expose existing pixels without adding detail. Both captures use the same synthetic
source and develop recipe. These prove geometry, not photographic quality.

`comparison.json` records dimensions, checksums, and explicitly top-left-overlap-only pixel error.
Full-density master/detail and the reduced master are byte-identical. The reduced detail changes
from 9×9 to 11×9: all 81 overlapping pixels differ, with mean absolute RGB difference 12.8724.
Different dimensions are intentionally not resized to make a distance score look comparable.
The public regression independently expects extraction `[5,2,11,9]` at reduced density and
`[12,4,20,19]` at full density, then checks the actual JPEG and landmark position.

`coordinates.json` beside each capture set records the public mappings. Native master pixels can
stay identical while their reported base-space footprint changes: reduced-tier crop rounding is
not the full-tier affine matrix scaled afterward. `scene-metrics/` records absolute content
telemetry; the synthetic gradient's quiet regions are deliberate, and all captures are opaque.

The unprimed critic inspected all 32 captures, including the earlier gradient-only set. No concrete
new regression was found, but the critic did not visually establish the coordinate correction:
the native images are tiny, both versions retain blur/colored edge halos, and detail clipping of
the blue landmark depends on the selected region. Enlargements are labeled by filename, not an
in-image scale annotation. The exact extraction and mapped-landmark tests remain the decisive
oracle. Direct inspection agrees that the master retains the landmark and the detail cuts its
left/bottom edges; this is the independently specified extraction, not a photographic-quality claim.

The three reduced-tier 4× comparison shots were opened together in Preview at 18:28:10 UTC and
closed at 18:33:38 UTC on 2026-09-05. No user objection arrived during that non-blocking checkpoint.
