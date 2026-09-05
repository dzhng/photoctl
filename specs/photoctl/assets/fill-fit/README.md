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
The repeated-path image cache prevented that reviewer from seeing the replacement, and a further fresh
agent was unavailable. That limits the independent crop-level evidence.

The final adversarial inspection therefore asked:

- Could the hard and expanded squares be clipped or misplaced? Their full images retain symmetric margins;
  the corrected edge crops show straight boundaries without halos.
- Could free's rounded, weaker center be accidental blur? It follows the requested broad feather, but this
  small synthetic square cannot establish texture continuity or suitability for a photographic subject.
- Could the single-coverage candidate's broader edge be leakage? The transition is stronger and wider than
  the deliberately squared baseline, matching the lossless single-alpha contract; protected pixels remain exact.

Verdict: accept the deterministic coverage and projection correction. Photographic edge continuity,
irregular-subject quality, and live provider polarity remain separate open evidence gates.
