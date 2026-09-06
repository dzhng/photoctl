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
flame core remains flat at reduced exposure. The overall delivery set is still rejected.

The exact upstream LibRaw spatial experiment at
`/private/tmp/photoctl-libraw-recovery.UVyPRM/README.md` isolates recovery from common
integer staging. Modes 3/5/9 improve the candle and preserve the orange panel relative
to that baseline. Staging itself clips samples retained by current float processing;
do not confuse improvement against the staged baseline with a lossless integration.
Preserve its measured evidence before relying on the experiment for implementation.

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
