# Interpolation and fine color edges

Interpolation contributes to the portrait's fine colored edges. Replacing current
AHD with LibRaw's bilinear interpolation reduces some fringing but also softens
skin, eyebrow strands and glasses lettering. This is not an accepted replacement.
The narrower neutral control establishes invented chroma at this boundary, not an
optical explanation for every photographic fringe or a failure of reconstruction.

## Controlled boundary

A is current AHD; B is upstream bilinear. One unpacked, black-subtracted CFA buffer
from DSC08819 supplies both methods. Crop, orientation, subsequent white balance,
camera matrix and disabled reconstruction remain fixed. The full AHD camera float
hash matches a fresh production decode exactly; its scene floats and three photo
captures also match the preceding neutral-decoder evidence. Both methods preserve
every measured CFA site. No product code, defaults or originals changed.

The target is coherent portrait texture without invented colored rims. Neither
photographic output is ground truth. The independent controls contain quantized
samples of a known neutral finite-Fourier field in the same CFA phase and inverse-WB
representation. Both controls remain below the per-channel sampling limit. The
initial period-512 transition is too broad to exclude fine-edge defects; the retained
period-64 control tests a sharper transition without changing its construction.

The existing camera front and display transform produce all captures. Photo
overviews fit 1440 pixels; the same native 512-pixel region is enlarged twice with
nearest-neighbor sampling. Minus-two-EV views scale scene floats before display.
Control images use the same camera front. Their known channel ratios—not CIRAW or
the photographic JPEG—own expected neutrality.

## Result and next boundary

Root and an unprimed reviewer inspected all twelve captures. Portrait overviews
are effectively alike. In native details, B has less cyan/green speckling but loses
texture; the reviewer modestly prefers B, while root finds the detail tradeoff too
large to adopt it. Both find the broad controls visually indistinguishable. On the
sharper control, A introduces visible cyan/green and occasional purple boundaries;
B is closer to neutral but is not error-free.

The sharper control's WB-normalized channel MAE is 0.00360 for A and 0.00422 for B;
95th-percentile channel spread is 0.02144 and 0.01370 respectively, versus 0.000115
from truth quantization. Lower average error and lower false color do not select
the same method. Numeric distance cannot settle photographic quality.

This completes the sole-interpolator experiment. Do not repeat decoder breadth,
crop metadata or the recovery toggle. The next fidelity proposal must address
chroma without buying improvement through lost detail, preserve measured samples
and headroom, and earn a regression against the known field before changing the
wrapper. Changing WB order or adopting bilinear is not authorized by these results
alone. Complete photographic delivery remains open.

## Evidence

`report.json` binds the source, archive, current addon, stage hashes, broad control
and nine initial captures. `control64.json` binds the additional three captures
and sharper-control measurements. `comparison.json` contains diagnostic grayscale
and edge distances for the initial pairs; its derived image paths are scratch paths.
All twelve source captures are retained here. Fresh reviewer `/root/raw_pair_critique`
saw images only, with no implementation history or expected answer.

Reproducible probes and raw stage buffers remain at
`/private/tmp/photoctl-ahd-owner.RVRD4q`. Its README records the exact matching-archive
compile and both runs; `probe.cpp` and `control64.mjs` own the sharper control.
These are diagnostic probes, not shipped utilities or a new processing path.
