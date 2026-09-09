# 02 — Signed guidance per instance

Seam: GroundedInstance in the structured-provider adapter becomes
`{label, box_2d, points: [{at: [x,y], label: 0|1}]}`. Points are image-frame
pixels after provider conversion; label 1 includes, 0 excludes. The provider
wire uses normalized 0–1000 x/y points and its existing top/left/bottom/right
box convention. Convert once at that external boundary. Reject nonfinite,
out-of-range coordinates and invalid labels rather than silently clipping.

Require five confident target-interior positives and seven distributed adjacent
non-target negatives per instance, matching the proven budget. The prompt names
the user's arbitrary target and instructs boundaries/exclusions, never hardcodes
classes. Keep empty instances valid and the existing instance bound. One gateway
call supplies all matching instances; do not fan out a call per instance.

First red test: a recorded signed response through the real structured adapter
produces correct point positions and polarity on a non-square image. Then cover
invalid provider values and empty instances one tracer at a time. Update fake
responses at consumers only as required by the new type, without wiring command
behavior in this pass. Human surface: deterministic request/response probe.
No visual acceptance claim until slices 00/06 exercise real grounding.

Delegated: prompt wording faithful to the retained successful research prompt,
parser factoring and fixture organization. No new dependency or public CLI flag.
