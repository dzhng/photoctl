# Outpaint preparation and activation evidence

Target: retain the selected photographic input in a centered exterior-only frame; generated pixels
may replace only that exterior. A is crop `(2,1,4,3)` plus a quarter-turn, B is untouched. The
provider returns a constant blue fixture, not photographic completion. Translated captures exercise
the existing border placement owner, including its moving hole and preserved source exclusions.

The complete set contains both native images and nearest-neighbor 4× views. Public dispatch drives
real multipart HTTP, native rendering, show and lossless export. The tests own the exact assertions;
these captures provide independent visual evidence, not a replacement for those assertions.

## Measured relationships

- A is 7×8; exactly 44 of 56 input pixels change in export. B is 12×10; exactly 72 of 120 change.
  These are precisely their exterior rings; all interior wire-input pixels copy unchanged.
- Original source versus prepared input differs by at most one byte level in either case, with A
  compared under its specified crop and rotation and B under identity placement.
- The deliberately flat exterior occupies 78.57% of A and 60% of B. Low image entropy here reflects
  the fixture, not missing scene content. The mask has the same support and opposite interior.
- Native JPEG previews visibly lose detail at these tiny dimensions: maximum channel differences
  from lossless export are 88 (A) and 94 (B). These previews are not pixel-fidelity evidence.
- Translation moves the border four view pixels right (catalog `dy=-4` after A's rotation,
  `dx=4` for B). Export retains a non-overlapped source landmark and the far native blue edge,
  without a provider replay. The relocated transparent hole remains black where source is excluded.

The comparison skill's bundled helper could not resolve `pngjs`; decoded Sharp pixel probes supplied
the bounded metrics instead. No dependency or product comparison code was added.

## Independent critique

Image-only session `01a07440-901c-7490-9b9a-f021c12cf0d4` inspected all initial 20 native/zoom images.
It confirmed mask alignment, exact input-to-export preservation and faithful nearest-neighbor zooms.
It flagged hard blue seams and degraded previews, both visibly real. Those are respectively the
synthetic provider fixture and the existing lossy preview codec; neither supports a model-quality
claim. Its claimed B axis swap is contradicted by decoded source rows (red increases in x, green in
y) and the full identity comparison above. A's changed orientation is the requested crop/quarter-turn,
not an unintended mirror. The reviewer was not told these intended relationships in advance.

The same image-only session subsequently inspected the four translated captures. It correctly
described sharp blue occlusion, partial visible original columns and uncovered black regions. These
are the existing border-placement contract: the moved opaque ring may overlap the source, while
its moved hole reveals original pixels only where authored support admits them. A partially black
visible hole is not a truncated mask. The critic repeated its source-axis claim despite decoded
bytes: source `(1,0)=[32,0,64]` and `(0,1)=[0,32,64]`; that claim is rejected on direct evidence.
All 24 native/zoom captures were supplied, including these disputed states.

The acceptance is therefore limited to geometry, wire coverage, lossless preservation and atomic
activation. General photographic quality, full-resolution outpaint resource acceptance and the
complete packed CLI journey remain outside this checkpoint. The refresh/retry follow-up below
adds behavior evidence without extending the original visual-quality claim.

## Code and failure checks

Independent code review `01a07440-20dd-7552-ac0c-8e83ce64096a` found four actionable issues:
the no-op protocol variant, paid-attempt finalization after publication failure, duplicate exterior
mask allocation/publication, and duplicated growth limits. All were corrected; targeted re-review
returned no actionable findings. A real artifact-path obstruction proves the paid original remains
retained while the attempt becomes failed and no document is activated. No internal publication
mock substitutes for the filesystem failure.

The final focused run passes 14 outpaint/canvas/compositor cases. Adjacent storage, ordinary fill
refresh/sampling, existing canvas, clean migration and schema-21 fixture checks also pass. Two
sampling cases first exceeded their existing five-second limit during a parallel run, then passed
alone without changing that limit. Typecheck, formatting and lint pass; sequential-flow lint warnings
remain unsuppressed. The root release/resource gate is separate and is not certified by this pass.

## Refresh and pinned retry follow-up

Public command tests exercise current exposure, fixed crop/rotation, moved placement, removed
predecessor support, current predecessor opacity/enabled state, exclusion of later reordered paint,
failed preparation reuse and a revision conflict during a provider request. Density-only refresh
and retry retain the same generation; retry recovers a failed upscaler without growing the canvas.
Mismatched prompt or exterior-mask fitting leaves the active snapshot unchanged.

The real `DSC08819.JPG` witness copies the permanent camera file into a disposable test volume,
decodes its actual 4608×3072 source and then crops/rotates a 160×120 region. Both generation requests
use a 136×176 expanded raster and identical masks. An exposure reduction changes photographic
input while the protected exterior padding remains black. Deliberately substituting the original
pinned generation input for the current photographic plan makes this regression fail: both input
means remain 92.671493, instead of the refreshed input becoming darker. The production path is then
restored. This is an actual JPEG-source pipeline witness, not a full-frame resource or model-quality
claim. Its timeout is local to the full-source camera test; tiny lifecycle tests retain their normal
timeout.

The initial pinned-retry tracer was red at the explicit unsupported guard before implementation.
The free-fit rejection also went red on the silently ignored option before the contract was fixed.
The earlier refresh-only independent review reported no actionable issues; its sandbox could not
bind the HTTP fixture, so local scoped checks provide the execution evidence.

The restored final run passed 54 checks across the outpaint generation/refresh, ordinary fill
refresh/upscale and graph-store suites. TypeScript build, targeted formatting, lint and diff checks
passed (lint warnings remain). Independent review `01a0747b-8814-7093-88fe-a33b43e10a10` returned no
actionable findings on the complete refresh/retry diff. No root full-suite or release-resource gate
was run for this focused checkpoint.
