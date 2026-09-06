# Camera reference originals

These are permanent, byte-for-byte development references supplied by the repository
owner from their Sony ILCE-7CM2 camera. They were copied, not moved, from the mounted
camera card on 2026-09-06. No license transfer or public-domain dedication is implied;
the owner explicitly authorized keeping the originals in this project.

The adjacent JSON files own measured hashes, RAW SubIFD dimensions, compression and
default crop. The original camera filenames are retained. `DSC00*.ARW` came from
`DCIM/101MSDCF`; the other files came from `DCIM/100MSDCF`, on the ExFAT volume with
UUID `0051C01F-A0CE-36FC-9386-477DA323CD33`.

| File | Development reference |
|---|---|
| `DSC07633.ARW` | Uncompressed landscape-oriented indoor portrait; skin, fabric and warm light. |
| `DSC07730.ARW` | Uncompressed portrait-oriented night city scene; deep shadows and point lights. |
| `DSC08142.ARW` | Full-resolution lossless sunset scene; sky gradients and saturated artificial lights. |
| `DSC08362.ARW` | Full-resolution lossless portrait-oriented glass and bokeh; shallow focus and highlights. |
| `DSC08541.ARW` | Reduced-resolution lossless restaurant interior; mixed lighting and window detail. |
| `DSC08819.ARW` | Reduced-resolution lossless coastal portrait; a person against waves and sky. |
| `DSC09148.ARW` | Full-resolution lossless mountain vista; distant detail and atmospheric contrast. |
| `DSC09314.ARW` | Reduced-resolution lossless woodland; dense fine branches against bright sky. |
| `DSC09797.ARW` | Reduced-resolution lossless wildlife scene; an animal amid foliage and road edges. |
| `DSC09903.ARW` | Reduced-resolution lossless portrait-oriented landscape; tree silhouette and textured terrain. |
| `DSC00122.ARW` | Lossy-compressed portrait-oriented night alley; shadow detail and small bright lights. |
| `DSC00290.ARW` | Full-resolution lossless outdoor full-body portrait; foliage, architecture and subject boundaries. |
| `DSC00434.ARW` | Full-resolution lossless street scene; perspective, fine structures and bright sky. |
| `DSC00442.ARW` | Full-resolution lossless indoor portrait; glass, skin and mixed artificial light. |
| `DSC07668.ARW` | Reduced-resolution uncompressed RAW decode, orientation 1. |
| `DSC00103.ARW` | Reduced RAW crop differs from its full-resolution JPEG companion. |
| `DSC00104.ARW` | Full-resolution lossy RAW decode, orientation 1. |
| `DSC00107.ARW` | Full-resolution lossy RAW decode, orientation 8. |
| `DSC07633.JPG` | Original camera JPEG companion: indoor portrait, EXIF orientation 1 and +08:00 capture time. |
| `DSC07730.JPG` | Original camera JPEG companion: full-resolution night scene, EXIF orientation 8. |
| `DSC08819.JPG` | Original camera JPEG companion: reduced-resolution coastal portrait, orientation 1. |
| `DSC09903.JPG` | Original camera JPEG companion: reduced-resolution landscape, EXIF orientation 6. |
| `DSC00122.JPG` | Original camera JPEG companion: high-ISO night alley, EXIF orientation 6. |
| `DSC00442.JPG` | Original camera JPEG companion: full-resolution mixed-light portrait, orientation 1. |

Every RAW listed above has its original matching JPEG, enabling independent
non-RAW ingestion and companion-membership checks for that scene and orientation.
[Card coverage](card-coverage.json) records the complete card's bounded metadata
inventory and maps every observed RAW storage/crop/compression/orientation group
to retained samples. It is not a whole-card pixel-decode or integrity check. The
`DSC00103` pair deliberately preserves differing RAW and JPEG resolutions; matching
capture identity must not require matching pixel dimensions. Newly acquired sample
bytes were SHA-256 checked against their card originals. Their format coverage is
measured; no photographic quality baseline is asserted.

JPEG companions remain next to their RAWs with the original matching stems, as on
the card. Their manifests use `.JPG.json` to avoid replacing the RAW manifests.
They preserve the camera's encoded pixels, EXIF, orientation and color declaration;
they are neither embedded RAW previews nor JPEGs produced by our renderer. This
lets the same assets exercise paired import and independent non-RAW workflows.
JPEG manifest dimensions describe stored pixels, before applying EXIF orientation.

Selection uses the camera's companion JPEGs to avoid near-duplicate bursts, not as
an independent RAW-decoding quality oracle. Small contact-sheet inspection cannot
certify critical focus, noise, fine subject edges or highlight recoverability.
Dark and shallow-focus frames are intentional stress cases, not failed captures.

These originals are intentionally separate from the small top-level decoder smoke
inventory. Tests and development journeys can explicitly select this directory;
merely committing it does not establish real-drive import, offline recovery, decoder
parity or segmentation acceptance. Those checks must run against the relevant files.

The existing manifest generator records only its known embedded-preview dimensions;
its `previews` list is not exhaustive for these reduced-resolution originals. RAW
SubIFD facts are independent of that preview filter. No decoded white-balance or
pixel baseline is asserted here. Preserve the originals and their hashes when adding
measured behavioral evidence; do not replace them with resized or re-encoded images.
