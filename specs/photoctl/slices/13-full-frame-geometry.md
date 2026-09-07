# Full-frame generation in authored coordinates

## Contract and input decision

Reimagine and relight must accept cropped, rotated, straightened and reduced offline
photographs through the same render-frame model as other photographic layers.
Their result remains a removable layer. Existing strength/intensity is unchanged:
versioned provider guidance and one constant blend coverage, not latent denoise.

**User-approved input policy, 2026-09-07:** use the current photographic
result, excluding final markup. This includes prior retouch/fill/outpaint layers.
The alternative is the developed original branch; it must not be silently substituted
or implemented as a runtime heuristic. Do not add a new CLI option just to preserve
both proposals. Record the chosen policy with the immutable generation intent so
inspection and explicit refresh use the same meaning.

Capturing existing edits means their pixels are baked into the purchased result:
removing an earlier layer does not erase its appearance from a later generation.
Ordinary display never regenerates that result. Explicit refresh uses the captured
predecessor membership, with current enablement and order, excluding the selected
layer and all later layers. This follows the existing captured-input contract rather
than discovering predecessors from today's complete output.

The user requires a clean-start development cutover: no migration, backfill, legacy
branch or automatic real-library reset. Internal module names and decomposition are
delegated; new storage is justified only when an actual writer and reader need it.

## Existing owners and prerequisite

The full-frame entry point is `packages/render/src/reimagine.ts`; both CLI verbs use
the command full-frame owner. Creation now reads the photographic output and places
RGB and coverage with their authored frames. Raster dimensions alone cannot establish
location in the document; the former geometry refusal was removed only after the
public placement and restoration regressions passed.

Use the graph's existing `RenderFrame`, raster-preserving placement transforms,
photographic output planner, geometry checkpoints and exact execution frames.
Mask projection must consume the mask's own physical frame and authored support,
not assume all non-border masks are catalog rasters. The retouch/outpaint journey
owns that shared correction first; integrate it rather than creating a second mask
projection implementation. A placed full-frame layer is not a border and must not
acquire border-ring subtraction or expand the canvas merely by existing.

Paid generation, density processing, original-response retention, attempts, artifact
validation and atomic revision publication retain their current owners. The shared
retained-output reader provides verified current-render pixels with their exact
execution frame; live-source promotion remains in the source-selection owner.

## A — Frame-owned creation and reversible placement

Capture one document snapshot and the selected photographic input. Bind the input
node, actual artifact/execution and its realized frame through existing graph owners.
Persist the authored physical footprint, input policy and predecessor relationship
with generation intent. Do not reconstruct an execution frame from catalog size or
choose a frame merely because its artifact bytes match.

Send the selected input's actual pixels to the existing generation owner. Density
matching targets the authored viewport at its intended sampling, not the uncropped
catalog rectangle. Keep returned RGB sampling separate from its physical placement;
use existing placement and coverage projection for both RGB and the constant mask.
Do not create a competing compositor, apply strength twice, or use a full-frame mask
to reveal content outside the authored footprint after a later crop change.

Commit the new layer through the single photographic output/revision owner. The
public red/green tests prove placement and restoration. No temporary placement
library ships without a real consumer.

Public gates:

- Asymmetric input with nonzero crop origin, quarter-turn, fractional straighten,
  equal-size/different-coordinate frames and reduced pinned-source sampling.
- Existing photographic edits and visible markup distinguish transmitted input
  policy; provider input excludes markup and includes captured predecessors.
- Strength zero, intermediate and one preserve the established blend formula.
- Show/export, disable/re-enable, remove and undo preserve exact canonical pixels
  and frames at the same available source execution, with no further provider work.
- Later geometry changes preserve authored support; existing outpaint and ordinary
  manual/fill/retouch paths remain correct.
- Publication or compare-and-swap revision failure preserves active state and retains
  the provider attempt wherever original capture succeeded.

Visual checkpoint: before, generated, later-geometry and restored frames of an
asymmetric fixture. Judge placement/support only, not provider aesthetics. Run
compare-screenshots telemetry and an unprimed screenshot-critique last; retain the
small comparison set under the owning spec assets. Human feedback is non-blocking.

### Creation candidate evidence

Pass A is implemented as a frame-owned creation candidate. Its focused public checks
cover crop/quarter-turn placement, fractional straighten and all three strength regimes,
same-size shifted viewports, exact later-crop support, show/PNG export, toggle/remove/undo,
photographic predecessor input without markup, reduced pinned-source generation and
publication/CAS failure retention. Replacing the creation owner with its pre-pass code
produces the expected geometry/pinned refusal and wrong-input failures; restoration is green.
The existing built reimagine journey also passes. [Candidate evidence](../assets/full-frame-geometry/README.md)
records the exact limits and the independent eight-image visual acceptance for
synthetic placement/support only.

