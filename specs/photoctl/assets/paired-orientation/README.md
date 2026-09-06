# Paired-source orientation evidence

This checkpoint separates source selection and image geometry from photographic
rendering quality. A camera JPEG is an explicit rendition of one logical photo;
its dimensions and orientation belong to that original, even when the RAW differs.
The target is upright content with the same left/right landmarks across default
RAW, explicit camera-JPEG and independently imported JPEG viewing/export. Camera
processing is not a RAW color baseline.

## Public fixture journey

[The evidence](evidence.json) retains every command envelope, original membership,
source IDs, export hashes, source-manifest comparisons and crop coordinates. The
journey used the actual built CLI and native addon from root commit
`270c4dcca7f4b1d4f514174d7dcb7bacde213abd`; their byte hashes are recorded separately.
It ran against fresh scratch libraries/cache and copies of the permanent references.
The evidence worktree began at `85a4643`; no product code or root runtime changed.

Directory import with the default policy admitted three photos containing six
originals. A separate JPEG-only directory admitted three standalone photos. Public
list/show and export identify RAW as each pair's primary, select JPEG only with
`--source camera-jpeg`, and identify JPEG as the standalone primary. All six source
files still match their committed SHA-256 manifests.

| Fixture | JPEG EXIF orientation | Displayed RAW dimensions | Displayed JPEG dimensions |
| --- | --- | --- | --- |
| DSC00103 | 1 | 3504 × 2336 | 7008 × 4672 |
| DSC09903 | 6 | 3072 × 4608 | 3072 × 4608 |
| DSC07730 | 8 | 4672 × 7008 | 4672 × 7008 |

For each fixture, explicit companion and independently imported JPEG exports have
identical complete PNG byte hashes. This is a cross-route equality check, not an
assertion that an exported PNG is the original JPEG byte stream. Default RAW
exports use different original IDs and visibly different processing.

## Geometry inspection

The PNG collection preserves all nine export overviews, nine public show previews
and nine native landmark crops. Overviews/show captures fit inside 1000 pixels;
detail crops retain native pixels at the normalized rectangles recorded in JSON.
Thus the unequal-resolution label has a proportionally larger JPEG detail crop.
Full-resolution PNG exports remain at the scratch paths recorded in the evidence.

Direct inspection of every capture found upright label characters, the same
right-facing foreground animal and the same tower/bridge placement. No source
selection introduced a mirror, quarter turn or missing scene region. RAW images
are darker/less saturated than the JPEGs; the JPEG label remains soft and the night
scene noisy. These are recorded visible differences, not pairing geometry failures
or a new photographic-quality acceptance.

Coordinate checks compare 96 × 96 grayscale reductions of the exported JPEG
against the original JPEG with its EXIF rotation applied. Mean absolute errors are
0.72, 0.48 and 0.83 out of 255 respectively; mirrored alternatives are 43.09, 47.34
and 18.88, and incorrect quarter turns range from 23.92 to 90.81. Show/export
reductions differ by 0.43–0.70. These coarse diagnostics distinguish orientation
from compression/resampling differences; native crops and full views own the
visible landmark judgment. They do not establish subpixel registration.

Root inspected all 27 captures. Independent unprimed review
`01a07585-efa5-7520-ad61-ab6aa9cb7934` inspected the same PNG-only collection and
completed without geometric findings. Both accept the bounded orientation/framing
contract; dark regions do not establish subpixel registration or RAW quality.
The two DSC09903 overviews were opened for a human checkpoint at 08:47:49 UTC on
2026-09-06. With no intervening visual feedback, the evidence-based geometry verdict
was retained after five minutes; only those two Preview documents were closed.

## Remaining boundaries

No workbench HTML was opened or rasterized, and no browser restriction was bypassed.
This closes neither membership-badge layout acceptance nor the exact mounted-camera
gold/packed journey. Fixture copies on the host disk cannot establish physical-card
disconnect/reconnect behavior. No full-suite, release or RAW photographic-quality
gate was rerun or claimed by this evidence pass.
