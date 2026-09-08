# Outpaint lifecycle and framed masks

A mask owns a physical execution frame independently of the RGB it covers. The shared evaluator
projects coverage between those frames and clips it to both authored supports. Retouch uses the
current photographic output for both its healing input and its placed mask; treating that mask as
a full-catalog raster can reject or misplace an otherwise valid extension-local edit. The existing
transform placement recipe carries this meaning without a retouch-specific compositor or schema.

The [public process journey](../../../../../test/journeys/outpaint.ts) is shared by built CLI and
installed-package checks. Its asymmetric source and cropped quarter-turn distinguish placement
from dimensions alone. The synthetic border is deliberately not a photographic quality sample.
The intended change is confined to the retouch circle; photographed interior and subsequent
restoration states must remain exact, with provider activity restricted to explicit generation.

## Verification evidence

The initial public retouch request failed when its mask used only the developed base frame.
Changing that source alone exposed `Composite mask artifact dimensions do not match`: the canvas
consumer still assumed catalog-sized masks. The shared execution-frame correction made the same
journey pass. The patterned stimulus changes exactly four pixels, with maximum outside-mask
channel difference zero. The complete [capture set](candidate/) and [enlargements](crops/) retain
every lifecycle state, not just the successful-looking ones.

The built check passed in 9.43 seconds. A separate isolated install passed in 11.32 seconds with
its working directory outside the checkout and repository runtime overrides cleared. All eight
installed outputs are byte-identical to the built captures. This is a **prebuilt-runtime packaging
witness**, using `scripts/pack.mjs` and the existing native binaries, not a fresh native release
build or the root closeout gate. Sixty-nine narrow retouch, manual-layer, fill, refresh, canvas and
density-transform neighbors passed; TypeScript build/typecheck and scoped lint/format checks passed.
No camera access, full-resolution probe or paid provider request was made.

After integration with paired originals and combined move/scale, 54 merged
retouch/outpaint/canvas/fill-refresh/move and built-journey checks passed. TypeScript
build/typecheck and scoped lint passed. Main review inspected all eight enlarged
lifecycle frames and agrees with the placement/support verdict below.

Packed artifact SHA-256 identities:

- CLI: `120042bc5902ae35ac1ebf769e959cf91631e37f9f1f4087414090cf7641c25c`
- Image runtime: `f6d691f028cba79296b3716fd51e77a3dabcd893901be1eaed56b3e447a5ed97`
- macOS helper: `34c851e3c52c106011769b6c0bd2c201de6769717f6a88fd2d31ea279ed83076`

## Review and boundaries

An unprimed visual reviewer inspected all eight full captures, eight enlarged views and two detail
crops. Its only high-confidence discontinuity was the small green square created by healing the
synthetic border; main inspection agrees. That visible change is the test stimulus, and its exact
support is measured above. Neither review claims that synthetic healing looks photographic.
No blur, clipping or misalignment was identified. The candidate is less wrong for mask ownership
and unchanged surrounding pixels; model quality and Workbench HTML layout remain unverified.

Independent code review `01a074ed-1959-7391-b4ea-2a29425a615f` found no production defect, but
correctly identified that the offline stage reuses a warm current output. That is intentional:
it pins the retained-output export guarantee. It does **not** prove fresh offline fallback
decoding or reduced-stage rounding, and must not replace those separate checks. No tolerance or
cache reset was used to hide a mismatch.

## Expanded-coordinate support

Coordinates remain in oriented original space. Normalized positions multiply original width/height,
and normalized radius multiplies the original long edge; neither is renormalized by a changing canvas.
Negative or greater-than-one normalized values may therefore address an authored extension. A new
circle must cover supported pixel centers and leave supported surroundings. Existing exact retries
return their authored layer without mutation, even if a later crop hides it; that is not a new repair.

Support is not the viewport's bounding rectangle or a nonblack-pixel heuristic. The existing canvas
recipe's ordered stages and actual permanent masks feed the same projection owner as RGB rendering.
Only deterministic mask caches may be materialized during validation; no source decoder, provider
adapter, new graph node or document revision is involved. Layer masks are consumed sequentially and
zero-opacity layers cannot make an empty corner healable. A normal source-only viewport needs no
mask execution. The native healing algorithm itself is unchanged.

The additional [full capture set](outside-original/candidate/) and
[enlargements](outside-original/crops/) show the negative-coordinate case. Both coordinate cases
change exactly four pixels with zero outside-mask difference. They also verify absolute/normalized
retry identity and no revision/node changes for invalid circles. Excluded-corner tests cover both a
rotated border and its fractional-straighten tail. Omitting support from circle validation made both
corner tests incorrectly commit; restoration passed without loosening thresholds.

The focused sweep passed 74 tests across eight files in 140.51 seconds. Both isolated installed
journeys passed in 28.61 seconds, and all sixteen stage images match their built counterparts
byte-for-byte. This follow-on uses the same prebuilt native binaries and has the same packaging
boundary above; its CLI tarball SHA-256 is
`4ede55aaa180c5a79f410e2b5235696fc7a61b344518fd47a6e83b940096bbea`.

Fresh visual review `01a07512-430d-7d83-adf8-d58890d20584` inspected all eighteen images.
It identified the tiled border, hard interior seam, small green square and apparently smaller
interior as visible concerns. Direct inspection agrees with those observations but not the proposed
aesthetic fixes: the fake gateway deliberately supplies unrelated patterned pixels, the square is
the four-pixel repair stimulus, and expansion increases canvas size without rescaling the interior.
Blending or smoothing these differences would weaken this placement test. Independent pixel checks
confirm the unchanged original interior and changes only at `(63,5)`, `(64,5)`, `(63,6)`, `(64,6)`.
The reviewer also found the restored/offline/refreshed states visually indistinguishable; their
byte identity is the required lifecycle outcome. No unexpected clipping or blur was identified.
The candidate is accepted for coordinate/support correctness only, not photographic healing or
generated-image quality. The first coordinate case remains byte-identical to its earlier critique.

