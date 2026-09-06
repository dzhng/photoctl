# Camera-reference delivery quality

The permanent camera originals are sufficient to reproduce these failures without
reconnecting the camera. This checkpoint separates successful command execution
from photographic deliverability: **the inspected delivery set is rejected**.

The [integrated recovery comparison](integrated-gold/README.md) now accepts removal
of the conspicuous magenta cores against that historical set. Complete acceptance
remains open for classification of residual fine-detail issues. The
[all-reference review](integrated-reconstruction-allrefs/README.md) now covers
all 18 pairs at native size with source integrity verified. The
[controlled toggle comparison](residual-causal/README.md) excludes reconstruction
for the reported branch, nose and lower-wire artifacts. Their remaining origin
belongs to a separate decoder-fidelity investigation, not another breadth rerun.
The [neutral-decoder comparison](neutral-decoder-residuals/README.md) finds shared
branch structure and differing fine chroma, but also differing scene placement
despite equal raster dimensions. The [coordinate witness](coordinate-metadata/README.md)
does not establish a crop bug. The [interpolation experiment](interpolation-owner/README.md)
isolates a fine-chroma/detail tradeoff and rejects bilinear. The
[balanced interpolation correction](normalized-interpolation/README.md) now passes
native and focused integration checks, with the rebuilt decoder matching its reviewed
experimental camera pixels. The [current delivery review](balanced-delivery/README.md)
covers the ten-image gold run, remaining eight references and native portrait details.
It accepts the bounded interpolation improvement and preserves residual uncertainties;
it is not the complete installed, physical-card or whole-spec release gate.

## Reproduction and evidence boundary

On 2026-09-06, the built CLI at `89811b3` ran the unchanged `scripts/gold-exam.sh`
against `fixtures/camera` with `--source-kind fixture`, an isolated manual-embedding
library, linked originals, and no daemon or live provider. It imported 18 logical
RAW/JPEG pairs, rated ten, applied the people preset to three, and exported ten
profiled JPEGs without failures or skipped deliveries. The report's photographic
acceptance remains `not_recorded`; it does not encode this subsequent review.

The original run is at `/private/tmp/photoctl-camera-reference-gold.cc9Ux2`.
Its delivery manifest verified all ten JPEGs and both reports. The SHA-256 of
`gold-exam-report.json` is
`48953fdebc8fc3569dd6afd2e7837f10e129260ac19d7c52ca5927e44f4c182e`.
This is local permanent-fixture evidence, not the prescribed mounted-drive exam,
an installed release gate, or a claim that every card image decodes correctly.

Explicit camera-JPEG show and export also succeeded for the differing-resolution
DSC00103 pair: the JPEG is 7008×4672 and names its own original identity; the
RAW-led delivery is 3504×2336. All 36 saved originals were independently rehashed
against their manifests after the run, with no mismatch.

## Visual result and next requirement

Main inspection and a fresh, unprimed reviewer inspected the complete ten-image
delivery set. Native-detail crops enlarged two times exposed defects hidden by
overview downsampling. The reviewer also compared matching camera JPEGs; those
establish scene context, not an exact RAW-processing or exposure baseline.

- Bright lights, flame and reflections have flat artificial pink/magenta cores in
  DSC00104, DSC00107, DSC00122, DSC00442 and DSC07730.
- DSC00434 has pink/cyan bright-sky patches rather than neutral cloud highlights.
- DSC00103 has dense alternating vertical red/dark stripes and thin yellow-green
  edge contamination at native detail, with a strong overall color mismatch.
- Minor colored fringes in DSC00290 deserve later inspection; optical versus
  decoder origin is not established. Subdued exposure in DSC07633 and DSC07668
  alone is not a rendering defect. All ten are recognizable and correctly oriented.

The retained [stripe crop](DSC00103-crop.png) and
[highlight crop](DSC00107-crop.png) are diagnostic excerpts, not the complete
capture set supplied to the reviewer. No image has been accepted merely because
it is nonblank, carries a profile, or matches a hash.

The decoder-boundary experiments below isolate the failure and the native opt-in
checkpoint now supplies a bounded correction. Effective public treatment and cache
identity and the complete reference review are integrated. The reconstruction toggle
and interpolation experiments above own the remaining causal evidence. Do not hide a decoder defect with preset tuning,
switch every RAW to its companion JPEG, or weaken the decoder oracle. Add a
behavioral regression before correcting the responsible owner, then rerender and
inspect the complete set plus native details. Until that passes, the camera
workflow is not photographically accepted.

