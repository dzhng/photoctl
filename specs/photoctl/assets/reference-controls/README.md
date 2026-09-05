# Reference/control transport evidence

Target: exact reference PNG transparency survives the wire, and four fake initialization requests
produce visibly distinct deterministic signatures. This is not a latent-initialization or photographic
quality verdict. All eleven PNGs are included; none were rejected or hidden from review.

`reference.png` is a 32×32 red RGBA reference with alpha 128 on the left and 64 on the right.
`reference-4x.png` is its nearest-neighbor zoom; `reference-checker-4x.png` explicitly composites that
zoom over a checker to expose alpha. The four `reference-*-sent.png` files are extracted from actual
serialized multipart requests. They are byte-identical to the reference. The four mode-named output
PNGs are normalized responses from the HTTP fake gateway, not synthesized expected screenshots.

Reproduction owners: `packages/providers/src/image-controls.test.ts` drives adapter → HTTP gateway →
normalization for original/fill/noise/empty; `packages/commands/src/fill-controls.test.ts` drives real
fill/repeat/refresh, including alpha-only changes and refresh after deleting the reference file.
For these captures use the same fixture with a 32×32 gray editable input, a white mask, prompt
`red vase`, and the two-alpha reference above. Decode the second `image[]` multipart part, save each
normalized response, and zoom the reference 4× with nearest-neighbor sampling. No live request is used.

`metrics.json` records applied controls, exact wire-byte identity, output RGBA samples and mean absolute
channel differences from original. `scene-metrics.json` records alpha-aware single-image telemetry
(transparent pixels composited on white). Four outputs have zero color entropy and dominant-color
share 1: intentionally flat fixture signatures, not meaningful visual-quality samples. The shared
comparison helper could not resolve its `pngjs` dependency, so the capture script used Sharp for these
bounded metrics. Metrics locate distinctions; they do not establish correctness by themselves.

## Review verdict

Both implementation and root reviewers inspected the set. A fresh-agent critique was attempted twice
but unavailable at the agent limit; the screenshot-critique adversarial fallback was used, not fresh-agent
acceptance. The strongest visible cases against acceptance were recorded before deciding:

- Raw reference and four sent captures look uniformly red, so they visually fail to expose alpha loss;
  only the explicit checker diagnostic makes left/right coverage visible. Byte assertions are decisive.
- Four outputs are flat squares, so noise/empty labels could falsely suggest implemented latent
  initialization. These are fixture signatures, not model semantics.
- The 32px outputs and absence of in-image labels cannot establish geometry, detail quality, or
  photographic behavior.

Bounded verdict: checker visibly has stronger red coverage left than right with a clean vertical
division; actual output colors blue/brown/green/black are clearly distinct. No visible anomaly for this
target. The complete set was opened in one Preview window and closed after nonblocking review.
Live polarity and photographic acceptance remain separate, unrun gates.
