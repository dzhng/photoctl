# A7C II landscape: sky and paved path

This is the existing [a7c2 RAW](../../../a7c2.ARW), whose
[original manifest](../../../a7c2.json) owns camera provenance and authored coarse
selection bands. [source.png](source.png) is the exact 7008×4672 developed PNG
export produced by the built CLI before these masks were created. It is retained
because earlier research used the camera's embedded JPEG, which has different
pixels; the two renderings cannot support pixel-parity claims. The historical
[embedded JPEG](source-embedded.jpg) is also retained as a distinct source
variant, extracted byte-for-byte from the existing RAW. Its decoded RGB matches
the source PNG used by the earlier experiment; no second large PNG is needed.

## Observed selections

| Selection | Prompt and intended exclusions | Retained result |
|---|---|---|
| Clear sky above the tree line | One positive base-image point at `[4000,600]`; sky should exclude wires, foliage, terrain and path. Exclusion sample points in the report were measurements, not negative decoder prompts. | [Alpha16](observed/sky-alpha16.png), [overlay overview](review/sky-overlay-overview.png), [wire detail](review/sky-wires-overlay-2x.png), [foliage detail](review/sky-foliage-overlay-2x.png). |
| Continuous paved path | One positive base-image point at `[4400,3500]`; exclude sky and surrounding vegetation/terrain. | [Alpha16](observed/road-alpha16.png), [overlay overview](review/road-overlay-overview.png), [path detail](review/road-path-overlay-2x.png). |

These are actual built-CLI point selections with zero gateway calls. They are not
live text-grounding results. Wires and foliage are diagnostic regions within the
sky case, not independently evaluated wire-only or foliage-only selections.
All retained [review images](review/) come from the same developed source and
persisted candidate alpha, including readable source, alpha and overlay crops.

The [capture report](metadata/capture-report.json), [sky response](metadata/sky-response.json)
and [road response](metadata/road-response.json) retain CLI results, source
and mask hashes, authored area bands, actual sample values, candidate scores,
timing and the built-file fingerprints recorded after capture. Both selections
used score argmax, index 3 of four outputs. The recorded area measurements were
32.83% sky and 5.05% path; passing coarse bands is not proof of fine boundaries.
The [scene measurements](metadata/scene-metrics.json) describe presentation
structure and are not independent segmentation truth.

No ideal/reference alpha exists for this scene. The current developed-source
[evaluation](evaluation.md) finds broad selection useful but rejects fine-detail
quality: sky masks include wires and lose foliage gaps; path masks include fence
posts/rope and feather into grass. The distant path endpoint remains a
medium-confidence observation, not a separately verified crop finding.

The [earlier embedded-JPEG report](metadata/embedded-jpeg-report.json) belongs to
`source-embedded.jpg`, not to the retained CLI masks. Those historical selections
also failed fine-detail review, but neither their measurements nor their pixels
are interchangeable with this developed-source capture.

The [case manifest](manifest.json) records retained file identities. Alpha16 PNGs
are quantized views of saved f32 masks. Their canonical TIFF and raw f32 hashes
remain recorded, but those large files, encoder features, model weights and the
scratch library are not duplicated here. The preserved source and observations
can be reviewed without `/tmp`; reproducing inference still requires the pinned
model and recorded CLI rendering path.