## Reduced-RGB decoder correction

Sony reduced YCbCr RAW already contains complete RGB pixels. The LibRaw wrapper
must respect the decoder's absence of a color-filter array before invoking Bayer
interpolation; filenames, compression tags and image dimensions cannot own that
decision. The existing white-balance metadata and camera-space interface remain
unchanged. The [LibRaw boundary](../../../../crates/libraw-sys/README.md) owns this
invariant.

The native-resolution regression reads an illuminated label patch in DSC00103.
Before correction, 200 of its 400 green samples were exactly zero in alternating
columns; after correction none are zero (range 3018–5523). Its first green row
changes from `[3018,0,3195,0,3455,0,3587,0,4087,0]` to
`[3287,3176,3146,3283,3471,3411,3461,3859,4096,4219]`. The test failed at
`(2201,900)` with unconditional interpolation and passed after respecting the
decoded format. All three LibRaw Rust tests pass, including the existing full
Bayer decode. The native addon was rebuilt and directly exercised; an independent
Codex review found no actionable issues.

The retained `reduced-{before,after}-{full,detail}.png` images use identical
native input, shared scene/display conversion and bounded PNG encoding, with no
develop adjustments. Full views are quarter-sized; detail crops retain native
samples enlarged twice with nearest-neighbor sampling. Mean absolute RGB delta
is 8.324/255 in the overview and 50.371/255 in detail, proving the corrected path
changed actual pixels. Native detail no longer shows the alternating red/dark
columns. Independent visual review `01a074ff-1d27-7f20-b7a4-c1b14ff2b8a1` inspected
all four images and confirmed coherent detail was restored rather than hidden;
moderate softness, low-light noise and slight color fringing remain. Main inspection
agrees with this scoped improvement.

The integrated unchanged gold script reran against the same library with its old
derived artifacts still present. All ten deliveries succeeded without skips, and
their full manifest verified. The new report is under
`/private/tmp/photoctl-camera-reference-gold.cc9Ux2/decoder-corrected-delivery` with
SHA-256 `5d7cba3931621018cdbaba6422d1dba9695ef1eae39ae6dcbdc80955ca53cdb7`.
Only DSC00103's JPEG bytes changed; the other nine are byte-identical to the
previously inspected set. Its new JPEG hash is
`698ee568e7d9e8c6606ee3a1a2d9dbfa7c57af61807666aae515dfd1ffdefc41`.
Main inspection confirms the public delivery now has coherent warm colors and
detail. The shared renderer semantic identity was advanced so stale deterministic
RAW outputs are bypassed without deleting history or replaying paid generation.
The rebuilt macOS addon hash is
`8b07dbac0a76ca0ff10c0a9486f56d72497444a6055779ea8bfcc9b401ed3c55`.
Twenty-four merged render-identity and retained-export checks pass, including
obsolete-output rejection; TypeScript build and typecheck also pass.

Highlight reconstruction is outside
this correction and the overall delivery checkpoint remains rejected.

The [native recovery experiment](highlight-recovery/README.md) preserves the
complete CIRAW comparison and independent review. It removes false highlight
color on two saved originals without visibly whitening genuine orange/red lights;
it does not restore lost texture or establish a portable production correction.

The [upstream LibRaw spatial comparison](libraw-spatial-recovery/README.md)
preserves the portable-algorithm experiment, including its integer-staging losses.
Its quarter-resolution captures are not native photographic acceptance.

The [portable native checkpoint](native-reconstruction/README.md) accepts opt-in
floating-point reconstruction for false-magenta cores while retaining disabled
output exactly. Ordinary rendering now adopts the explicit treatment policy. Residual light-edge
defects and complete delivery acceptance remain open under the
[reconstruction plan](../../slices/07-highlight-reconstruction.md).

## Preserved pre-policy library

The [pre-policy snapshot](pre-policy-snapshot.json) pins the existing disposable gold
library before default reconstruction and treatment provenance change. Its complete
local snapshot retains original identities, ratings, edits, revisions and execution
rows. All 15 canonical artifacts and 19 cache files were read and rehashed; none was
deleted to prepare the next run. This library contains no provider attempts, so it
cannot prove paid-history retention; that needs a separate paid-fixture witness.

If the next fresh schema adds treatment provenance, the acceptance setup may add that
nullable field only to this identified disposable library, leaving historical values
unknown. This is explicit test preparation, not a shipped migration, inferred backfill
or permission to reset a real library. The unchanged gold script must then exercise
new rendering while historical rows and bytes remain available for comparison.
