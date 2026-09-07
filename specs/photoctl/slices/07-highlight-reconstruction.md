# RAW highlight reconstruction

## Target and policy

The saved Sony A7C II originals must produce RAW-led deliveries without artificial
magenta in clipped lights. Preserve genuine colored lights, reliable samples and
scene-linear headroom. Removing false color is not a claim to recover texture from
fully lost channels. No camera-JPEG substitution, preset workaround or weaker oracle.

**Provisional product call:** ordinary RAW rendering reconstructs highlights;
explicit `decode` inspection can disable reconstruction. The user was asked and has
not answered. Record the chosen treatment in results and immutable render identity;
do not silently change adapter preference. LibRaw stays preferred, CIRAW remains an
alternative. This call is reversible without migration, backfill or library reset.

Unreconstructed means no highlight reconstruction, not untouched sensor bytes:
demosaicing, orientation, white balance and color conversion still apply. Keep the
existing linear-16 TIFF diagnostic output honest about its encoding limits. Use
existing canonical float artifacts/native sample evidence for above-one verification;
do not add a competing float file format solely to make the tests convenient.

## Evidence and rejected shortcuts

[Native CIRAW evidence](../assets/camera-delivery-review/highlight-recovery/README.md)
records the sole-toggle comparison, all native crops and independent visual review.
Recovery removes the candle's false magenta and preserves the orange panel, but its
flame core remains flat at reduced exposure. That historical delivery set was rejected;
the integrated correction and remaining acceptance boundary are recorded in C below.

The [exact upstream LibRaw spatial experiment](../assets/camera-delivery-review/libraw-spatial-recovery/README.md)
isolates recovery from common
integer staging. Modes 3/5/9 improve the candle and preserve the orange panel relative
to that baseline. Staging itself clips samples retained by current float processing;
do not confuse improvement against the staged baseline with a lossless integration.
Its permanent measurements preserve that distinction; its quarter images are not
native photographic acceptance.

Simple highlight blending desaturated genuine unclipped colored lights. A hard
sensor-clipping gate produced mottled panel boundaries. Both are rejected. Moving
WB before AHD or selecting CIRAW by default would change a separate input/selection
contract and requires its own measured proposal, not an implementation shortcut.

## Owners and invariant

LibRaw's wrapper owns unpacking, black subtraction, CFA-sensitive interpolation and
codec metadata. The Rust camera front owns levels, WB and the camera matrix. Recovery
belongs between that front's WB and matrix, on the native neighborhood before the
existing resampler. Preparation/matrix math must still have one owner.

The wrapper currently orients samples before returning them and clears orientation.
Upstream's spatial cells are aligned in its native decoder grid. Preserve sufficient
internal layout provenance to evaluate that same physical grid, then retain the
public oriented-image contract. Whether orientation is moved internally or represented
as an index transform is delegated; do not create two orientation implementations.

`wbPreApplied` prevents double white balance; it does not certify sensor saturation.
Any saturation reference must describe the actual representation supplied by the
codec. Complete-RGB Sony decoding cannot invent a sensor map from dimensions,
compression or unit WB gains. Keep detailed saturation metadata internal unless an
actual diagnostic consumer needs it.

The decoder boundary owns requested versus actual treatment. The graph's existing
recipe/execution identity owns cache separation. Neither a Rec.2020 label nor equal
pixel bytes establishes equivalent reconstruction method, frame or source quality.

## A — Representation-preserving native reconstruction

Native opt-in and its representation/resource/visual evidence are implemented in
the [portable checkpoint](../assets/camera-delivery-review/native-reconstruction/README.md).
The native checkpoint is opt-in; B owns ordinary adoption and C owns delivery. It
records exact disabled output, unsupported representations and remaining light-edge
artifacts rather than asserting complete photographic acceptance.

First make the portable operation measurable through the existing native decode
boundary, without changing ordinary rendering defaults yet. Extend the native owner
with an explicit treatment request consumed by a real decode path; do not land an
unused algorithm, metadata-only scaffold or second camera pipeline.
The consumer is the existing `@photoctl/img` decode wrapper with explicit opt-in.
Reconstruction is supported for requested scene-linear Rec.2020 output; combining it
with native camera-space output is an invalid request. Camera-space inspection keeps
its current unreconstructed meaning, avoiding a second WB-balanced camera contract.
Ordinary callers retain their current treatment until B.

