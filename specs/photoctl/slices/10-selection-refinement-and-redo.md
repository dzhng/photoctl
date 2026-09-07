# Selection correction and redo

## User contract

SAM supplies a starting selection; users and agents can correct it locally through
the CLI. A correction changes the existing layer, not a new selection beside it.
Redo restores saved editing state, not a replay of commands or a purchased request.
These are required v1 features by user direction on 2026-09-07.

## A — Saved-state redo

`photoctl redo <photo>` returns `{id, redone, revision_id, render_hash}`. No available
redo is a successful no-op. Existing undo and redo share transactional revision
activation, including the mutable markup mirror. Roots, layers, geometry, metadata,
execution identities and retained pixels must be the exact saved state.

Persist a photo-scoped redo path under the existing document lock. Undo pushes the
revision it leaves; redo pops it. A successful new revision clears the path in the
single revision-commit owner. Failed edits and conflicts do not clear it. Never
guess a child revision from time/order, and never delete retained history or paid
artifacts when the redo path is cleared. Reopening the library preserves the path.
Use a UUID stack on the existing document row; no second history engine.

This is a clean-start development schema change: add the stack to the schema source,
not an upgrade migration or compatibility branch. Do not reset or silently upgrade
an existing user library. Fresh test libraries establish the new contract.

Verify public multi-step undo/redo, boundaries, restart, branching, failed edits and
conflicts. A generated-image round trip must restore exact output with providers
unavailable and no additional requests. Keep existing undo/markup/retention tests.

## B — Local selection refinement

`photoctl segment <photo> --layer <layer> --operation add|subtract|replace
--box x,y,w,h` (or `--brush '[[x,y],…]'`) targets one active selection layer.
`--norm` retains existing normalized coordinate semantics; brush means a filled
polygon, not a radius-based stroke. Target and operation are required together.
Model prompts are not mixed into this local operation. Existing creation syntax stays.
The result uses the existing manual segment envelope with the same layer ID and
the final mask's artifact hash, bounds and selected-pixel count.

Combine coverage as max(old, operand), old*(1-operand), or operand respectively.
Unchanged fractional coverage remains exact. Subtract-all is valid: keep an empty
selection with zero pixels and zero bounds, which can later receive additions.
Operations that actually need a nonempty subject may report that prerequisite;
emptiness alone must not invalidate stored selection state.

The layer operation owner evaluates the current mask through existing frame and
transform machinery. Manual coordinates mean oriented base-photo coordinates, even
after crop/rotation or layer movement. Preserve mask placement and content alignment;
do not flatten transformed masks into an unrelated naked base-size raster. Refine
the selection's coverage without mutating earlier artifacts or purchased content.
Keep layer identity, content, role, order, opacity, enablement and authored geometry.
An added area cannot invent content outside a generated image's physical support.

Commit the new immutable mask through the existing photographic revision owner with
the loaded revision as its conflict check. No source decoding, SAM or paid call is
required to correct retained masks. No new selection table or model is introduced.

Verify exact small-grid addition/subtraction/replacement, soft-edge preservation,
empty selection and refill, normalized coordinates, transformed/cropped placement,
unchanged unrelated layers and prior artifacts, missing targets and conflicts.
Use public commands and exact undo/redo restoration; test provider-free operation.
Extend the shared built/installed journey for both features after their local gates.

The visual variable is selection coverage: capture the same photographic crop before
and after a deliberate foliage/path correction, with matching overlays. This proves
manual control, not automatic hair matting. Use compare-screenshots for telemetry
and screenshot-critique last for independent visual review. Open the concise set with
preview-shots for a non-blocking review; continue other work and close it after the
short review window if unattended. Existing automatic SAM edge failures remain honest.

## Ownership and closeout

History belongs to graph/store; correction belongs to layer operations; handlers
validate and dispatch. Internal decomposition is delegated. Draft review preferred
two independent implementation passes followed by one integrated journey over a new
generic history/selection subsystem. Run focused red/green checks per pass, review
and audit choices before committing, then the whole-spec gate once at final closeout.

- [x] A: public durable redo
- [x] B: local mask refinement
- [ ] Integrated built/installed and photographic correction witness

Redo's public command, daemon-restart and graph tests pass, including exact generated
preview restoration with an unavailable provider and failed-edit/branch behavior.
Disabling central redo clearing made the public branch test fail, then restoration
passed. Independent history review found no actionable defect. The combined selection
and installed journey remains the integration gate, not implied by this local pass.

Refinement's exact-grid and workbench-frame checks pass, including empty refill,
soft coverage, content support, crop/straighten and later absolute/relative moves.
Independent review found no actionable correctness defect. The integrated built
CLI journey also passes correction, undo and paid-result redo without a new request;
the installed journey remains part of final local closeout.
