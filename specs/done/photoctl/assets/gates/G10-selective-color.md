# G10 closeout — selective color

Target: the seven schema-declared hue bands must alter full-resolution production pixels through the
existing native scene-linear owner without discontinuities, false-neutral patches, lost texture, or
a second render seam. Zero controls must remain an exact canonical no-op, and geometry must stay last.

The production checkpoint imported `fixtures/a7c2.ARW` through the CLI and LibRaw, then exported a
neutral frame and a selective-color frame at the identical 7008×4672 dimensions. The candidate used
green hue `20`, saturation `25`, luminance `8`, plus yellow saturation `15.04`; the extra `0.04` was
an otherwise immaterial cache-busting change after correcting the native operator. Its render hash was
`r_154f9bcc5aad4c81cded61418163c08276b179e02a0275c6377af3116acf6457`.

The first visual probe was rejected by fresh review. Its additive luminance offset produced large
gray/charcoal threshold patches in shaded foliage, and a first attempted gamut clamp still discarded
too much chroma. The accepted implementation instead applies luminance as a proportional scene-linear
gain and blends an out-of-gamut target toward the original color at the same luminance. The final
comparison measured grayscale MAE 0.949/255, no pixels beyond a 16-level grayscale delta, mean
luminance delta -0.304/255, edge-energy ratio 1.00113, and no framing change. These are diagnostic
measurements, not an aesthetic score.

Fresh unprimed review accepted the corrected candidate with 94% confidence. It found no false gray
or charcoal patches, abrupt hue transitions, banding, clipping, candidate-specific halos, blur, or
geometry shift. Grass and foliage texture remained intact; increased yellow-green separation read as
the requested adjustment, while the darkest areas retained the reference's placement and structure.
Fine cyan/magenta fringing on high-contrast poles and wires was equally present in the neutral source.

The focused native and TypeScript tests prove named-band targeting, smooth neighboring-band behavior,
independent hue/saturation/luminance effects, scene-linear luminance preservation, nonnegative gamut
handling for dark saturated colors, deterministic in-memory/canonical equality, fixed finishing order,
and exact zero-control identity. The production format matrix also carries selective-color JSON through
the command/dispatcher path for whole-file, embedded RAW, and extensionless inputs. The keyless
people-preset gold exam remains green after the final operator landed.

Evidence PNG hashes:

- neutral: `7b692bfa2fea346a062e206bb66d8fd3c20344aa70dcc556c4a8f287834f3c60`
- selective color: `8c1f6d0244a1590d9a63e2a282b34278006f6880a10c09786d5365a03a47b284`
