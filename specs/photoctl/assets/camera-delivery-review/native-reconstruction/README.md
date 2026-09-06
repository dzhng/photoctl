# Portable native reconstruction checkpoint

Explicit opt-in through `@photoctl/img` now reconstructs LibRaw RGB highlights on
the native decoder grid, before reduction. This checkpoint left ordinary requests
unreconstructed; the public-policy pass has since adopted recovery. This accepts a **less-wrong
false-color primitive**, not the complete photographic delivery set.

## Representation and ownership

The camera front retains one levels/WB/matrix owner. The spatial operation reads
that owner's balanced floating samples to build ratio maps, then changes only
eligible channels immediately before the same matrix. Reliable samples take the
identical arithmetic path; no full balanced RGB copy, ushort staging or display
clamp is introduced. The wrapper still returns oriented pixels and now retains an
affine address map back to its native grid, derived from LibRaw's own orientation
indices rather than another EXIF orientation implementation.

The CDDL translation follows vendored mode-3 cell seeding, weighted propagation,
neutral missing-map fallback and bounded termination. It uses floating sums/maps
and retains fractional reconstruction instead of truncating samples back to ushort.
Threshold metadata is mapped from the upstream reference domain, not derived from
observed magenta. This is not a claim of integer bit parity: a direct call to the
vendored routine for the test's representable 12×12 neighborhood returns
`[60000,35999,22285]`; the float result stays within one truncation quantum plus
0.001 quantum of numerical roundoff. The tests separately preserve fractional and
above-one values which the integer staging cannot represent.

Complete physical 4×4 cells preserve upstream alignment. Partial right/bottom cells
remain unchanged, as do frames with no complete cell. Tests exercise non-divisible
dimensions under all eight affine orientations with clipped partial edges. These
rules are explicit numerical-policy limits, not permission to ignore an eventual
visible edge defect.

Support requires three-color CFA data with a sensor-relative saturation reference.
Complete-RGB reduced Sony data and four-color CFA are unsupported; an opt-in still
decodes their RAW without reconstruction and reports that fact. A pre-applied-WB
flag is not a saturation map. No companion JPEG, migration, cache deletion or
adapter preference change is involved. The actual policy/method identity in graph
planning belongs to the integrated public-policy pass.

The native probe exposes `highlightReconstructionMethod` only when the same
metadata admission used by decoding supports reconstruction. An applied decode
returns that same method identifier alongside its actual treatment. Admission reads
the original finite positive WB gains, not the ordinary decoder's unit-WB fallback.
The `libraw-sys` metadata conversion owns this predicate for probe and decode.

The [LibRaw boundary](../../../../../crates/libraw-sys/README.md) and
[CDDL notice](../../../../../crates/photoctl-image/NOTICE) own decoder and
distribution constraints. Native tarballs include the translated source, attribution,
CDDL terms and source location; an installed-package check verifies their actual bytes.

## Evidence and resource boundary

The adjacent per-original JSON records native dimensions, complete float hashes,
changed-pixel counts, preserved reliable regions and native crop coordinates.
All three CFA scenes keep every pixel with scene luminance below 0.5 exactly;
the orange panel is exact. DSC00103's complete native float buffer is unchanged
and its request reports unsupported. These are measured scene witnesses, not a
universal colored-light or all-camera guarantee.

[Disabled baseline](disabled-baseline.json) compares separate processes loading the
pre-change root addon and this pass's addon: native, half and quarter output match
exactly for candle, sunset and reduced RGB. The pre-change addon SHA-256 was
`8b07dbac0a76ca0ff10c0a9486f56d72497444a6055779ea8bfcc9b401ed3c55`.
Public tests also compare recovered half/quarter samples to the existing resampler
applied to native recovered output, preventing downsample-before-recovery or double WB.

