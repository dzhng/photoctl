# Effective coverage evidence

This controlled solid-patch scene checks coverage ownership, not photographic quality or live model behavior.
The target is one selected square on an unchanged gray canvas: strict keeps its hard boundary, expansion
widens support symmetrically, and free gives it a soft boundary. A fractional frame change must retain the
same feather rather than applying its opacity twice.

## Captures

- [Strict](strict.png), [expanded](expand.png), and [free](free.png) are canonical graph outputs converted
  through the native display transform. Their [4× strict](strict-edge-v2.png), [expanded](expand-edge-v2.png),
  and [free](free-edge-v2.png) crops include the visible transition.
- [Double coverage](double-coverage.png) and [single coverage](single-coverage.png), with corresponding
  [double](double-coverage-edge.png) and [single](single-coverage-edge.png) edge crops, isolate the final
  support threshold. The baseline is a deliberate mutation that omits that threshold, not a claim that the
  original dimension-mismatch failure produced an image. RGB projection and every input are fixed in this pair.

The fit captures use a 256×192 scene-linear gray source (RGB 0.25), a base-coordinate box
`96,64,64,64`, the HTTP fake gateway's fixed blue output, and no upscaler. The projection pair uses
strict fit, strength 0.125, pad 0, then `develop --set straighten_deg=5`. Output is 241×171;
the edge crop is `[48,24,128,128]`, enlarged four times with nearest-neighbor sampling.

[Telemetry](metrics.json) records distinct fit support areas. The projection pair differs at 6,248 pixels;
mean absolute channel difference is 0.760735 on the 8-bit scale, RMSE 2.357415, and maximum mean-channel
delta 10.333333. These locate the visible boundary change; they do not decide correctness. The lossless
command regression compares the corrected result directly with geometrically projected layer pixels.

Reproduce behavior with the public-command journeys in
[`fill-strict.test.ts`](../../../../packages/commands/src/fill-strict.test.ts), especially the final-output
expansion, single-coverage, and develop-projection cases. They inject only source decoding and the real HTTP
fixture boundary; graph execution, native kernels, and canonical artifact reads remain real.

## Critique and verdict

An unprimed critique of the fit full images found clean hard boundaries and symmetric soft falloff, with
no confirmed halo, double edge, or clipping. It noted possible faint 8-bit stepping at low confidence.
An initial expanded crop had no visible edge; the wider immutable crop above corrects the capture.
A fresh integration critique inspected every full image and current edge crop. It confirmed the hard
strict/expanded boundaries, broad free transition, and visibly narrower footprint under double coverage,
without a detached halo or ghost contour. These differences match the intended fit mechanics; they do
not by themselves prove photographic suitability.

The final adversarial inspection therefore asked:

- Could the hard and expanded squares be clipped or misplaced? Their full images retain symmetric margins;
  the corrected edge crops show straight boundaries without halos.
- Could free's rounded, weaker center be accidental blur? It follows the requested broad feather, but this
  small synthetic square cannot establish texture continuity or suitability for a photographic subject.
- Could the single-coverage candidate's broader edge be leakage? The transition is stronger and wider than
  the deliberately squared baseline, matching the lossless single-alpha contract; protected pixels remain exact.

Verdict: accept the deterministic coverage and projection correction. Photographic edge continuity,
irregular-subject quality, and live provider polarity remain separate open evidence gates.
The non-blocking Preview review window ended without a changed verdict; the opened shots were closed.

## Fill creation in a cropped frame

Target: only the visible part of a base-coordinate selection may change. Removing the crop must not
retroactively create hidden edits; explicit generation refresh may regenerate the original selection
under the newly visible context.

The complete sequence is [before fill](creation-baseline.png), [filled crop](creation-filled-crop.png),
[uncropped](creation-uncropped.png), and [explicitly regenerated](creation-regenerated.png).
The 4× nearest-neighbor details are [filled boundary](creation-filled-crop-edge.png),
[uncropped boundary](creation-uncropped-edge.png), and [regenerated boundary](creation-regenerated-edge.png).
The flat baseline is intentional: it measures an unchanged gray source, not photographic content.

These captures use a 256×192 gray source, crop `[96,24,128,144]`, original box `[32,64,128,64]`, strict
fit, pad 0, the fake gateway's blue patch, and no upscaler. Details are 80×80 crops at `[0,32]` in the
cropped frame and `[24,56]` in both uncropped frames. [Canonical telemetry](creation-metrics.json)
records 0→4,096→4,096→8,192 changed base samples. The comparable first pair differs at 4,096 of 18,432
pixels (grayscale MAE 8.444444, RMSE 17.913372); the uncropped pair differs at 4,096 of 49,152
(MAE 3.166667, RMSE 10.969655). Different-size frames are not compared as aligned images.
The skill's comparison script lacked its `pngjs` dependency; these measurements use Sharp decoding.

Adversarial self-review, recorded before acceptance:

- The blue patch touching the left crop edge could be accidental clipping. It is exactly the visible
  intersection in the full crop, while the detail shows a clean hard edge without a halo.
- The smaller blue square after uncrop could mean part of the selection was lost. Its unchanged area
  is intentional: no new provider call occurred, and formerly hidden coverage remains protected.
- The wider regenerated rectangle could be overpainting. It follows the original selection only after
  explicit refresh; straight boundaries and unchanged exterior remain visible in both full and detail views.

The creation sub-agent could not obtain another fresh reviewer; the integrating task then obtained an
independent critique of all seven images. It found no definite defects: high-confidence crisp straight
boundaries, clean corners, and no halos, blur, or stray pixels. It noted that the edge-flush crop is
intent-dependent and that flat regions cannot establish readability or photographic quality. Its
left/right description was mistaken: the blue patch meets the left crop boundary, as the coordinates
above require. The integrating agent inspected all seven images and accepted that mechanical geometry.
Verdict: accept this deterministic creation/visibility correction, with those visual limitations.
Deterministic command tests also
check uploaded quadrant colors, zero context padding, active canonical mask coverage, final protected
pixels, nonvisible refusal, and refresh crop expansion. No photographic or live-provider approval follows
from this synthetic evidence.
The creation sequence was opened together in Preview for approximately five minutes during integration.
No feedback changed the deterministic verdict; the window was closed before continuing.
