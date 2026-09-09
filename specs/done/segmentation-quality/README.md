# Segmentation quality: ZIM and a reusable evaluation record

OpenPhoto uses a local ZIM engine for soft segmentation masks and structured
vision guidance for text selection. The work was driven by the user's PhotoLab
hair-selection reference, then checked against photographic sky, foliage, wires
and pavement. The user accepted a practical stopping condition: explore the
available levers, retain the strongest defensible result and its limitations,
and leave exact reference matching to future work rather than search indefinitely.

## Why this shape

Direct ZIM was the preferred full-frame hair result among the measured models.
It provides learned soft coverage rather than a binary silhouette. Its native
port preserves the accepted reference appearance. This is not a claim of ideal
alpha or generic PhotoLab parity: whole-image wire exclusion, small foliage gaps,
lower hair strands and foreground fence detail remain imperfect.

Several refiners recovered local strands but reopened excluded face, eyebrow,
flower or background regions. A local improvement is not enough when it changes
what the user selected. The production route therefore keeps the direct model
instead of stacking the rejected refinement stages or assembling regional winners.

ZIM's noncommercial use was explicitly authorized for this project. Official
model files come from one pinned revision with verified hashes and retained
notices; the conflicting model-card metadata does not broaden that permission.
No package, model or image publication was authorized by this work.

## Selection intent survives every boundary

Text names the target; an accompanying click chooses the matching instance. A
locating box cannot decide actual membership, particularly when boxes overlap.
Positive and negative guidance belongs to its own instance and one coordinate
frame. The click selects among completed projected masks rather than becoming a
shared prompt that changes all candidates. Ambiguous or unmatched clicks must
not create a revision. The [command owner](../../../packages/commands/src/handlers/segment.ts)
and [frame adapter](../../../packages/commands/src/segmentation.ts) carry this
contract; [consumer tests](../../../packages/commands/src/segment-text-fake.test.ts)
pin its revision and crop behavior.

The [structured adapter](../../../packages/providers/src/adapters/structured.ts)
owns the provider-coordinate boundary. Point conversion is scoped to the
segmentation response, so another structured feature cannot acquire new geometry
semantics merely by returning a field named `points`.

## Preserve model fidelity without replacing the editor

Model-specific pixel preparation and alpha restoration belong to the
[ZIM pixel owner](../../../packages/render/src/zim.ts). The
[runtime](../../../packages/render/src/segmentation-runtime.ts) owns prompt
tensors, score-based candidate selection and bounded feature reuse; the
[native worker](../../../crates/photoctl-image/src/segmentation.rs) owns ONNX
sessions. The captured reference tensors established the port's numerical
contract instead of visual tuning after inference.

Fractional alpha remains fractional through the existing mask store and geometry
projection. No saved-mask migration, alternate segmentation service or fallback
backend was added. Manual correction remains available but is not used to make
an automatic evaluation appear successful. The [refinement tests](../../../packages/commands/src/segment-refinement.test.ts)
pin that independent editing contract.

The large checkpoint makes memory an explicit tradeoff, not a hidden assumption
that every machine can run it. Model download and cache inspection stream bytes
through the [existing acquisition owner](../../../packages/library/src/models.ts),
with one [pinned manifest](../../../packages/library/src/pinned-model-manifest.ts).
The [choices ledger](choices.md) records the operational tradeoffs.

## Evidence to reuse

The durable [evaluation collection](../../../fixtures/segmentation/README.md)
is the starting point for future work. It preserves the exact evaluated sources,
selection intents, prompts, model/build identities and observed masks for the
portrait and landscape. It also indexes varied camera scenes that have not yet
been evaluated. A different render of the same RAW is not the same pixel input.

The supplied PhotoLab screenshot and the extracted video overlay are visual
targets, not exported alpha truth. They differ in framing, grading and display
opacity. Our preferred output is still an observed candidate, never a relabeled
ideal mask. The original still/RAW and ideal PhotoLab alpha were unavailable.
Source-image retention does not establish public redistribution rights.

The collection is the committed, portable evidence set. Older research assets
linked by the spike ledger also remain in the local archive, but its multi-gigabyte
scratch captures and tensor files are not all committed. Those historical links
may therefore need the original research checkout; they are not a reproducible
download bundle.

The [reference-framing audit](assets/reference-audit/critique.md) explains the
bounded portrait comparison. The [native comparison](assets/native-zim/critique.md)
records preservation of that appearance. The [actual CLI holdout review](assets/cli-holdout/critique.md)
records the remaining generic defects despite passing coarse area probes.
An actual automatic whole-person ZIM trial was unavailable at this closeout
because no gateway key was configured. Subsequent [live CLI evaluations](../../../fixtures/segmentation/portrait/photolab/live/README.md)
retain the now-completed person trials and hair control, including their failures;
deterministic routing tests never replaced that evidence.

## Explored levers and rejected shortcuts

The [spike ledger](spikes.md) retains the measured controls and model provenance:

- Larger SAM and different candidate modes did not consistently recover the
  required boundaries. Higher input resolution improved detail but introduced
  prediction dropout; orientation and intermediate-resolution controls did not
  establish a stable repair.
- Automatic signed guidance established semantic intent. Additional point
  verification did not provide a clear improvement over the accepted ZIM input.
- Native-scale photographic crops recovered wires locally. Automatic crop
  guidance regressed on portrait hair, so that success did not justify a generic
  tiled pipeline.
- Classical matting, learned trimaps and multiple trained refiners exposed a
  recurring detail-versus-selection tradeoff. The user specifically rejected
  MGMatting's eyebrow inclusion despite its recovery of lower strands.
- Native SAM 3 established text/instance scope but not the desired fine edges.
  Available Apple APIs provided useful person baselines, not the required
  generic hair-selection contract; no OS upgrade was authorized.

These are reasons not to repeat the same controls blindly, not proof that all
future approaches are exhausted. Better context-preserving resolution handling
and semantically constrained detail recovery remain useful directions for the
reference collection. The [verification record](verification.md) distinguishes
what actually ran from unavailable checks.
