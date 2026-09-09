# PhotoLab-quality segmentation

The user supplied [this PhotoLab reference](assets/photolab-reference.png) on
2026-09-09 and explicitly requested comparable automatic segmentation quality,
with empirical spikes before the implementation plan. The earlier v1 acceptance
of coarse SAM plus manual correction does not satisfy this new goal.

## Next Agent Prompt

Updated 2026-09-09. Finish the [reference collection](slices/07-references.md),
then run the [practical closeout](slices/06-acceptance.md). The user explicitly
permits stopping without an exact PhotoLab match after the practical levers
have been explored and the best result, references and limitations are retained.
Do not restart the model search or turn known quality defects into parity claims.

The ZIM engine, acquisition and signed grounding are integrated. Text plus click
now chooses an instance by projected mask coverage; all 31 integrated selection
and refinement tests pass. Whole-cutover independent review found no actionable
regressions; some reviewer tests were sandbox-blocked. The full closeout gate
has not run. The actual automatic whole-person trial still needs a gateway key;
neither the saved configuration nor environment provides one. Report that missing
verification rather than substituting a mocked live result.

The [reference-framing audit](assets/reference-audit/critique.md) supports
comparable portrait appearance, and the native port preserves it. The
[actual CLI holdout review](assets/cli-holdout/critique.md) records coarse smoke
success but visible wire, foliage and fence exclusions that still fail. The
[research gaps](research-gaps.md), [spike ledger](spikes.md) and
[candidate research](refinement-candidates.md) retain the explored levers.

Preserve [selection scope](scope.md), fractional saved masks and the existing
projection/revision owners. ZIM's noncommercial adoption is explicitly authorized;
retain its notices. MGMatting refinement was rejected because of eyebrow
selection. No release publication or broader commercial-use permission is implied.

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

## Practical closeout

- [x] Preserve separate hair/person intent and signed guidance through the command seam.
- [x] Record detail recovery and semantic exclusions honestly, including rejected refinements.
- [x] Independent full-frame/crop review, plus actual CLI wire and foliage holdouts.
- [x] Synthesize the [implementation ladder](implementation.md) after a defensible quality candidate.
- [x] Implement through existing projection, mask storage and CLI owners with
      red/green tests; no parallel segmentation API or manual rescue requirement.
- [ ] Retain the organized reference collection and observed outputs.
- [ ] Run the final closeout gate once and record unavailable live-provider verification.
