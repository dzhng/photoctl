# Current photographic delivery verdict

**Not accepted as a complete delivery set.** The remaining actionable concern is
colored highlight boundaries, especially the candle and bridge lights. This is
not a rejection of flat clipped cores, subdued exposure, or the already accepted
interpolation correction. No new renderer defect is causally established here.

## Evidence boundary

Reviewed at `d716548` on 2026-09-07. The packaged addon still matches the SHA-256
in [the delivery evidence](README.md); production native/render code is unchanged
since that capture. All 44 current B PNG hashes match the existing
[gold manifest](metrics.json) and [supplement](remainder/evidence.json).
No recapture, library mutation, build or preset adjustment was made.

The target is preserved real detail, scene geometry and genuine colored lights
without invented chroma. Camera JPEG processing is not an exact pixel target.
Existing comparison metrics establish capture provenance and prior movement, not
photographic acceptance; this pass judges current deliveries, not another A/B change.

Root inspected all 21 overviews (18 unique scenes) before completing all 23 detail
crops. Fresh PNG-only reviewer `/root/delivery_final_critique` inspected the same
18 scenes and every detail, omitting only the three duplicate supplement overviews.
It saw no A images, project reports, code or history. Gold detail crops retain native
samples enlarged twice; supplement detail crops are native-sized. Root's display
resized some large gold captures, so the independent review and retained PNGs remain
important for the finest boundaries.

## Per-defect disposition

| Scenes | Current judgment and next action |
| --- | --- |
| DSC00107, DSC07730 | Both reviewers see pink candle/reflection boundaries and repeated pink caps on bridge lights, with stippled/serrated transitions in detail. Highest-priority causal probe: measure these exact edges in scene floats versus display output, with reconstruction disabled/applied. White centers alone are not failures. |
| DSC00104, DSC00442 | Pink/yellow/cyan wall-lamp rims and fine violet aquarium-light edges remain visible in detail. Preserve as corroborating cases for the highlight-boundary probe; blue aquarium illumination itself is plausible scene color. |
| DSC08362, DSC08541 | Saturated yellow/orange bokeh and bright green/cyan window transitions deserve review. Uniform bokeh centers and white window areas do not establish a bug. Keep genuine lighting separate from invented boundary chroma. |
| DSC09314 | Broad purple branch fringes and doubled defocused contours remain visible. The existing neutral-decoder witness does not establish an optical cause; do not repeat that comparison or attribute this to reconstruction. |
| DSC09903 | Reviewer flags soft animal detail; root agrees it is soft relative to the ground. Capture motion/focus versus processing is unestablished. Softness alone is not evidence that the renderer discarded recoverable detail. |
| DSC00103, DSC00122, DSC00434 | No evident current rendering blocker in the inspected overview/detail regions. Dim-scene noise, clipped streetlight core and minor high-contrast fringes remain, without the earlier striping or conspicuous magenta cores. |
| DSC00290, DSC07633, DSC07668, DSC08819 | No evident rendering blocker in inspected skin/fabric detail. Texture and facial structure remain plausible; subdued exposure is a presentation preference, not a decoder failure. The low-contrast DSC07633 fabric crop cannot prove fine weave preservation. |
| DSC08142, DSC09148, DSC09797 | No evident rendering blocker in inspected lights/sky, ridge/sky and elephant detail respectively. Gradients and geometry remain coherent. |

The independent review's strongest concerns overlap root's highlight-edge and branch
observations. Its bokeh, window and animal findings are retained above rather than
dismissed, but their presence is not proof of a software cause. This verdict leaves
C open for the named highlight-boundary investigation, not another all-reference
capture or an undefined demand for perfect photographs.

The [native reconstruction witness](../native-reconstruction/README.md) already
shows candle fringes without develop or JPEG encoding. Do not rerun a preset-removal
experiment: the unanswered question is which stage creates or exaggerates the exact
boundary chroma. The current addon differs from that historical witness, so record
current scene samples and their display conversion rather than infer an owner from
the old image alone.

## Current edge samples

The [bounded numerical probe](edge-samples.json) retains source/addon and ROI hashes,
actual reconstruction treatment, and representative RGB triples. Complete samples,
both ROI float buffers and reproduction scripts remain at
`/private/tmp/photoctl-highlight-edge.9v4qgs`. It decoded only these two sources at
native scale; no catalog was opened. Display conversion used the production native
converter before clipping, with a separate minus-two-stop diagnostic.

Sampled pink bridge pixels are exactly unchanged by reconstruction in scene floats.
For example, `(3710,4071)` is `[1.084757,0.253763,0.695165]` in either treatment;
display RGB is `[1.228713,0.419002,0.871658]` before clipping. This excludes recovery
as the source of that sample's chroma, not as the source of every light-edge artifact.
The responsible earlier stage or capture cause remains unestablished.

The candle comparison is not yet treatment-matched to the gold delivery: that photo
received the people preset, while this probe has no develop. At `(2261,4080)` the
neutral reconstruction clips to white, but the retained delivery is `[255,236,251]`.
Do not call that a JPEG defect. A subsequent full-frame develop probe verified the
people dictionary against the gold report's develop hash and applied it at native
size before sampling. At that location it produces `[255,240,241]` after display
clipping, versus delivery `[255,236,251]`. Thus develop explains the loss of neutral
white but not the full blue-versus-green separation in that delivery sample.
The [canonical/output control](candle-output-proof.json) subsequently matches those
developed samples exactly to the retained artifact. Public JPEG re-encoding from
that artifact reproduces every decoded pixel of the gold delivery. The same public
output path as PNG yields `[255,240,241]`, whereas JPEG quality 100 yields
`[255,242,242]`. At the three retained candidate locations, PNG equals the clipped
pre-encode samples and quality 88 adds the conspicuous blue/green separation.
This isolates that additional candle chroma to the JPEG round trip, not a new recovery
defect. Already-colored developed pixels remain separate; this does not certify all
flame transitions or accept a new default quality. No encoder setting changed.
Independent numerical review confirms the controls, including all twelve scratch
sample points. Both JPEG variants use 4:4:4: this is not evidence of chroma subsampling.
The same decoder read both JPEGs; separating encoder versus decoder contribution
would require another decoder and is unnecessary for excluding native recovery here.
Applying the preset to an isolated crop would change the spatial-operator context
and was not used.
The pixel selectors only locate pink candidates; neither their count nor absence
establishes photographic success.

Independent numerical review verified ROI lengths/indexing and equality at the
three retained JPEG-selected bridge coordinates. It caught the need to state the
candle's preset mismatch and retain disabled values at those same JPEG-selected
coordinates; both are now explicit in the evidence.

The candle and bridge detail PNGs opened in Preview at 04:23:44 UTC. After about
five minutes without feedback, the evidence-based not-accepted verdict was retained
and close commands targeted those two documents. Silence is not photographic sign-off.

The next fidelity target is upstream bridge chroma, not another candle recovery
patch. Any quality/file-size policy change needs an explicit photographic comparison;
the existing quality control already permits higher-quality or lossless delivery.

No API, schema, runtime policy or acceptance threshold changed. This evidence review
does not require repeating the successful integrated local test gate and does not
close physical-card, other-platform, G3 or paid-history evidence boundaries.