Translate the vendored CDDL spatial ratio-map mechanism into the current floating
domain. Preserve current AHD-before-WB ordering and untouched samples by construction.
Retain above-white/fractional input instead of quantizing or clamping into ushort.
Compare with the exact upstream routine on representable inputs, and separately pin
the current float baseline on inputs integer staging cannot represent.
Disabled requests preserve the existing resample-before-front order at native, half
and quarter scales. Reconstructed requests recover before reduction but consume the
same preparation and matrix owners; sharing math does not require identical phase order.

Use upstream mode 3 as the initial bounded reference policy, not a user-facing strength
control. Its bounded propagation and missing-map behavior must be explicit and tested;
two fixtures agreeing across modes do not prove those modes equivalent. Any necessary
numerical/grid-edge divergence must be documented and tested against the intended
neighborhood behavior rather than silently called exact upstream parity.

Cover trustworthy CFA references and determine what reduced complete-RGB metadata
actually permits. If support is unavailable, return that fact instead of applying a
guessed clipping model. That status does not waive a defective required camera output.
Stop and reslice the responsible seam if fidelity requires changing AHD order, clipping
retained headroom, or accepting colored-light damage.

Red/green gates through native decode and the public adapter where practical:

- Disabled treatment preserves existing samples, headroom and orientation exactly.
- Float reconstruction preserves reliable regions and produces finite values without
  a blanket display clamp; thresholds derive from the reference domain, not magenta.
- Differential representable-input tests; unequal WB, above-white values, absent ratio
  evidence, clipped regions, borders, partial spatial cells, tiny images and bounded
  no-progress termination. Grid/orientation tests must expose non-divisible dimensions.
- Native/half/quarter behavior: reconstruction precedes reduction, with one WB/matrix.
- Saved candle, orange/red lights and reduced references; retain the striping regression.
- Measure native allocations and latency, including a quarter request's full-source cost.

Review native detail and ordinary/minus-two-EV views. The visual variable is false
highlight color and preservation of genuine lights, not tone matching or lost texture.
Run compare-screenshots, then unprimed screenshot-critique. A passing primitive is
not whole-camera acceptance; follow immediately with B.

## B — One effective policy, diagnostics and identity

The decoder/diagnostic boundary is implemented: `decode` exposes an explicit
reconstruction override, reports requested versus actual treatment, and rejects a
probe/result disagreement before TIFF publication. Both normal and disabled public
oracle paths retain the same G4 threshold and exclusions. Repeated oracle runs keep
their prior TIFFs and measured evidence. Ordinary graph rendering now explicitly
requests reconstruction. Its canonical candle floats match A's reviewed native
reconstructed bytes, while an untouched overview stays on the cheap JPEG path.

The existing execution table carries nullable `source_treatment`; NULL means unknown,
not disabled or applied. Actual treatment follows the base source through deterministic
descendants, retained execution reads, graph inspection and preview metadata. It
includes adapter identity/version separately from method and scale, because equal
pixels do not establish interchangeable decoder provenance. Online preview reuse
requires the planned treatment; offline reuse reports the retained actual treatment.
The renderer semantic revision separates corrected ordinary artifacts without
changing logical identity on disconnect/reconnect. No library reset or product
migration is introduced.

Online graph evaluation still reads and hashes actual source pixels before execution
reuse. Matching treatment alone must not become a shortcut around that check: a
source may have changed at its locator. Retained-only fallback selects verified
current pixels by its existing quality rules and preserves their actual provenance.

B verification is green through real ordinary RAW float output, cheap-overview and
offline/reconnect public journeys, treatment-separated equal-pixel executions,
unknown-treatment falsification, existing retained-cache rejection, and non-vacuous
generated/upscale journeys that preserve paid execution/attempt/artifact records
without provider replay. Both public G4 modes retain their thresholds. The independent
review (`01a075a2-c866-7542-b727-a402428b4c90`) requested an upgrade migration; that
suggestion is deliberately not adopted under the approved clean-start development
cutover. Existing-library verification remains C's explicit scratch-only setup, not
an automatic reset or backfill. Photographic acceptance is still C, including A's
documented residual highlight edges.

Root integration rebuilt and packaged the Swift helper and built all TypeScript
workspaces. The merged boundary/safety/preview selection passed 55 tests; the
graph, retained export, preview coordinator and generated/upscale consumer selection
passed 54. Both public G4 modes plus the real CIRAW helper passed three macOS tests
with unchanged thresholds and exclusions. These are focused integration checks,
not the whole-spec closeout or C's photographic verdict. A further merged
protocol/hash/workbench CLI selection passed 15 tests; it does not replace a
browser presentation check.

