# G8 noise-reduction checkpoint

Slice 08d2 used the committed `a7c2.ARW` through the LibRaw → scene-linear Rec.2020 → native develop
→ display conversion seam. The review frame is a 700×518 100%-pixel crop of grass, fine stems, and a
hard path boundary. The target was to reduce random luminance and chroma speckle without turning real
grass texture into watercolor, bleeding color across stems, or moving the path edge.

The first delegated strength mapping was rejected. At `luminance=50`, it reduced edge energy to
60.5% of neutral and visibly smeared grass into broad patches. The accepted retuning uses a 3×3
comparison patch, a 5×5 search window, and full-scale filter widths of `h=0.012` for luminance and
`h=0.010` for chroma. At the same 50% controls, comparison measured:

| Candidate | grayscale MAE | edge-energy ratio | mean luminance delta |
|---|---:|---:|---:|
| Luminance 50 | 0.42/255 | 0.962 | +0.05/255 |
| Color 50 | 0.25/255 | 1.005 | +0.04/255 |
| Combined 50/50 | 0.51/255 | 0.967 | +0.09/255 |

Fresh unprimed review accepted all three variants. Color reduction retained blade structure with no
visible bleeding or desaturation. Luminance reduction slightly softened the finest low-contrast
texture without plastic patches or edge damage. Combined was preferred narrowly as the cleanest
photographic result; its mild microtexture attenuation remains the visible tradeoff. **G8 noise
reduction is accepted**, while the separate local-contrast checkpoint remains rejected on its own
evidence.

The optimized native build processed this crop in 35 ms (luminance), 37 ms (color), and 70 ms
(combined). It caches component data for at most 22 source rows and uses one persistent set of at
most eight workers to compute 16 output rows at a time, so scratch storage remains proportional to
image width rather than image height.

Evidence hashes:

- neutral: `248d99c90540a71140d9a5accf767938439e7428734edc18c4e81b8f84ead8c6`
- luminance: `7dca05dc6330fff199dd12f6133bce8ae385be4e1dee20d0a593d4c5f91f2b74`
- color: `0ed401d69d61802d62c1515a833aa2f2a6e13a76f4e6791b5ebee893f10f5b79`
- combined: `b3f03db53f6fc6aa193a9adfb69cb89b20f93c6de378d26eeb6ff2cc58415b61`