Merged generic transforms preserve each branch's authored placement when replacing
its movement matrix. The public retouch regression failed even for a zero translation
before this correction; it now preserves exact pixels and survives a translation
round trip. Full-frame zero translation, ordinary layers and density-transform
neighbors also pass: 38 merged checks plus build/typecheck and scoped lint. Independent
static review found no remaining actionable issue. Border identity is no longer a
special case for recovering a frame already owned by the branch.

Creation records the input execution alongside its actual frame because generated-node
input artifact hashes cannot distinguish identical bytes in different coordinates. The
physical viewport comes from that execution; logical viewport sampling controls the density
target. RGB retains its generated/upscaled sampling, and an explicitly placed constant mask
owns strength and coverage. This uses the shared mask-frame evaluator prerequisite.

Pass B now supplies explicit refresh and retained-input source selection; its evidence is
separate from these creation witnesses.

## B — Explicit refresh, source promotion and packaged lifecycle

Recognize full-frame generation explicitly at the shared layer-refresh dispatch
boundary. The existing masked-fill descriptor expects crop/mask ancestry and cannot
be reused by pretending missing fields are a fill request. Use a typed operation
distinction and share generation/density/attempt/revision execution, not a second
provider pipeline.

Generation refresh reconstructs the recorded input policy from captured predecessors
and current eligible source/develop state, without consuming itself or successors.
Preserve the authored physical viewport and strength; changed source sampling must
not silently re-author coverage. Upscale-only refresh consumes the retained generation
and does not purchase another generation. Ordinary source reconnect promotes only
deterministic work; paid pixels remain pinned until an explicit refresh.

Public lifecycle gate: reduced offline generation → show/export → reconnect → native
show/export → generation refresh → upscale-only refresh → undo/remove. Check exact
frames and independently decoded delivery pixels, honest original-source quality,
unchanged paid execution IDs across reconnect, distinct attempts for explicit calls,
and no replay when retained artifacts are missing/corrupt or a response is lost.
An opaque detailed generated layer must not falsely certify the original as native;
zero/intermediate strength exposes reduced original contributions.

Wire this lifecycle into the existing built and packed public journey. Reuse permanent
camera originals for orientation/source membership and deterministic asymmetric pixels
for exact placement. Use the real HTTP fake gateway, not a live paid provider. Inspect
offline/online detail at identical base coordinates, run compare-screenshots, then an
unprimed screenshot-critique. Record photographic/live acceptance separately.

## Closeout and draft synthesis

### Refresh candidate evidence

The shared layer-refresh boundary recognizes a typed full-frame descriptor instead of
inventing masked-fill crop fields. Fresh generation, density processing, attempt retention
and atomic revision publication keep their existing owners. Refresh reconstructs captured
predecessor membership with current enablement and ordering. An already matching viewport
keeps the ordinary photographic recipe and its retained execution; changed geometry uses
the same photographic planner with the captured physical viewport and current color develop.
RGB sampling can change without changing the constant mask, placement or strength.

The source-selection owner prefers live original evaluation, then a verified retained
current input at least as good as a fallback, and finally retained-only input if no bytes
can be decoded. It never substitutes a different photographic recipe or replays paid work.
The same evaluator has a no-source/no-provider retained policy for first show/export of
new deterministic descendants. It reuses verified executions by their exact node identity;
it never supplies a photographic composite as the original source or reapplies predecessors.
Upscale-only refresh consumes the retained generation; failure preserves the last usable
upscale. [Refresh evidence](../assets/full-frame-refresh/README.md) records focused, built,
installed and permanent-original boundaries, plus fresh independent visual acceptance
for synthetic placement/sampling. Integrated whole-spec closeout remains separate.

Use write-tests red/green and the narrow owning Node/Vitest runners during iteration;
then review/refactor-clean/code-review/write-docs and audit-choices before each commit.
Run the whole-spec root gate only at integrated closeout, not once per pass here.

Three independent drafts covered fewest slices, risk-first ordering and seam quality
(the latter from Claude). They agree on authored placement, mask-frame ownership,
explicit refresh recognition and no paid replay. The canonical ladder combines the
risk draft's probes into two useful vertical passes rather than shipping intent-only
scaffolding. It rejects a speculative input-mode CLI flag, a second compositor, and
treating developed-original input as permission to discard the user's current crop.
Retouch's shared mask-frame correction is a prerequisite, not duplicated work.