The decoder owns source-specific admission and method identity; the protocol's
[`sourceTreatmentSchema`](../../../packages/protocol/src/treatment.ts) owns the
transported value. CIRAW reads the enabled state back from the framework; its scale
belongs to that treatment because the measured scaled operation is not equivalent
to portable native recovery followed by resize. File decoding reports not-applicable,
including explicitly selected files and warned offline fallback. The existing
linear-16 TIFF output clips/quantizes scene floats for inspection; it is not evidence
that above-one scene headroom was retained. Canonical float evidence owns that proof.

Thread the settled request through the existing decoder options and results, helper
wire shape, graph source and explicit `decode` command. Names/internal decomposition
are delegated. The contract distinguishes applied, disabled, unsupported and
not-applicable treatment, plus the actual method/revision. Applied means the algorithm
ran, not that at least one pixel changed. Do not add a persistent recovery setting or
new table merely for a fixed default and an explicit diagnostic override.

CIRAW honors the request only when supported and reports its actual state. All other
neutral controls remain fixed. Compare its native and scaled behavior before claiming
equivalence to native-then-resample; preserve the decoder's method identity rather than
pretend its algorithm is the portable kernel. File/JPEG decoding is not applicable.

Plan effective treatment before cache lookup; a runtime result must agree with the
identity under which it is published. Use existing renderer semantic revision and
source-specific capability from the existing decoder probe/planning seam, including
valid saturation provenance or CIRAW recovery support. Do not first discover an
unsupported treatment after lookup under an applied-treatment identity. Use existing
source execution provenance, not an independent cache policy. Advance identity for
corrected ordinary RAW output while preserving old artifacts, edits and paid history.
Explicit diagnostic requests must not silently select JPEG fallback or replay a paid
operation. Unsupported reconstruction remains RAW-led and visibly reported, not a
reason to switch source kind or claim the photo is deliverable.

Verify public on/off selection, actual method/status, incapable adapters, file images,
old-derived-cache rejection, retained-output identity, reconnect and no double recovery.
Document linear-16 output limits; use existing float evidence to prove scene headroom.
Run both the unchanged unreconstructed oracle and the new normal path through the
same existing G4 thresholds/exclusions. Never move the default regression exclusively
to diagnostic mode to conceal changed normal behavior.

## C — Complete RAW-led delivery acceptance

The [preserved-library comparison](../assets/camera-delivery-review/integrated-gold/README.md)
accepts the conspicuous highlight-color correction within its recorded scope. Keep
the ten-delivery judgment, all-reference coverage, unchanged history and installed
runtime gates separate. A fixture library with no paid attempts cannot prove paid
history retention, and a local run cannot close G3 or physical-card acceptance.

The [all-reference witness](../assets/camera-delivery-review/integrated-reconstruction-allrefs/README.md)
completes native public view/export coverage for all 18 retained RAW-led pairs,
with all 36 original hashes unchanged and all 86 captures inspected by root and
an independent PNG-only reviewer. Seventeen sources report applied recovery;
the unsupported reduced complete-RGB source remains RAW-led. The bounded same-RAW
comparison below isolates remaining branch/wire fringes and portrait-highlight chroma;
do not rerun the breadth capture to answer the same question.

That [causal comparison](../assets/camera-delivery-review/residual-causal/README.md)
is now complete: the branch, nose and lower-wire regions have exactly unchanged
scene floats. The changing upper sky is less pink, without apparent new contour
damage. Root and a fresh reviewer inspected all 18 controlled images; the merged
capture and source hashes verify. Keep the improvement, and investigate the
remaining preexisting edge/noise concerns at the neutral decoder/color boundary
before proposing a distinct fidelity change. This does not certify general RAW
fidelity or close external release gates.

The [neutral-decoder comparison](../assets/camera-delivery-review/neutral-decoder-residuals/README.md)
also preserves the broad branch contours in CIRAW and in LibRaw camera-green
before WB/matrix. It does not identify an optical cause. Fine chroma differs,
and equal raster sizes conceal displaced scene content. All sixteen captures
were inspected independently and by root, with merged hashes verified.

The [compiled coordinate witness](../assets/camera-delivery-review/coordinate-metadata/README.md)
confirms the recorded inset origin (44,30) and 4608×3072 extent, including both live
and saved LibRaw margins. CIRAW exposes that output extent too, but its internal
scene mapping remains opaque. No crop defect is established. Isolate any
reproducible chromatic-edge defect in its actual owner. Do not rerun the broad
reference capture, treat CIRAW as pixel truth, or change interpolation/WB order
without an owner-specific regression and representation-preserving proposal.
The accepted highlight correction is not reopened by artifacts that predate it.

