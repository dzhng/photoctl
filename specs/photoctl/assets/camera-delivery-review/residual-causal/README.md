# Residual-edge causal comparison

This comparison isolates the highlight-reconstruction toggle, not overall RAW
quality. The target is to preserve fine contours and skin detail while correcting
false highlight color; neither a disabled RAW nor a camera JPEG is assumed to be
photographic ground truth. A defect unchanged by this toggle remains unresolved,
but cannot be attributed to this reconstruction operation in the measured region.

## Controlled capture

Both sides use the current root `@photoctl/img` API, explicit native scale 1 and
scene-linear Rec.2020 output. `a` requests disabled; `b` requests reconstruction.
All three requests report applied on B. Source hashes, exact root commit/native
binary identity, complete float-buffer hashes, changed-sample counts, bounding
rectangles and largest changed coordinates/values are in the adjacent per-scene
JSON. No product code, library, camera file, decoder preference or paid call changes.

The shared native display conversion is followed by identical [0,1] clipping and
8-bit rounding for lossless PNG capture. Overviews resize the entire native frame
within 1440×1440. Detail images use the original all-reference review's oriented
512×512 crop, enlarged twice with nearest-neighbor sampling. Darker details multiply
scene floats by 0.25 before the same conversion. Display clipping is not a float
headroom measurement; the float comparisons happen before it. These direct PNGs
avoid introducing the delivery JPEG encoder as another variable.

The complete capture set is the nine PNGs in each of `a/` and `b/`. The numerical
[comparison](comparison.json) was produced by the shared compare-screenshots helper.
Its scratch diff-image paths are supplementary telemetry locations, not permanent
capture paths. Grayscale distance locates changes; exact scene-float comparisons
establish the causal exclusions below.

## What the toggle changes

| Scene | Changed native pixels in full frame | Reported 512×512 detail | Causal boundary |
| --- | ---: | ---: | --- |
| DSC09314 | 3 / 14,155,776 | 0 / 262,144 | Branch echoes and fine colored edges are unchanged. |
| DSC08819 | 1 / 14,155,776 | 1 / 262,144 | Only sunglasses hardware changes; the nose is unchanged. |
| DSC00434 | 2,682,960 / 32,741,376 | 12,774 / 262,144 | Changes occupy the top 132 native rows of the detail, not its lower wires/sign/pole. |

DSC09314 changes only `(2325,147)`, `(1815,852)` and `(1817,855)`, all outside the
reported branch crop `[2877,435,512,512]`. Every scene-float sample in that crop is
exactly equal. Its ordinary and darker detail PNG pairs are also identical.

DSC08819 changes only `(2977,1176)`, on the sunglasses hardware. Its scene-linear
RGB changes from `[1.4609393,0.8437144,1.5479795]` to
`[1.5687269,1.5820785,1.4560666]`; full-precision values are in its JSON. All 22,500
pixels in the nose bridge/tip rectangle `[2710,1235,150,150]` are exactly unchanged.
The broad skin crop differs at one native display pixel, with maximum 29/255 channel
delta. This does not explain the many colored flecks visible on the nose.

DSC00434 changes are substantial in the bright sky. Within the wire crop
`[1589,1475,512,512]`, every changed pixel lies at native y=1475–1606. All 193,024
pixels in `[1589,1610,512,377]`, covering lower wires, lettering and pole, remain
exactly equal. This excludes reconstruction for those lower edge artifacts, not
for every wire against the changing upper sky.

## Visual judgment and next diagnostic boundary

The implementing agent inspected all 18 images. One fresh, no-context reviewer,
`/root/highlight_native/residual_pair_critique`, independently inspected all 18,
overviews first, with neutral A/B labels and no metrics or expected result. No
recursive review delegation was used. The integrating agent also directly inspected
all 18 stable captures and agreed with the bounded findings below; it owns the
separate non-blocking user Preview checkpoint.

Both inspections agree: the branch and portrait pairs have no defensible visual
winner. Cyan/magenta twig outlines, soft duplicate-looking branch contours, colored
nose flecks and hair/glasses edging remain. B is less wrong for DSC00434's broad
pink sky, including reduced pink in the darker upper detail. Wires, lettering,
concrete texture and blur show no apparent structural change; fine colored fringes
remain on both sides. The review does not certify perfect upper-sky boundaries or
recover lost cloud detail.

The bounded conclusion is that reconstruction does not introduce or exaggerate
the specified branch or nose artifacts, or the lower wire-region artifacts. Their
origin still needs isolation among acquisition/optics, RAW unpacking/interpolation
and the shared color/display path. A useful next comparison would inspect the same
native regions before the color matrix and against an independently neutral native
decoder, holding geometry and display conversion fixed. That is a diagnostic
proposal, not authorization to change demosaicing order, apply lens correction,
switch default decoders or substitute JPEGs. General default RAW fidelity and the
complete photographic C verdict remain separate.
