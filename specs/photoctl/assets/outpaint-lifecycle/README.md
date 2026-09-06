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

This mask-frame prerequisite still uses catalog-bounded retouch coordinates. Full expanded-canvas
validation is a separate pass: coordinates remain in oriented original space, with normalized
coordinates anchored to original dimensions rather than renormalized whenever the canvas changes.

