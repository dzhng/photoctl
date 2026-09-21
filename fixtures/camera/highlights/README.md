# Camera JPEG highlight references

These originals were copied byte-for-byte from the owner's Desktop/examples on
2026-09-21 with permission to retain them as project fixtures. SHA-256 manifests
sit beside the originals; JPEG manifests use `.JPG.json`. No relicensing is implied.
The camera JPEG is an independent camera rendition, not a decoder output. The
owner's target is preserving visible RAW highlight separation, including where
the camera JPEG blends sky and walls together. Matching that JPEG is not acceptance.

| File | What it establishes |
|---|---|
| `DSC00225.ARW` | Lossless Sony RAW of shaded palms, a pedestrian and bright background; retains the source for investigating highlight rendering. |
| `DSC00225.JPG` | Original camera rendering of that scene, including already-white sky and bright wall areas. |
| `DSC00229.ARW` | Lossless portrait-oriented Sony RAW of sunlit foliage and colored buildings; separates bright leaf rendering from shaded midtones. |
| `DSC00229.JPG` | Original camera rendering and orientation reference for that scene. |

Both RAWs have a 7008×4672 default crop. Apply orientation before comparing;
the second photo is displayed at 4672×7008. Retain the encoded originals unchanged.

The selected [CIRAW renditions](references/README.md) preserve the owner's chosen
highlight rendering target. Their generation conditions and fingerprints live
with the references.

These are visual references, not portable pixel-exact expectations. Apple's
decoder can change across OS versions. A white area in a JPEG alone cannot prove
sensor saturation or whether detail can be recovered.
