# G9 — develop geometry

Target: a base-space crop must change framing without changing tone, introducing empty borders, or
warping scene structure. The production route was the committed A7C II RAW decoded through LibRaw,
evaluated through the immutable develop node, converted at the display boundary, and requested with
`show --preview-size 1200`.

The neutral 7008×4672 frame and `{x:500,y:300,w:6000,h:4000}` crop produced 1200×800 PNGs with
SHA-256 hashes `45ec4dddf5fe8f54c5d3d346b4f8e3741e28ee0820180bbd57ea1cc2b9f47318` and
`ef66c39dc80af18551be1a27325b96075b15bfc8907bb4359d8258aef6c8e970`. The files differ materially:
MAE 14.56, RMSE 22.82, pixel mismatch 0.205, and edge-difference ratio 0.293. Edge energy stayed
stable (`0.135→0.139`, ratio 1.027), average luminance moved by only 0.98/255, and both frames were
opaque. Those numbers locate a real framing change without evidence of lost structure or an accidental
tone operation; they do not judge composition.

All fresh-agent lanes were occupied by the three concurrent implementation passes, so the required
fallback adversarial inspection was used on the complete side-by-side frame and its pole, rail, tree,
and road detail. The strongest case against the candidate is that resampling could bend the narrow
power lines, soften the pole edges, or introduce a border at the crop boundary. At full frame and zoom,
the lines remain continuous, poles remain vertical, the road edge stays smooth, and no empty border,
stretch, halo, or geometry discontinuity is visible. The crop is technically accepted; its aesthetic
framing is deliberately not promoted into preset data.
