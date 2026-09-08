# Keyless reimagine journey

Deterministic built-CLI evidence for Slice 13a. `source.png` is the imported synthetic fixture,
`before.png` is its exposure-adjusted current render, `after.png` is the 50%-strength full-frame
reimagine result after generation, configured density matching, and exact base-size resampling, and
`restored.png` is the render after removing the reimagine layer.

All captures are 160×120 opaque PNGs. `before.png` and `restored.png` are byte-identical. The fake
gateway is a contract fixture rather than photographic quality evidence; live-model and upscaler
quality remain non-blocking work under the Slice 13a quality spike.

The comparison gate measured a material full-frame change (grayscale MAE 33.44, distance 0.438),
with no transparency or dominant-color/empty-frame signal. A fresh unprimed review found identical
framing, no clipping, voids, corrupt pixels, tears, or partial-render seams; it judged `after.png` a
coherent darker full-frame transformation and confirmed `before.png`/`restored.png` are byte-identical.
The mild small-fixture resampling softness is visible in both current and generated previews and is not
treated as live photographic quality evidence.
