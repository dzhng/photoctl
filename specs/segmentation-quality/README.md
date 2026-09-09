# PhotoLab-quality segmentation

The user supplied [this PhotoLab reference](assets/photolab-reference.png) on
2026-09-09 and explicitly requested comparable automatic segmentation quality,
with empirical spikes before the implementation plan. The earlier v1 acceptance
of coarse SAM plus manual correction does not satisfy this new goal.

## Next Agent Prompt

Updated 2026-09-09. Execute the [implementation ladder](implementation.md),
starting with model-acquisition integration and the command slice. Signed
grounding and the pixel library are committed. The engine matches the accepted
portrait appearance, its native/geometry tests pass, and its reviewed 16-encode
probe passes the measured 10 GB canary. Acquisition is ready on its independent
branch; do not release these partial checkpoints. The three planning drafts have been synthesized;
do not restart the interview or model search. The full quality goal remains open.
The user approved `--text` plus `--at` choosing the clicked matching instance;
wire that in the command slice. The actual whole-person automatic trial still
needs a saved or environment gateway key. Neither is configured on this host.
Start with the
[reference-framing acceptance audit](assets/reference-audit/critique.md): direct
ZIM is comparable to the supplied PhotoLab screenshot at its visible viewport,
with a lower-strand limitation in the supplementary full-video crop. Carry it as
a portrait planning candidate, not a proven generic backend. The user explicitly
authorized ZIM adoption for OpenPhoto's intended noncommercial use. Retain the
repository's noncommercial terms and notices; do not treat the conflicting model
card as permission for commercial use. Do not keep demanding an ideal matte from this
compressed overlay reference. The [research gap synthesis](research-gaps.md)
and [spike ledger](spikes.md) own completed/rejected approaches and remaining
generic holdouts. Do not repeat those baselines or silently relax selection
intent. The [candidate research](refinement-candidates.md) owns frozen inputs
and runtime requirements. Do not infer permission to adopt noncommercial
dependencies from research use.

Follow the implementation ladder, preserving `--text` selection for both hair
and entire-person requests. The user explicitly rejected MGMatting's eyebrow
selection despite its lower-hair improvement; do not include that refinement.
Existing CLI commands and saved fractional masks must survive the internal model
cutover. Publication remains a separate authorization.

The [native SAM 3 baseline](assets/sam3-native/critique.md) is complete and shows
scope feasibility, not boundary parity. Its access prerequisite is resolved.
Keep [selection scope](scope.md) separate from quality and preserve target intent
through the backend seam. Update this handoff after the next measured result.

## Evidence and acceptance

The user explicitly preferred direct ZIM among earlier displayed candidates.
The reference-framing audit now supports its comparable portrait appearance at
that viewport. MGMatting recovers more strands but selects eyebrows. Complete
feature-level alpha equivalence and generic selection quality remain unproven.
SAM2Matting-Tiny, ViTMatte refinement and automatic crop variants fail
hair-detail review. Local photographic crop success does not establish a generic
tiled solution. Keep rejected refinements out of production. Noncommercial ZIM
adoption is authorized; this does not relicense unrelated project code.
The [spike ledger](spikes.md) owns completed and rejected comparisons, including
the user's preference for higher-resolution SAM despite its unresolved dropout,
and the [Apple-native boundary evidence](assets/apple-vision/critique.md).
Preserve every candidate. Full-feature and generic parity remain unproven.

A matching unmasked frame and hair overlay were extracted from the official public
video. They are compressed and differently graded, not original photography or an
exported alpha mask. The source is available locally for research; no redistribution
license has been established. The screenshot shows a hair-only selection around
curls, excluding face, flowers and background. Separate semantic selection from
soft-edge matting; record latency and memory without treating the adjustable RSS
canary as a hard optimization target.

The parallel OpenPhoto naming/configuration and authorized live-gateway integration
work remains separate in [its plan](../openphoto/README.md). Do not modify camera
files, upgrade the OS, or infer authority to publish. Keep size, prompting,
resolution and matting as separate experimental variables; record actual model
and runtime revisions, and distinguish runtime feasibility from visual quality.

Visual acceptance requires comparable full images and edge crops, numerical
telemetry from `compare-screenshots`, and an unprimed `screenshot-critique`.
Do not accept a coarse mask because its area overlaps the subject, a blurred
boundary because it hides errors, or a hair-specific path as generic segmentation.

## Remaining contracts

- [ ] Hair requests exclude face, flowers and unrelated objects; person requests
      retain their explicitly broader scope.
- [ ] Refinement recovers curls and holes without reopening semantic exclusions.
- [ ] Independent full-frame/crop review, plus existing wire and foliage holdouts.
- [x] Synthesize the [implementation ladder](implementation.md) after a defensible quality candidate.
- [ ] Implement through existing projection, mask storage and CLI owners with
      red/green tests; no parallel segmentation API or manual rescue requirement.
- [ ] Verify actual production output and run the final closeout gate once.