Review `01a074f7-778e-7163-9740-39b32c9b2d80` proposed refusing an exact authored retry after a
hiding crop. That was dismissed because it would replace the existing idempotent retry contract;
the public hidden-retry/fresh-invalid comparison now pins the distinction. Final support review
`01a07505-0a9d-76d2-b149-ce9decebf831` found no actionable defect and independently passed the
invalid geometry, hidden retry and corner checks with Node 24. Typechecking, formatting and diff
checks passed. Scoped lint reports existing sequential-await warnings and the equivalent new ordered
mask-stage loop; stage operations intentionally depend on their predecessor, so they cannot run
in parallel.

The merged public full-frame neighbor rejects an empty rotated corner, accepts it when a visible
generated layer supplies pixels, and rejects it again at zero opacity or after removal. Retouch
preserves all other pixels and undo restores exact output without another provider request.
Deliberately omitting generated support makes the valid repair fail; restoring support passes.
Integration also updated the hidden-retry fixture to the clean-start original/photo schema.
The merged sweep passed 67 checks across six files. Independent integration review
`01a07513-aea0-7e21-8d46-a1e1048ad3fa` found that a leftover center-in-viewport guard
contradicted the circle-intersection rule. Public left/right edge cases reproduced the refusal;
removing that guard passed all 43 affected checks across four files, including both built journeys.
Final scoped review `01a07519-f827-7d91-a52e-e7d61fd1d82b` found no remaining actionable issue.
The two detail images were opened for a non-blocking human checkpoint and closed after five
minutes without feedback; the support-only acceptance above remains the evidence-based call.
Full-resolution resource acceptance and fresh native packaged release gates remain separate.

## Cold reduced-source lifecycle

The separate [cold public journey](../../../../../test/journeys/outpaint-cold.ts) imports a source
large enough for the normal import pipeline to produce a reduced pinned preview. A new lazy edit
has no execution of its current output node before disconnect. This distinguishes first-use
fallback decoding from the warm retained-output guarantee above; no cache deletion or replacement
creates the condition. A fractional straighten and quarter-turn exercise ordered reduced sampling.

Native border pixels can supply native output sampling while the original underneath is reduced.
The exact execution frame retains that reduced source size, and refresh reports its fallback
source context honestly. A second new state is exported before any preview. Disabling the border
then exposes reduced output sampling, and undo restores exact pixels with the fixture gateway
closed. Reconnecting promotes original detail without changing the render identity or replaying
generation. The upper exterior rows remain exact across that source-only change.

Bypassing preview source-quality sufficiency made reconnect incorrectly retain `pinned-preview`;
the cold journey failed at that assertion. Restoring the existing owner passed. No production
change was needed. The built journey passed in 10.34 seconds and the isolated installed journey
in 12.28 seconds. Both use the existing native runtime, not a fresh native release build. The
complete five-state [capture set](cold/candidate/) and [enlargements](cold/crops/) are byte-identical
between built and installed runs. Reconnect changes 4,212 of 6,256 pixels (maximum channel delta
122); the exact exterior comparison remains unchanged. These differences locate source promotion,
not a photographic quality score.

Fresh unprimed review `cold_visual_review` inspected all ten full and enlarged images. It found
stable framing and border placement, a smaller border-free output, and a pronounced interior
texture change on reconnect: soft diagonal streaks become sharper horizontal/vertical patterns.
Main inspection agrees. The synthetic original deliberately contains alternating one-pixel stripes;
the source-quality negative control and decoded-source measurements establish the cause that
images alone cannot prove. The apparent grid is not accepted as natural photographic texture.
Exact undo and exterior checks corroborate the unchanged placement. The images are accepted for
sampling/provenance evidence only; photographic generation quality and Workbench layout remain
unverified. All three warm/cold journeys pass on the merged tree in 31.31 seconds.
The cold/reconnected enlargements were opened for a non-blocking human checkpoint;
after more than five minutes without feedback, only those documents were closed.
The sampling/provenance-only verdict above remains the evidence-based decision.

Packed SHA-256 identities for this bounded witness:

- CLI: `e63d6975e7f2869203e4a013e2a153418293cc196a4962bb0d97aa91e6e4adb4`
- Image runtime: `e18c71e082e69163693ce302e2a3627c6fe4eb376bcab421b1d71f3f5a83b2a5`
- macOS helper: `34c851e3c52c106011769b6c0bd2c201de6769717f6a88fd2d31ea279ed83076`

Independent cold-journey review `01a0751f-86da-7122-b1d4-6aed19f7a4b0` found no actionable
correctness regression. The complete built warm/cold journey file passed three tests in 31.08
seconds. Repository typecheck, standalone strict checking of the new journey, and scoped
lint/format checks passed. The reviewer could not run the local gateway in its read-only sandbox;
that execution limitation is separate from the successful outer-process and installed-package
runs above.

## Fresh native installed integration

At `85a4643`, the normal packed-install hook rebuilt the native runtime and Swift
helper, packed and installed the CLI outside the checkout, and ran both warm
outpaint cases plus cold disconnect/reconnect. All three passed, alongside the
full-frame journey, in a 42.95-second targeted run. This closes the earlier
prebuilt-only boundary for these keyless synthetic lifecycle checks. It does not
measure full-camera resources or prove photographic generation quality; public
RAW recovery policy still requires its later integrated release verification.