Metadata collection is complete within that boundary; do not repeat it as the
next task. Existing G4 dimension equality and patch means do not establish registration; inventing
expected coordinates from either decoder would not be an honest regression.

The [sole-interpolator experiment](../assets/camera-delivery-review/interpolation-owner/README.md)
now isolates interpolation's contribution using identical CFA input and an exact
production-baseline match. A sharper known-neutral control exposes invented chroma;
bilinear reduces it but softens photographic detail and is not accepted as a replacement.
The next proposal must improve chroma without hiding the defect through blur, preserve
measured samples/headroom and earn an owner-specific regression. Do not repeat this
comparison or infer a WB-order/default-decoder change from it.

The [balanced-working-channel experiment](../assets/camera-delivery-review/normalized-interpolation/README.md)
supports that narrower correction: normalize only the AHD working buffer, undo into
float camera samples and restore measured CFA sites exactly. The common camera front
retains WB/matrix ownership. Real decoder-input red/green regressions now cover
color/detail and above-white preservation. The rebuilt decoder matches the reviewed
experimental camera pixels; focused normal-rendering, derived-cache separation and
both unchanged G4 modes pass. Current ordinary photographic delivery and installed
package verification are recorded in the [integrated delivery review](../assets/camera-delivery-review/balanced-delivery/README.md):
all 18 saved references have current RAW-led exports and native details, with retained
history/source integrity and installed pairing checks. The bounded false-color
improvement is accepted; remaining broad fringes, clipped-light edges and release
boundaries are explicit. The subsequent [complete installed gate](14-gold-exam-and-release.md#portable-gold-evidence)
passes all nine cases with this decoder. That closes current fixture-package verification,
not C's complete photographic verdict or the external release gates.
This distinct decoder-fidelity revision changes interpolated samples in both recovery
modes. Earlier disabled-output hashes remain historical evidence for the recovery
toggle, not a requirement to retain defective interpolation forever.

C must conclude per defect, not repeatedly reject everything because lights are
clipped. Flat cores where channels were lost are not themselves a failed correction.
The [current-set verdict](../assets/camera-delivery-review/balanced-delivery/final-verdict.md)
now records that per-defect judgment across every saved reference. Candle/bridge
highlight boundaries are the next causal target; the review is complete, but C
remains open. The linked current edge samples exclude recovery at sampled bridge
pixels. The candle's full-frame, hash-matched preset probe accounts for only part of
the delivery difference; match retained canonical pixels and the actual output path
before assigning the remainder to encoding or proposing another fidelity change.
New or exaggerated colored rims or serrated transitions require a bounded causal
comparison followed by a separately verifiable fidelity pass. Uncertain optical
versus decoder origin stays a named uncertainty, not an inferred success. Interior
highlight edges must not be attributed to incomplete spatial cells at image borders
without evidence linking those distinct regions.

Run the unchanged gold script against the retained fixture library with its old caches
still present. Verify source identities, reports, decoded output files and all ten
deliveries, then inspect native details of the previously rejected lights/sky. Check
all 18 saved RAW references across observed format/crop/orientation groups, including
skin, shadows, fine edges and genuine colored lights. Camera JPEGs provide scene
context, not exact RAW pixel targets.

Keep G2, G3's unresolved headless-host boundary, G4, reduced-RGB correctness, pairing,
source promotion and retained-history behavior honest. Exercise the integrated native
build and installed package; workflow wiring is not acceptance. Resource measurements
must report full-source reconstruction cost, not only resized output buffers.
Native false-color review cannot be replaced by quarter-resolution crops or a magenta
pixel count. compare-screenshots telemetry is diagnostic; finish with unprimed
screenshot-critique and an explicit photographic verdict on actual deliveries.

Use write-tests before behavior edits; review/refactor-clean/code-review/write-docs and
audit-choices before each focused commit. Human image checkpoints are non-blocking:
open the relevant pair, allow about five minutes while other work continues, record
the evidence-based decision if silent, and close only the images opened for that check.
The whole-spec root closeout gate remains a final integration gate, not a feedback loop.

## Draft synthesis

Three fresh independent drafts covered fewest slices, risk-first and seam quality.
All rejected integer staging as a silent substitute, placed spatial work before
downsampling and required actual treatment in cache identity. This ladder combines
their smaller metadata/kernel/phase proposals into one useful native decode pass,
then one public-policy pass and one delivery gate. It keeps the risk-first stop before
policy adoption, the seam draft's physical-grid warning and the minimal draft's
single camera-front owner. A new public float format and a recovery-strength knob
are not required by the present diagnostic contract and are not added speculatively.
