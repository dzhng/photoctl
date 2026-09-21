# Reconstructed CIRAW as the RAW default

Automatic RAW previews and exports use Apple's CIRAW decoder with highlight
reconstruction. The goal is visible separation in bright scene regions, not
matching the camera JPEG. The camera JPEGs in this investigation merge some sky
and building highlights that remain distinguishable in the RAW.

## Why this choice

The owner preferred the neutral reconstructed CIRAW rendition after comparing
real camera photographs. RawTherapee's recovery rendering was also attractive,
but integrating its engine added more complexity than this product needs.
LibRaw remains an explicit diagnostic decoder; it is not an automatic fallback.

Highlight reconstruction repairs usable information from partially clipped
channels. Highlight compression changes how bright tones are displayed. These
are separate decisions: this change adds no development preset or additional
default compression. The existing neutral helper settings remain the baseline,
and saved user adjustments continue to shape the result.

## Invariants

- Automatic RAW rendering requires the original and applied CIRAW reconstruction.
  Missing originals report `file_offline`; unavailable decoding/reconstruction
  reports `decoder_unavailable`. A camera or retained JPEG cannot silently replace
  RAW processing. Explicit camera-JPEG access remains available.
- Changing the decoder invalidates deterministic rendered outputs through the
  existing renderer identity. Saved adjustments and authored generated images
  remain creative state, not disposable decoder caches.
- Ordinary-image fallback behavior remains independent of the RAW policy.
- Warm previews must not repeatedly initialize Core Image just to rediscover the
  same capability. The in-memory probe reuse remains bounded and observes source
  and helper file changes; it never owns rendered pixels.

The owners are [decoder selection](../../../packages/render/src/decoder.ts),
[graph source resolution](../../../packages/commands/src/graph-source.ts), and
[render identity](../../../packages/render/src/graph/recipes.ts). Public behavior
is pinned by [source treatment tests](../../../packages/commands/src/source-treatment.test.ts)
and [RAW source failures](../../../packages/commands/src/graph-source.test.ts).
[Real-Mac acceptance](../../../test/macos/raw-default.test.ts) exercises the actual
helper; the shared [segmentation journey](../../../test/journeys/segment-at.ts)
runs with a photographic PNG portably and with RAW on macOS.

## Visual provenance and decisions

The owner's [camera originals and selected references](../../../fixtures/camera/highlights/README.md)
are the quality target. The [production-route comparisons](assets/README.md)
preserve before/after previews, exports, enlarged highlight crops and binary
fingerprints. An independent review found no blocking artifacts in these scenes;
this does not promise recovery of fully clipped detail or identical pixels across
Apple decoder updates.

The [choices ledger](choices.md) records the remaining implementation tradeoffs.
Experiments are excluded from fixtures, and the obsolete decision map is deleted.
This is a rationale and evidence record, not a separate product design spec.
