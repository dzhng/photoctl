# Comparing alternative generations

Status: discovery placeholder, not an implementation plan.

## User outcome

Select a shirt, ask to make it blue with Flare, then try another Flare result or
Sunburst from the same original input, selection and prompt. Compare two or more
saved results at the same framing and switch the chosen result without another
provider call or undoing unrelated work. Editing an accepted result again is a
different action from trying another answer to the original request.

## Product shapes to explore

- First-class alternatives attached to one edit, with compare/select operations.
- Generalized duplicate-layer workflow, with shared input and convenient mutually
  exclusive visibility, rather than a separate generation-only abstraction.
- General revision/branch comparison that also serves non-generative edits.

These are candidates, not decisions. Explore concrete CLI journeys and comparison
mockups before choosing ownership or storage. Determine whether an alternative
belongs to a layer, an operation or a document revision; how later edits react to
switching; and how retention, deletion and naming should work.

## Existing foundations and gaps

The [history owner](../packages/render/src/graph/store.ts) retains revisions, but
ordinary redo does not expose an old branch after a new edit. The
[layer commands](../packages/commands/src/handlers/layer.ts) already offer duplication
and visibility controls. The
[refresh entry point](../packages/commands/src/handlers/fill.ts) reuses the recorded
model rather than offering a new-model alternative. The
[A/B report](../apps/workbench/src/ab.ts) compares exported images, not selectable
alternatives in a photo document.

## Next exploration

Use explore-unknowns to compare the candidate product shapes with the user, then
write-spec once the shape is chosen. Preserve CLI-first capability parity and
paid-result reuse. Do not add a variants table, new commands or a picker from this
placeholder. The GPT Image 2.5 adapter migration is separate and must not absorb
this product exploration.
