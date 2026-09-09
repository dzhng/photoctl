# PhotoLab portrait: hair selection

The intended target is the woman's hair, including visible curls and strands,
while excluding face, exposed skin, flowers, clothing and background. Hair and
entire-person requests have different scope; no completed automatic whole-person
result is recorded in this case.

## Inputs and visual targets

| Asset | Meaning |
|---|---|
| [Clean source](source.png) | Complete 1614×1080 unmasked video frame requested at 14.5 seconds. This is the actual upstream ZIM input. |
| [User screenshot](references/user-screenshot.png) | The supplied PhotoLab quality target at its clipped webpage viewport. |
| [Video overlay](references/video-hair-overlay.png) | Complete frame requested at 8.5 seconds, including the green hair overlay, cursor and tool marker. |
| [Acquisition provenance](source-provenance.md) | Recorded source pages, timestamps and limits of the compressed video extraction. |

The screenshot and video overlay are visual targets, **not ground-truth alpha**.
Grading, display opacity and framing differ from the clean source. The original
portrait still/RAW and PhotoLab's exported mask are unavailable. The retained
[registration report](metadata/reference-audit.json) describes how the screenshot
viewport was related to the video; do not compare unregistered pixels or infer
alpha by subtracting the differently graded frames.

## Observed results

| Asset | Provenance and limits |
|---|---|
| [Upstream ZIM alpha, 16-bit](observed/zim-upstream-alpha16.png) | Selected upstream points-only result, not an ideal target. [Grounding](metadata/grounding.json) retains the exact automatic prompt, normalized points, pixel points and per-point descriptions; [model report](metadata/zim-report.json) retains scores and model/runtime identity. |
| [Native ZIM overlay](observed/zim-native-overlay.png) | Separate native points-only display result with a fixed 60% green overlay. [Runtime](metadata/native-runtime.json) and [comparison measurements](metadata/native-metrics.json) distinguish it from the upstream alpha. |

The original grounding capture's mention of three masks predates this ZIM run.
The model report is authoritative: four candidates were produced, and score
argmax selected index 3. No visual candidate substitution was used. The native
capture's re-encoded source has the same decoded RGB bytes as `source.png`; file
hashes differ and are recorded in the [case manifest](manifest.json).

Recorded review judged the upstream/native appearance comparable to the supplied
PhotoLab viewport. It also found missing lower dangling strands, incomplete fine
hair retention, some background haze and small skin/fringe leakage. Face and
flowers were largely excluded. The lower-strand limitation is more apparent in
full-frame supplements than in the user's clipped viewport. This is a bounded
visual assessment, not ideal-matte equivalence or generic segmentation quality.

The alpha PNG quantizes the upstream f32 output to 16 bits. The native overlay is
a display composite from a separate native run; it is not an encoded alpha mask
and must not be used as one. Model weights and raw candidate tensors are omitted.

Owner authorization permits this local collection. The acquisition note's older
research-only wording records the circumstances of extraction; it does not grant
redistribution rights. DxO/source-photographer rights remain unresolved for
publication, and ZIM's retained noncommercial terms still apply to its artifacts.
