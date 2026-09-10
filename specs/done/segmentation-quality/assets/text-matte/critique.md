# Text guidance did not preserve the requested scope

TeachDiffusionMatting's released SD 2.1 model was evaluated with its complete
high-resolution stage. It is not accepted for hair selection or generic
segmentation. The [replication evidence](replication.md) separates runtime fidelity
from this visual verdict. None of these results entered production.

## Hair-only comparison

Two independent, unprimed reviewers inspected the complete full-frame and six-region
capture sets: crown, right fringe, forehead curl, flowers, bottom curls and the
supplemental crown artifact region. Both ranked ZIM above native SAM 3 and above
the text-guided model, with high confidence. The parent inspected the same regions.

The [short-prompt captures](portrait/review/capture-report.json) use `hair`.
The [explicit-prompt captures](portrait-explicit/review/capture-report.json) use
`the woman's curly hair`. In both sets A is native SAM 3, B is ZIM, and C is
TeachDiffusionMatting. Those neutral labels belong to these specific review sets,
not to a persistent model naming scheme. User-facing future shots should use
model names; independent reviewers should still receive neutral labels.

| Region | Short prompt | Explicit phrase |
| --- | --- | --- |
| Crown and right fringe | Missing upper curls and outward corkscrew; fuzzy silhouette and abrupt rectangular interruptions. | More open curl holes, locally less background veil than ZIM; still misses the far corkscrew tip and has small straight-edged defects. |
| Forehead and flowers | Selects the visible face/eye and leaves orange petal rims. | Same decisive scope failure, with stepped flower cutouts and selected skin. |
| Bottom | Missing hanging curls, selected shoulder/clothing and rectangular edge defects. | More fine structure, but faint on black; still selects shoulder and clothing. |

ZIM remains imperfect: skin haze inside the forehead curl, pale/green background
between fringe hairs, excessive softness and missing longest lower loops. Its
fractional alpha is not itself a defect; incorrect partial coverage in a clear
gap or a solid curl is. Black/white composites use the source RGB without foreground
color estimation, so color contamination and alpha error are distinct causes of
visible fringes. The alpha views independently show scope and coverage errors.

The user explicitly preferred B/ZIM on 2026-09-09 after viewing both text-model
comparisons. This is a preference among measured options, not a declaration of
PhotoLab parity. The three-shot Preview checkpoint was closed after review.

The full-image mean absolute alpha distances from ZIM are 0.18188 for `hair` and
0.19017 for the explicit phrase; changes exceed 0.1 on 22.27% and 23.31% of pixels.
These locate disagreement, not accuracy. Raw fractional alpha, 16-bit/8-bit
representations, overlays, black/white composites and every crop are retained
under the two portrait folders.

## Scope holdouts

An independent reviewer inspected all full views and all person/landscape crop
regions, including the clothing and distant-path supplements. The
[capture report](visuals/holdouts/capture-report.json) owns the exact bounds,
projection and per-region numerical comparisons. P/S/U are native SAM 3;
Q/T/V are TeachDiffusionMatting; R is Apple's accurate person mask.

- **Person:** Native SAM 3 is less wrong for visible-human-only scope. The text
  model removes much of the crown/right/lower hair and punctures the remaining
  hair beside the eye with a rectangular hole. It leaves petal fragments and
  misses clothing behind the wrist. Apple's finer hair edge is real, but it
  includes the bouquet and therefore answers a different, broader request.
- **Sky:** The text model misses essentially the entire sky and selects a tiny
  unrelated railway-area patch. Native SAM 3 captures the broad region but
  misses foliage holes and inconsistently excludes wires with thick gaps.
- **Road:** The text model selects one small foreground patch plus faint
  texture-following streaks, with fence/railway/grass leakage. Native SAM 3
  retains most foreground pavement but breaks the distant continuation and
  has a small extraneous grass patch.

The reviewer ranked native SAM 3 above the text model for all three targets,
with high or very high confidence. Softer edges cannot compensate for missing
regions or changed target membership. These are failures of the measured CPU
replication and fixed prompts, not a benchmark-wide claim about every possible
prompt, checkpoint or device.

## Consequence

Do not add TeachDiffusionMatting to the product or tune prompts indefinitely on
this portrait. Preserve SAM 3 as a semantic baseline and ZIM as the strongest
measured hair-detail reference. The remaining work must establish both scope
and boundary quality before an implementation ladder can be accepted.
