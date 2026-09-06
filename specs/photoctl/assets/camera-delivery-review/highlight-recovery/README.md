# Native highlight-recovery evidence

This is a decoder experiment, not a shipped correction or accepted delivery set.
The target is to remove false color caused by clipped RAW channels while preserving
genuine colored lights and scene-linear headroom. Matching the camera JPEG's tone
curve, exposure or noise reduction is not the target.

## Controlled native comparison

The saved DSC00107 and DSC08142 originals were decoded at scale 1 on macOS 26.4.1
(25E253), Core Image RAW decoder 8. A scratch copy of the helper at `b7caada` changed
only `isHighlightRecoveryEnabled`, controlled by `PROBE_RECOVERY=0|1`, and reported
the actual supported/enabled state. Both files report support. No production code
or shared native addon changed. The scratch helper SHA-256 is
`976a34cae368ec3d8bbab6d980c2d62723ad5387de3d5c8fba2989ecc0a7d94a`.

The helper retains zero exposure, baseline exposure, shadow bias, boost, noise
reduction, sharpness, contrast, detail, moiré reduction, extended dynamic range and
local tone mapping; lens correction and gamut mapping remain disabled. As-shot
white balance remains CIRAW-owned. Output is extended linear Rec.2020 RGB-f32.
Apple exposes this supported decoder control through
[CIRAWFilter](https://developer.apple.com/documentation/coreimage/cirawfilter/ishighlightrecoveryenabled).

Reproduction scratch: `/private/tmp/photoctl-ciraw-recovery.WWMkjD`. Compile the
helper copy and unchanged release-version source with `swiftc -O -parse-as-library`.
For each fixture, compare these commands without changing any other control:

```sh
PROBE_RECOVERY=0 ./probe decode /Users/david/dev/photoctl/fixtures/camera/DSC00107.ARW --scale 1 --output before.f32
PROBE_RECOVERY=1 ./probe decode /Users/david/dev/photoctl/fixtures/camera/DSC00107.ARW --scale 1 --output after.f32
```

All 24 native capture PNGs are retained alongside [measurements](native-results.json).
Label `0` means disabled and `1` enabled. Detail crops retain native pixels without
resizing; overviews select every fourth native pixel. Minus-two-EV views multiply
the returned linear samples by 0.25 before the same display conversion; they are
not another decode and cannot reveal detail that the output does not contain.

## Results and limits

DSC00107's native flame crop changes from 85,191 false-magenta diagnostic pixels
to zero. Its maximum scene sample remains 2.673, so reconstruction is not a blanket
clamp to display white. At minus two EV the flame core is flat gray: removal of false
color does **not** demonstrate recovery of lost texture. Fine stepped/zipper-like
high-contrast edges remain in both variants.

DSC08142's orange panel retains its color and fine horizontal lines. Its maximum
linear change is `7.15e-7`, with no pixel exceeding the experiment's significant
change threshold of 0.005. The lower lamp changes from magenta to white/gray,
with eleven diagnostic pixels remaining. The red point light remains red.
Both frames preserve pixels with disabled-image scene luminance below 0.5 within
`1e-6`, but exact whole-frame floating-point equality does not hold.

The diagnostic counts display RGB satisfying `R > .95, B > .75, G < .65`; it is
neither the recovery algorithm nor an acceptance threshold. Measurement bins use
disabled scene luminance: below .1, [.1,.5), [.5,.9), [.9,1), and at least 1.
Changed/significant counts use maximum absolute linear channel delta above
`1e-6`/`.005`. These tolerances describe the experiment, not a new product gate.

Independent unprimed review `01a0751c-1e22-7ae1-a1ad-01a7b1dcc53b` inspected all 24
captures and found the same localized improvement, unchanged genuine colored
lights, flat highlight interiors and remaining stepped edges. Main inspection
agrees. Enabled is less wrong for false highlight color on these samples; these
PNGs cannot establish the original light spectra or recoverable sensor detail.

## Portable recovery remains unresolved

Earlier floating analogues of LibRaw highlight blending removed candle magenta but
desaturated genuine unclipped colored lights. A hard sensor-clipping gate preserved
unclipped pixels yet created mottled orange-panel boundaries. Neither candidate is
an acceptable default. The [LibRaw maintainer's clipping explanation](https://www.libraw.org/node/2138)
motivates investigating the channel saturation boundary, not implementing a
magenta detector or unconditionally clipping every bright color.

The next experiment isolates upstream spatial reconstruction. Current photoctl
uses AHD before floating white balance; upstream recovery expects a WB-scaled
integer image. Any port must account for that difference without introducing
clipping or changing exposure before the comparison. Reduced complete-RGB RAWs
also need an explicit metadata contract, not an invented sensor saturation map.
Only after that seam is resolved should policy, cache identity, public diagnostic
access and unchanged decoder/delivery gates be implemented together.
