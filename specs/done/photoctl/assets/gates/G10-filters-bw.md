# G10 — deterministic filters and B&W

Target: a named color filter should make its intended color and tone change without moving the
frame or damaging photographic detail. B&W should remove chroma while preserving readable tonal
separation, and its grain should look irregular rather than tiled or banded.

The production checkpoint used the committed `a7c2.ARW` through LibRaw, the immutable scene-linear
Rec.2020 develop node, and the display transform. Neutral, `vivid_warm` at 65%, and B&W with
`intensity=20`, `neutrals=10`, `tone=15`, and `grain=15` all produced 1616×1077 views with identical
framing and distinct render hashes.

Compared with neutral, the color filter had luminance MAE 2.05/255, edge-energy ratio 1.018, and
mean luminance delta +1.70/255. B&W had luminance MAE 7.03/255, edge-energy ratio 1.087, and mean
luminance delta +6.69/255. The color treatment moved no pixels beyond a 32-level grayscale delta;
B&W moved 0.001% beyond that threshold. These metrics establish a real grade with preserved
structure; they do not select the recipe by numerical similarity.

Fresh unprimed review accepted both treatments technically. The color filter's mild yellow-green
lift was visible without clipping, blur, halos, banding, crushed shadows, or detail loss. Existing
cyan/red edge fringing became slightly easier to see in zoomed pole and tree edges. B&W retained
framing, highlight texture, and edge detail. Its grain was conspicuous at 2× and woodland shadow
separation was somewhat compressed, but the grain looked irregular rather than patterned and the
shadows were not hard-clipped. These remain aesthetic tradeoffs in the deliberately visible probe,
not hidden acceptance failures.

Render hashes:

- neutral: `r_48b7e8ac177f704047e8545734a22faabb233929e9b3219ced9c2a7ff29d36e2`
- color filter: `r_2299571293cc132d3d1ef90c2d6b8d1a7eefc073a2e8a2caba9fc4bcccd4f2ca`
- B&W: `r_87ec85814bd279b2d3a7799f4a0e6d8303a39449647ac06b78796d20626641a6`

Evidence PNG hashes:

- neutral: `27906bc92255da94d452c448ded893a13d3635d5cb7ed78e844956358e9868ed`
- color filter: `8546fd574cd9bb0487f15db4bc085f70d83d39dc5335082906353aa40633a7e9`
- B&W: `9e1d30449efa7fff724e4be8cf3df7f53f698508130a368f28e9ba3eea25224f`
