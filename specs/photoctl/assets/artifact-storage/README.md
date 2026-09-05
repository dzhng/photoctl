# Original response versus working pixels

The working graph needs exact scene-linear floating-point samples. Retaining a paid provider's original
encoded response answers a different question: can we recover exactly what the provider returned,
including encoding and metadata, without making another request? Re-encoding equivalent pixels is not
the same guarantee.

The [bounded measurement](format-measurement.json) uses the production artifact/color owners on three
opaque RGB8 PNG inputs. The photographic proxy is the committed A7C II fixture's 1616-pixel embedded
JPEG, reduced to a 1024-pixel long edge and encoded as PNG. The other inputs are the committed upscale
spike's synthetic source and flat fake output. No live image or user library was sent anywhere.

| Input | Original PNG bytes | Canonical float TIFF bytes | Additional bytes to retain original |
|---|---:|---:|---:|
| Photographic proxy, 1024×684 | 1,304,370 | 8,405,802 | 15.52% of working artifact |
| Synthetic texture, 320×240 | 11,816 | 922,410 | 1.28% |
| Flat fake output, 640×480 | 5,747 | 3,687,210 | 0.16% |

Every canonical TIFF survived decode/re-encode byte-for-byte. Converting it back to RGB8 changed zero
samples in these cases, but the photographic and synthetic PNG encodings were not byte-identical to
their inputs. Thus pixel round-trip success cannot justify claiming original-response retention.

For reproduction, use the fixture offsets in `fixtures/a7c2.json`, Sharp's default PNG encoding and
the source hashes/runtime versions in the report. Convert RGB8 samples to RGB16 by multiplying by 257;
call the [artifact owner](../../../../packages/render/src/artifacts/publication.ts)'s normalization,
decode the resulting float TIFF, then use the [color owner](../../../../packages/render/src/color.ts)
to convert to display sRGB and round/clamp to RGB8. Compare both sample values and encoded hashes.
The measurement script was temporary; no second production codec or publication path was introduced.

This supports retaining original response bytes unchanged, alongside—not instead of—the canonical
working artifact. The [implemented retention contract](../../slices/13-generative-extras-and-markup.md#paid-response-retention--shared-artifact-and-attempt-ownership)
reuses artifact publication, availability, execution provenance, and reachability rather than an
untracked response directory. This report is format evidence, not its implementation proof.
Historical responses whose original bytes were discarded cannot be reconstructed honestly or
silently purchased again.

These small opaque RGB8 examples do not settle alpha, HDR, wide-gamut, provider metadata, full-resolution
memory, or representative undo-history storage. Automatic canonical-artifact deletion stays disabled;
there is still no measured count/age/storage policy. The tiny flat fake's compression ratio must not be
used to estimate photographic libraries.
