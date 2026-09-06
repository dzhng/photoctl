# Outpaint lifecycle and framed masks

A mask owns a physical execution frame independently of the RGB it covers. The shared evaluator
projects coverage between those frames and clips it to both authored supports. Retouch uses the
current photographic output for both its healing input and its placed mask; treating that mask as
a full-catalog raster can reject or misplace an otherwise valid extension-local edit. The existing
transform placement recipe carries this meaning without a retouch-specific compositor or schema.

The [public process journey](../../../../test/journeys/outpaint.ts) is shared by built CLI and
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

No fresh visual agent slot was available for the additional coordinate case. The required
adversarial inspection considered whether the isolated green square was an accidental artifact,
whether the dark interior hid clipping, and whether the stepped border concealed scale changes.
Full images and four-times crops show the intended localized square and stable gradient/interior;
exact outside-mask and restoration checks corroborate those observations. The candidate is accepted
for coordinate/support correctness, not photographic healing quality. The first coordinate case is
byte-identical to the earlier independently critiqued set.

Review `01a074f7-778e-7163-9740-39b32c9b2d80` proposed refusing an exact authored retry after a
hiding crop. That was dismissed because it would replace the existing idempotent retry contract;
the public hidden-retry/fresh-invalid comparison now pins the distinction. Final support review
`01a07505-0a9d-76d2-b149-ce9decebf831` found no actionable defect and independently passed the
invalid geometry, hidden retry and corner checks with Node 24. Typechecking, formatting and diff
checks passed. Scoped lint reports existing sequential-await warnings and the equivalent new ordered
mask-stage loop; stage operations intentionally depend on their predecessor, so they cannot run
in parallel.

Root integration owns the new full-frame-generated corner coverage neighbor, because that creation
work and paired schema are outside this worktree's dependency stack. Fresh reduced offline rendering,
full-resolution resource acceptance and fresh native packaged release gates remain separate.
