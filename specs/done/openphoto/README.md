# OpenPhoto installation and provider boundaries

OpenPhoto has an installable public command and machine-local credential setup,
with deliberate real-provider verification outside ordinary tests. This record
explains the boundaries behind that workflow. The root
[installation guide](../../../README.md#installation-and-credentials) owns user
setup; the [choices ledger](choices.md) records the decisions made during the work.

## Credentials belong to the machine, not the photo catalog

A catalog can be copied or backed up without carrying the credential that pays
for inference. Configuration therefore runs before library/daemon acquisition
and makes no network request. The private plaintext file is an owner-only local
value store, not a credential vault or a formatting-preserving dotenv editor.

An explicit environment value wins, including an empty value used to disable
providers. Without an explicit key, normal commands read saved credentials before
dispatch. Saving a key does not itself cancel work. The daemon adopts it on the
next foreground request, using its existing embedding pause/resume behavior:
an active embedding request can be aborted so the foreground command can run,
and indexing resumes afterward. This avoids a separate credential-update channel
or a filesystem watcher whose timing would become part of the contract.

The [configuration owner](../../../packages/commands/src/configure.ts),
[request boundary](../../../packages/commands/src/execute.ts) and
[terminal input](../../../apps/cli/src/configure-input.ts) keep storage, dispatch
and prompting separate. Built-CLI and terminal coverage live in
[configuration tests](../../../apps/cli/src/configure.test.ts) and
[Mac terminal tests](../../../test/macos/configure.test.ts).

## Public naming does not require a storage migration

The public package/bin and separately installed native dependencies must agree.
Private package names, catalog locations and `PHOTOCTL_*` controls do not need to
change with the product label. Keeping those boundaries avoids an unrelated
catalog migration or alias layer.

The [packer](../../../scripts/pack.mjs),
[version synchronizer](../../../scripts/sync-versions.mjs) and
[packed-install test](../../../test/macos/packed-install.test.ts) establish the
installed boundary rather than relying on checkout-only resolution. Closing this
record means working-tree implementation, not permission to publish; publication
remains a separate explicit release action.

## Protection is local; model interpretation is not a guarantee

The application guarantees that pixels with zero effective mask coverage remain
unchanged. Feathering or expansion changes that effective coverage deliberately;
the strict live proof uses the authored selection without either. A model's
interpretation of a mask or prompt is not the owner of this guarantee.

The native-mask request did not protect the expected region, so GPT Image 2 uses
explicit instruction-and-local-composite transport. Native polarity is still
unverified, and unknown native profiles remain guarded. This is not an automatic
fallback after purchasing a failed native edit. Because the provider sees the
context crop rather than the exact selection outline, local clipping can remove
the strongest material cues from an otherwise plausible generated object.

Provider size requirements are also separate from selection geometry. The
[frame planner](../../../packages/providers/src/image-frame.ts) preserves content
proportions through integer enlargement and declared padding; it does not enlarge
the selected region. The
[normalization boundary](../../../packages/render/src/provider-images/normalization.ts)
retains valid raw output before extracting only the declared rectangle. A mapped
response with different canvas dimensions is retained but refused, not guessed
into place. The [adapter](../../../packages/providers/src/adapters/image.ts)
owns wire preparation, while request records distinguish the provider canvas,
content mapping and working pixels. Refresh replaces obsolete mappings explicitly.

## Live evidence is opt-in and contract-specific

Ordinary tests must not inherit a developer's saved or ambient gateway key. The
[CLI test driver](../../../packages/test-harness/src/spawn.ts) enforces that
boundary; the [live runner](../../../scripts/live-gateway.mjs) accepts an explicit
key, uses a disposable home/catalog and removes its saved credential on completion
or normal interruption. Verification uses synthetic or retained inputs, not camera
files. Successful or ambiguous
paid mutations are not automatically repeated; explicit rate-limit rejections
use the normal bounded transport. Estimates and recorded costs are not spending
ceilings or invoices.

Purchased-image replay is proved with credentials disabled and a fresh preview
cache. Undo/redo must preserve pixels without creating another provider attempt
or purchased execution. HTTP success, correct-shaped embeddings and a plausible
preview establish different facts; none substitutes for the others.

The [verification record](verification.md) separates accepted transport,
pixel/replay evidence, native-mask failure and visual-quality limitations.
Structured analysis has its own bounded per-attempt timeout because valid
reasoning can outlast ordinary transport; other request timeouts are unchanged.

## Rejected approaches worth remembering

- Caption-only embedding can falsely appear to index photographs. The
  [embedding adapter](../../../packages/providers/src/adapters/embedding.ts)
  keeps image bytes as native multimodal input, and the smoke refuses evidence
  that does not distinguish changed images from repeated images.
- Exact-ratio aligned sizes alone reject ordinary odd-sized crop dimensions.
  Declared padding provides a general mapping without changing the selection.
- Counting every positive soft-mask value made a useful grounded mask appear
  full-frame. The grounding check uses the CLI's selection threshold without
  changing the underlying alpha values.

## Visual provenance

The inputs are synthetic fixtures, not user camera photographs. The live runner's
[red circle on blue](assets/live-gateway/input.jpg) exercises selection and edit
boundaries. Its generated/reimagined/relit outputs and replay observations are
linked from the verification record; they demonstrate transport, not general
photographic quality.

The [native-mask input](assets/mask-polarity/input.png) uses differently colored
rectangles so a protected-side change is visible. Its mask, response and numerical
comparison remain retained even though that convention failed verification.

The final masked [before](assets/live-gateway/masked-before.png) and
[after](assets/live-gateway/masked-after.png) are lossless display views of the
retained canonical base/composite artifacts. The
[selection](assets/live-gateway/masked-selection.png), zoomed details and
[raw provider output](assets/live-gateway/masked-provider.png) explain both the
exact local protection and the missing glass-edge cues. The
[independent critique](assets/live-gateway/masked-critique.md) records that quality
limit rather than relabeling a correct pixel boundary as a natural-looking edit.
