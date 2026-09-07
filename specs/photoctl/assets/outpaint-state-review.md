# Outpaint layer-state review

The missing duplicate/clear, overlap-order, arbitrary-rotation and post-authoring
movement states now have retained captures. Geometry and exact restoration agree
with the authored-support contract, but this is not a clean preview-quality pass:
the public JPEGs visibly bleed saturated border colors into neighboring pixels.

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

Next: assess the preview color-sampling correction through the public preview
contract and matched visual controls. Keep the complete current capture set as
the failing baseline; do not substitute lossless images for public previews.
The human Preview checkpoint is not claimed: Preview was occupied by unrelated
project documents, which were left untouched.
