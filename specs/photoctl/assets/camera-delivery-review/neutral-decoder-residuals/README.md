# Neutral decoder residuals

This bounded diagnostic separates persistent scene structure from decoder-dependent
appearance. It does not make CIRAW a pixel oracle, identify an optical cause, or
reopen the accepted highlight-reconstruction mechanism for unrelated defects.
The visual target is coherent fine branches and natural portrait texture without
invented colored edges; neither decoder is presumed correct.

## Controls and comparability

`a/` is LibRaw with reconstruction disabled; `b/` is CIRAW with reconstruction
disabled and actual disabled status returned by the helper. Four successful native
scale-one decodes used the same two saved originals. No camera, library, product
code, default decoder, interpolation order or white-balance policy changed.

LibRaw's existing camera-space API supplied pre-WB/pre-matrix pixels, then the
existing camera front developed those pixels to scene-linear Rec.2020. The complete
developed float hash equals the preceding disabled causal baseline for each scene.
This obtains camera-space evidence without a second decode or new instrumentation.
Camera-space here is already unpacked/interpolated/oriented, not original CFA samples.

CIRAW used the packaged helper's neutral controls, including zero exposure and
baseline exposure, noise reduction, sharpening, contrast and local tone mapping,
with lens correction and gamut mapping disabled. Its private framework still owns
an independent demosaic and camera-color pipeline. Setting neutral controls does
not prove all internal processing, camera profiles, levels or geometry equivalent.

Both return oriented 4608×3072 images. **Their scene content is not pixel registered:**
CIRAW places features farther right/down in the selected regions, visible in both
overviews and details. The same numeric 512×512 crops retain the branch and nose
features, but are suitable only for feature-level visual comparison. No registration
or geometry correction was added to conceal this mismatch. Pixel-distance telemetry
therefore mixes geometry, color and processing differences; it is not a causal
changed-pixel count or an error score.

Scene captures use the same native Rec.2020-to-display-sRGB conversion, clamp and
uint8 rounding, then lossless PNG. Overviews fit within 1440×1440 using Lanczos3;
native crops are enlarged two times with nearest-neighbor sampling. Minus-two-EV
crops multiply scene floats by 0.25 before the same display transform. There are
no develop adjustments or camera-JPEG substitutions.

The A-only supplemental camera images normalize levels without WB or matrix, then
apply the sRGB transfer function separately to each channel. The green view repeats
the green channel. These are explicitly non-colorimetric structural diagnostics:
their cyan/green color is not a scene-color verdict, and suppressing color in a
grayscale view does not prove correct chroma in the original pixels.

## Bounded findings

For DSC09314, the broad translucent/angular branch echoes occur in both decoders
and the pre-matrix LibRaw green channel. Their structure is not created solely by
the downstream camera matrix or display color conversion. LibRaw has more obvious
cyan and stair-stepped fine outlines; CIRAW has smoother but stronger purple/magenta
edging. Neither is clearly less wrong overall. This does not distinguish optics,
acquisition, reduced-RAW representation or shared classes of decoder processing.

For DSC08819, CIRAW has less conspicuous cyan/green edging on hair, eyebrows and
sunglasses hardware. Its skin looks somewhat warmer and smoother, with no clear
material loss of texture in this capture. Both retain nose glint texture and skin
detail. The modest visual preference for CIRAW does not isolate demosaicing from
color conversion, geometry or other framework behavior, nor prove LibRaw incorrect.

The earlier sole-toggle evidence owns the stronger conclusion that reconstruction
does not change the specified branch or nose regions. This decoder comparison does
not weaken that result. A narrower decoder-fidelity investigation is justified for
fine chromatic edges and native geometry, separately from recovery. Its first task
should establish representation and coordinate provenance, not change WB/AHD order,
switch the default adapter, or assume broad branch echoes are newly invented.
Stop this experiment here; further production changes require that separate scope.

## Measurement and provenance

The four JSON records own source hashes, exact crop bounds, complete scene/ROI float
hashes, camera metadata where available, binary identities, actual treatment and
capture hashes. All sixteen PNGs are retained. `comparison.json` contains six scene
pairs; the four camera visualizations have no falsely comparable B counterpart.
Its derived diagnostic image paths point to the local scratch comparison directory,
not additional committed captures.

Actual sequential-run costs, not a benchmark or production memory budget:

| Scene | LibRaw decode/front/check time | LibRaw capture-process peak RSS | CIRAW helper wall time / peak RSS | CIRAW capture-process peak RSS |
| --- | ---: | ---: | ---: | ---: |
| DSC09314 | 545 ms | 1052 MiB | 2.43 s / 414 MiB | 813 MiB |
| DSC08819 | 493 ms | 1068 MiB | 1.83 s / 410 MiB | 843 MiB |

LibRaw timing includes camera-front conversion and comparison with the old complete
float hash, not just native decode. Its process RSS includes retained camera/scene
buffers and PNG capture allocations. CIRAW helper time/RSS comes from macOS
`/usr/bin/time -l`; the separate Node process peak includes reading floats and
encoding captures. Node `resource.maxRSS` is recorded in KiB, helper RSS in bytes.
These distinct process maxima are neither simultaneous memory nor values to sum.
CIRAW decode-and-read timings in JSON additionally include process invocation and
float-buffer reading. No concurrent native builds or extra successful decodes ran
as part of this diagnostic; unrelated host activity was not controlled.

An initial attempt pointed to the stale `.build/release` helper, which rejected the
new option before decoding. The corrected runs use
`packages/mac-helper-darwin-arm64/photoctl-mac`. The first LibRaw JSON records the
stale helper's hash as a file inventory only; LibRaw never invoked that helper.
All four runs use the same native addon; actual CIRAW records identify the helper
that executed. The scratch harness is
`/private/tmp/photoctl-highlight-measure/neutral-decoders.mjs`, invoked sequentially
with scene name and `libraw` or `ciraw`. No source files were written.

## Visual review

Main inspection covered all sixteen PNGs. Fresh unprimed reviewer
`/root/highlight_native/neutral_pair_critique` inspected the complete set, overviews
first, with no implementation history or expected answer and no recursive reviewers.
It independently identified the geometry mismatch, shared branch echoes and
different fringe colors. It found no overall branch winner and a moderate-confidence
portrait preference for B's more natural fine detail without clear lost texture.
Main and root's independent inspection of all sixteen images agree. The
minus-two-EV views expose no fundamentally different
highlight shape or missing feature. This is bounded diagnostic evidence, not whole
camera photographic acceptance.
