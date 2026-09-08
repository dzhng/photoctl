# Outpaint layer-state review

The missing duplicate/clear, overlap-order, arbitrary-rotation and post-authoring
movement states now have retained captures. Geometry and exact restoration agree
with the authored-support contract. The initial public JPEGs visibly bleed border
colors; the correction below preserves their color separation without claiming
lossless previews or photographic-generation acceptance.

## Evidence boundary

[All captured images](outpaint-states/) retain the complete public/canonical set.
[Compact, hash-bound evidence](outpaint-state-evidence.json) records each state
and the matched controls; its original scratch image paths map to the same
scenario/filename beneath that directory. The complete runtime evidence is retained at
`/private/tmp/photoctl-outpaint-visual-completion.iADAiu/`:
`evidence.json` owns the commands, state frames, checks and image hashes;
`comparison.json` owns matched-state differences; `encoding-probe.json` owns the
matched encoding controls. Preserve this directory until its acceptance work is
complete. The capture uses built public dispatch for layer mutations and native
show, with production artifact publication for synthetic borders. It is not a
real CLI-process, packaged-install or photographic-generation witness.

The four isolated libraries completed 18 states and 32 geometric/pixel checks.
All 238 saved image size/hash records and five runtime/report bindings verify.
Sources remain unchanged and all library handles closed. The images are tiny
native rasters (6–14 pixels across), displayed at exact nearest-neighbor 20×;
this framing reveals individual pixels, not photographic-scale seam quality.

## Visual verdict and diagnosis

The main reviewer inspected every public and canonical full-frame 20× image
(36 images). The fresh reviewer independently inspected all 220 PNGs, including
native frames, all enlargements, every corner detail and the four sources.
Both saw strong public red/blue mixing and softened boundaries. Canonical images
retain distinct border colors. The fresh reviewer also flagged black holes and
apparent clipping for intent verification rather than declaring them defects.

Black holes follow the specified vacated-support policy: moving a border does
not reveal excluded source pixels or move a later border. The rotated border
moves independently of the stationary source. Reorder changes overlap paint,
not authoring chronology. Duplicate and survivor match the initial border;
clear restores the source crop. Rotation restoration and restoration of the
earlier border after a later border exists are exact in both canonical floats
and decoded public PNG bytes. These results support geometry, not codec fidelity.

All 18 public JPEGs are byte-for-byte reproducible from the saved canonical
display pixels through the existing native-preview encoder: quality 88,
4:2:0 chroma sampling and the bundled sRGB profile. The observed difference is
therefore in that encoding path, not a second compositing result. A same-quality
4:4:4 control reduces numeric color error but has not received visual acceptance.
No production default, quality threshold or photographic acceptance changed.

## Preview correction

New pinned import previews, rendered masters and derived detail views retain
full-resolution color samples. JPEG quality, dimensions, profiles, canonical
pixels and public response shapes are unchanged. Existing caches remain readable;
this is not a forced cache upgrade or purge. Older cached images keep their
appearance until ordinary regeneration.

[Corrected public captures](outpaint-states-corrected/) and
[matched evidence](outpaint-preview-correction.json) retain B for all 18 states.
A and target map to the public and canonical images in the original capture set.
The complete scratch set, including duplicate A/target renditions, remains at
`/private/tmp/photoctl-outpaint-preview-candidate.DjDbb1/`.
The candidate exercises production native preview materialization from each saved
canonical image and exact frame, with fresh caches. It does not replay CLI/layer
mutations or establish new importer photographic quality.

All 18 candidates differ from A while retaining the same canonical float hashes
and frames. RGB mean absolute error against the lossless target decreases in
every state; for blue-front it changes from 58.17 to 5.11 code values, and for
red-front from 51.95 to 4.14. Total JPEG bytes increase from 61,404 to 62,581
(1.92%); tiny synthetic fixtures cannot predict photographic file-size cost.
All original 238 images remain unchanged.

Main review inspected all 18 B full-frame 20× images against the previously viewed
A/target set. The fresh reviewer inspected all 324 supplied PNGs, including every
A/B/target native frame, enlargement and corner crop, and judged B closer in every
state. Geometry, clipping, source placement, reorder and restoration remain
consistent with the target. Residual fill mottling and colored cells near black
boundaries remain visible at 20×. This is an accepted color-separation improvement,
not a claim that lossy encoding preserves every color exactly.

The new behavior tests failed before correction at each of the master, derived
detail and pinned-preview encoders, then passed after correction. The five focused
preview/import/show files pass all 34 tests; typechecking and focused lint pass.
Existing exact-encoding checks use the corrected sampling while preserving their
geometry/resampling assertions. No full-suite repeat was used as a feedback loop.
The human checkpoint was shown inline; unrelated Preview documents were untouched.
Whole-spec release and photographic acceptance remain separate.
