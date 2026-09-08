# Canvas sampling evidence

The target is a fixed physical crop with truthful available sampling: missing exterior pixels stay
black, quarter-turns preserve placement, and a detailed local border does not enlarge whole-image
sampling merely because it is shrunk. These synthetic gradients and solid borders verify mechanics,
not photographic quality or restored detail from an offline original.

Folders `a` and `b` contain matched public PNG exports from the prior renderer and the density
consumer change. Each full native image has a 24× nearest-neighbor zoom; neither is a cropped or
smoothed substitute. States `a`/`b` are even/odd exterior crops, `c` is the odd crop quarter-turned,
`d` is a native border around a reduced original, and `e` is a border shrunk inside the original.
All twenty images form the review set. Their JSON records contain actual preview, mapping, export,
and retained input dimensions; `source_dimensions` still means the rendered preview source.

The reduced-input exports change from 24×12, 25×12, and 12×25 to 12×6, 13×6, and 6×13.
Their PNG hashes differ; the border and shrunken-border controls are byte-identical. Comparing
same-sized pixel distances would erase the sampling distinction, so per-image scene metrics and
explicit dimensions are used instead. All images are opaque. The border's low entropy and 70%
dominant red area describe the deliberately solid fixture, not an empty render; enlarged gradient
images have sparse edges because each retained sample is shown as a large square.

The [fresh visual critique and raw-pixel disposition](critique.md) accept the depicted mechanics,
with the review's framing concerns explicitly resolved rather than hidden. Public regressions verify exact mappings, cached detail,
PNG export, original input provenance, and no paid replay. This is not full outpaint acceptance;
source-only segmentation geometry and final lifecycle visual closeout remain in the owning slice.

The final cache/visible-coverage corrections were recaptured separately; all five candidate native
PNGs remained byte-identical. Independent code review caught and then cleared reconnect cache
sufficiency for both masters and exact views. The final local focused suite passed 65 tests, with
18 migration/restore fixtures separately green; the last exact-view correction passed the focused
11-test cache/consumer sweep. The reviewer's Bun command run could not start because of the known
`fs-ext` loader crash; the same public cases passed locally under Node 24/Vitest.

Root integration passed 71 focused checks, including the built CLI editing journey, preview/export
identity, public undo, evaluator frames and existing SAM projection. Typecheck and formatting passed.
The independent merged review found no actionable correctness issue; its two localhost-blocked
gateway cases passed in the unsandboxed host suite. Existing sequential-mutation test loops retain
their lint warnings because later commands intentionally consume earlier state.
