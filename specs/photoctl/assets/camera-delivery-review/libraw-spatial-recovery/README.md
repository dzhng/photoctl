# Upstream LibRaw spatial-recovery evidence

This controlled experiment invokes the exact upstream recovery routine, not a
production correction. It supports investigating spatial channel reconstruction;
it does **not** justify adopting its integer staging, changing decoder defaults,
or accepting native photographic quality.

## Controlled comparison

The 2026-09-06 experiment used the saved DSC00107 and DSC08142 Bayer originals.
LibRaw's compiled `recover_highlights()` is called through a scratch subclass.
The implementation is the vendored CDDL routine in
[`postprocessing_aux.cpp`](../../../../../crates/libraw-sys/vendor/src/postprocessing/postprocessing_aux.cpp),
not a replacement algorithm or the full `dcraw_process` pipeline. Its spatial
ratio map uses 4×4 native cells when `shrink=0`; the reference channel is selected
from white-balance gains. Missing propagated ratios fall back to 1.

Both arms retain photoctl's existing order: unpack, inset crop, raw2image, black
subtraction, pre-interpolation and AHD. Upstream normally scales white balance
before demosaicing; adopting that order here would confound the comparison.
Both arms receive the same unsigned-16-bit staging, with channel index `c`:

```text
g = as-shot white-balance gains / green gain
M = max(g)
W = black-subtracted white level
q[c] = floor(clamp(camera[c] * g[c] / M * 65535 / W, 0, 65535))
pre_mul[c] = g[c] / M
```

Mode 1 leaves this common staged image unreconstructed. Modes 3, 5 and 9 each
restore the same staged image before calling upstream recovery. The operation
runs on the full native grid (4672×7008 and 7008×4672 after orientation).
Outputs are then oriented and quarter-resampled: the four central pixels of each
4×4 block are averaged, returned as balanced floats `q * M / 65535`, and passed
through photoctl's existing camera matrix with white level 1, black level 0 and
white balance marked already applied. There is no second white-balance pass,
upstream profile, auto-brightness, denoise, gamma or additional tone curve.

## Measurements and limitations

The unchanged [measurement output](results.json) retains all four modes. Its
scene comparisons are quarter-resolution; only fields explicitly named `native`
measure the native grid. `changes` uses maximum absolute linear channel delta
greater than `1e-6`. Luminance bins use the common baseline's Rec.2020 Y in
`<.1`, `[.1,.5)`, `[.5,1)` and `>=1`. The magenta diagnostic counts display RGB
with `R>.95`, `B>.75`, `G<.65`; this is neither recovery logic nor an acceptance
threshold.

The staging itself clips 3,122 candle and 1,400 sunset channel samples. Compared
with the current floating pipeline, **mode 1 already differs**: maximum scene
delta is 0.03209 / 0.23940, and mean maximum-channel delta is 0.0000273 /
0.0000223. These losses must not be attributed to recovery or silently accepted
in a production port.

Recovery changes 173,543 / 3,267 native pixels and 11,204 / 216 quarter pixels.
The candle magenta diagnostic falls from 5,245 to zero. The sunset diagnostic is
zero in both arms despite a visible pink-to-white lamp change reported by the
experimenter. Recovery has exactly zero change below baseline Y=0.5. Modes 3,
5 and 9 have byte-identical quarter float outputs on both samples; this does not
prove the parameter generally redundant or identify which cells used fallback.

The experimenter's additional ROI measurements found the sunset orange panel
unchanged in scene floats (0/720 pixels, maximum delta 0). Scene maxima remain
above one: candle 2.9406→2.6758 and sunset 2.1165→2.0664. Native changed pixels
below the diagnostic `max(sensor) >= .999 * white` cutoff number 811 / 4; that
does not establish they were unclipped. Upstream's integer threshold is based on
`32000 * normalizedWB` and quotient at least 2, roughly .9766 of nominal white.

The retained PNGs compare modes 1 and 3 at ordinary exposure and minus two EV
(scene floats multiplied by 0.25 before the same display conversion). Names are
`<fixture>-<mode>-<exposure multiplier>[-detail].png`. Full views are quarter
resolution. Detail views crop those quarter images, then enlarge four times with
nearest-neighbor sampling: they are **not native-detail captures**. Candle detail
uses quarter ROI `(500,820,115,240)`; sunset uses `(1635,335,115,175)`.
The experimenter reports a flat gray recovered flame core and residual pink
edges at minus two EV: removal of false color is not restoration of lost texture.
These captures are retained for comparison, with **no independent visual or
native-resolution acceptance claimed by this preservation pass**.

Reduced complete-RGB RAW with white balance already applied was explicitly
rejected by this experiment. Unit gains cannot reconstruct sensor saturation
evidence transformed by the codec. A production solution must resolve that
metadata boundary and preserve unclipped floating headroom before choosing a
default. The full camera delivery set remains rejected.

## Reproduction identity

Scratch workspace: `/private/tmp/photoctl-libraw-recovery.UVyPRM`. The probe was
compiled with `clang++ -O2 -std=c++11 -DNO_JPEG`, the vendored include directory,
and the existing `target/debug/build/libraw-sys-78d1f7df11251391/out/libphotoctl_libraw.a`.
No shared native build or production source was changed. Scratch programs,
executables and large float buffers are deliberately not committed.

SHA-256 identities, verified when this evidence was preserved:

| Artifact | SHA-256 |
|---|---|
| LibRaw archive | `7317b3f1890981bd946b7ca3c80582ae25e2ab1a8ca24b2520106659d29c1bef` |
| Upstream recovery source | `cfb8c31a134d9313dc489b0165fa34ee505657435474c18e9e89b0beaf1618f3` |
| Scratch executable | `96f5fac581961766f6128eec64c55400419f2d8c289b4fdf8d2f0002e80d25fe` |
| Scratch probe source | `5ceb7265c74be4e4082732917b4ec483efdec52e14e14aed328c3834e3ac396b` |
| Scratch measurements/capture source | `49b53ea82b7239f1dd381455e7ee8e14f00a13ab1ca7e7ec3c5e44533f4ccea2` |