[Resource observations](resources.json) are three separate Node 24 processes per
candle treatment/scale on this Mac, using the release addon and warm filesystem
cache. Native reconstruction takes 0.907–0.919 s and peaks at 1.009 GB decimal RSS;
quarter takes 0.918–0.931 s and peaks at 1.034 GB, despite returning only 24.6 MB of
pixels. Disabled equivalents take 0.671–0.697 s. The two ratio maps add about
32.7 MB at this native size. The quarter request still pays full-source decode and
reconstruction cost. These are local observations below the approved 5 GB canary,
not a throughput guarantee or the SAM encoder gate.

## Visual judgment

The target is neutral clipped flame/lamp cores while preserving actual orange/red
lights, scene framing and reliable detail. `a` is disabled; `b` is reconstructed.
All 36 PNGs use identical source/controls and the same display conversion. Overviews
take every fourth native sample; named crops retain native samples. Minus-two-EV
views multiply returned scene floats by 0.25 before that conversion; no second
decode or JPEG substitution supplies their pixels.

[Comparison telemetry](comparison.json) covers all 18 pairs. It locates change, not
correctness: the normal flame crop has grayscale MAE 15.728/255 and distance 0.184;
orange and reduced-label pairs have zero distance. The implementer and integrating
agent directly inspected every image. Fresh reviewer `/root/native_highlight_visual`
(Gibbs the 2nd) inspected the full set, caught two misframed light crops, and then
reviewed all eight corrected light images. Their updated native coordinates contain
the actual changing lamps; no omitted-light acceptance claim remains.

The reconstructed cores are white at normal exposure and gray at minus two stops,
instead of broad magenta. Orange panel detail, red lights, grain and framing remain.
No new broad striping or blur is visible. **Flat cores remain flat; no lost texture
was restored.** Narrow pink/yellow fringes and the flame's dark serrated transition
remain visible at minus two stops. That residual edge behavior stays on the full
delivery acceptance checklist rather than being dismissed because the proxy count
passes.

The integrating agent opened both minus-two-EV flame crops in Preview at
06:07:25 UTC on 2026-09-06, and closed only those documents after five minutes
without user response. The non-blocking decision is to accept this opt-in primitive as
less wrong for false-magenta cores and proceed to public policy/identity and the
unchanged decoder/delivery gates. Whole-camera acceptance remains unproved.

## Verification and review

The public candle regression failed on the unchanged addon with 5,924 false-magenta
proxy pixels, then passed through opt-in decode. Disabling the reconstruction
application made all three synthetic tests fail for missing correction; restoring
it returned them to green. A large Buffer deep-comparison initially exhausted the
test runner's JS heap; byte equality now uses the buffer's bounded native comparison,
with the same exact assertion and no increased heap limit.

Independent code review `01a07550-3d8c-78c3-990f-fe159a2b5b60` found the four-color
admission defect. A direct C metadata-owner witness returned `3:1/4:1` before the
restriction and `3:1/4:0` afterward; it is a capability simulation, not a real
four-color photographic fixture. Integration review additionally caught the invalid
WB fallback risk. Admission is now consolidated in the Rust metadata conversion,
with a permanent test for absent/four-color CFA, codec WB, invalid levels and zero,
negative or non-finite gains in each RGB channel. Weakening its all-channel check
to any-channel failed the regression; the exact predicate was restored.
Final independent review `01a0756d-e075-7961-b381-63213ca846c1` found that the
translated source's license link assumed a checkout layout. Its notice now names
both the installed sibling license and source-tree location. No native arithmetic
or grid finding remained. Final focused gates passed: four LibRaw boundary tests,
76 native image tests, 19 public native/render consumer tests and the actual
installed native-package terms/source check. TypeScript workspace builds passed.
The installed-package check followed an initial missing-CDDL red tarball witness.
No root whole-spec gate was used as an iteration loop.

Integration with the exact-output affine sampler passed four LibRaw boundary tests,
78 native image tests and 17 decoder/color/reconstruction consumer tests. The merged
release addon and TypeScript workspace built successfully. A fresh actual pack and
installation passed the targeted native terms/source check; its six other installed
journeys were not selected, so this is not whole-release acceptance. The integrated
addon SHA-256 is `a585553d7a53dbde6aae7a3673bf507c1521e399f74c41002925bb3d53bacc5d`.
