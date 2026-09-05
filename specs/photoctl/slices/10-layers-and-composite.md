# 10 — DAG-backed layers, transforms, composite, vacancy, A′ delta/stale (no SAM, no gateway)

Sub-slices, one ownership seam at a time: **10a ✓** layer identity + immutable revision model · **10b1 ✓** generic Rust
resample/transform · **10b2** mask artifacts + mask/lift/composite · **10b3** develop compensation/delta · **10c1** manual
mask and layer command integration · **10c2** stale/delta, vacancy, move, and warnings. Slice 10's migration is schema v9 and
must land after 09c owns v8. 10a may run beside 08c2/08c3 only while it stays out of Rust, the evaluator, preview, command
dispatch, and protocol exports. No 10b pass may overlap 08c2/08c3 in those shared owners.

## API seam

- **10a identity and schema:** schema v9 adds stable `layers(photo_id,id,role,of_layer,created_at)` identities and immutable
  `document_revision_layers(photo_id,revision_id,layer_id,name,z,content_node_id,mask_node_id,opacity,blend,enabled)` snapshots.
  Keys are
  `layers primary key(photo_id,id)`, a global layer-id lookup index, `document_revision_layers primary key
  (photo_id,revision_id,layer_id)`, and `unique(photo_id,revision_id,z)`. Composite foreign keys carry `photo_id` so a revision,
  layer, content node, or mask node cannot cross photos. Checks enforce `z >= 0`, `opacity between 0 and 1`, the named roles, and
  initially only `blend='normal'`; application validation additionally requires contiguous z order, legal `of_layer` role
  pairings, an RGB content root, and a mask root. A name belongs to the revision snapshot because rename creates a revision. `remove` and `clear` omit
  identities from a new snapshot; they never delete rows retained by history. Layer selection accepts a full id or an unambiguous
  id prefix; names are presentation, not identity.
- **10a document contract:** revisions gain a typed `base` root alongside `output`; migration backfills existing revisions with
  `base=output`. The revision writer accepts newly-created layer identities, the complete ordered layer snapshot, graph drafts,
  base/output roots, and the expected active revision in one transaction. A failed CAS therefore leaves neither a partial revision
  nor orphan user-visible identities. Disabled layer roots remain revision/retention roots even though active composition omits
  them. Reachability unions base, output, layer, undo, and pinned roots.
- **10a composite v2:** input 0 is the base root; each enabled layer then contributes an ordered `(content_node_id,mask_node_id)`
  input pair in z order. Parameters are `layers:[{opacity,blend}]`, aligned one-for-one with those pairs. Evaluation folds each
  masked content input over the accumulated prior result, so transparent regions of a later layer cannot replace earlier layers
  with base pixels. Layer ids and names are excluded because they do not affect pixels. The application proves the recipe is the
  exact projection of the revision snapshot. This is recipe version 2; the provisional v1 shape is not silently reinterpreted.
- **10a branch vocabulary:** add a typed deterministic `mask` node for permanent manual/SAM mask artifacts and a typed
  deterministic `delta` node for develop compensation; neither overloads `develop`. A revision-layer row binds one RGB content
  root to one mask root; composite v2 is the only owner that combines the ordered pairs with the base. One canonical transform
  matrix is applied to both lifted content and its active mask; an absolute request replaces both transform nodes over unchanged
  inputs, while `--relative` composes the matrix. Move retains the untransformed silhouette mask as the vacancy layer's mask and
  points the subject layer at the corresponding transformed mask. Provider-backed refresh may replace the content branch later
  without changing this invariant.
- **10b1 transforms/resampling:** `packages/render/src/{layers,transforms}` owns
  `Transform{dx,dy,scale,rotate,flip,anchor}`, absolute default, `--relative`, and S→R→T about the anchor (default mask
  centroid) as one canonical matrix. `photoctl-image::resample` becomes the one owner of every non-delivery pixel resize. Preview
  mapping/downsampling uses its bilinear mode; layer/composite rendering uses Lanczos3; exact flips and quarter-turns remain
  integer transforms. Sharp remains only the encoder/profile writer and the final delivery downscale named by the global rule.
- **10b2 masks/composite:** canonical masks use a distinct deterministic single-channel Float32 TIFF artifact contract and media
  type owned beside, but never confused with, Slice 08's scene-linear RGB artifacts. The artifact hash covers exact coverage
  samples in `[0,1]`; typed publication/read/validation/repair reject RGB artifacts and wrong sample formats. Add Rust
  dilate/erode/feather, overlay, lift, transform, and strict mask-composite kernels. Every pixel outside the effective mask is
  copied exactly from the node's base input. The final composite evaluates v2 in its relational input order.
- **10b3 delta:** `photoctl-image::delta` applies a Tier-1 operator as a deterministic compensation node to the old generated or
  pinned branch. Compatible develop changes return actual layer ids in `delta_applied`; incompatible changes keep the branch bound
  to the exact develop ancestor it saw and return the ids in `stale` with `layers_stale`. A later provider refresh rebinds the
  branch to current develop. Compatibility is derived from Slice 08's one `DEVELOP_OPERATORS` tier owner: exposure, brightness,
  contrast, saturation, vibrance, and black point are Tier 1; white balance is Tier 1 only for `|temp_offset_k| <= 300`; every
  Tier-2 operator is stale. Compensation is evaluated in the shared scene-linear working space, not by round-tripping through
  display pixels.
- **10c1 commands:** `segment --box x,y,w,h | --brush '[[x,y],…]'` deliberately owns only these manual modes before Slice 11's
  model-backed `segment`; it creates permanent mask artifacts/nodes and a layer revision. `layer
  list|show|transform|reorder --to N|--up|--down|--front|--back|set --name --opacity --blend|duplicate|remove|clear` creates one
  revision and replacement composite root without mutating prior nodes. `--norm` is accepted. `layer show` summarizes its chain;
  `graph show --layer` is the full revision-bound paginated node/edge/provenance surface. Each mutation returns the new revision and
  render hash but never eagerly creates a preview.
- **10c2 vacancy/move:** `fill --move --to x,y|--by dx,dy` deliberately owns only the non-generative early move mode before Slice
  12's provider-backed `fill`; it creates a transformed subject branch plus a vacancy layer containing the full silhouette at lift
  and a magenta placeholder. Every enabled active vacancy emits `vacancy_unfilled`; disabled and historical vacancies do not.
  Export preserves the warning. `develop` wires 10b3's actual layer-id `delta_applied`/`stale` results into the new revision.
- **Identity:** `render_hash` is the full recipe hash of the active output/composite root. Ordered enabled content and mask hashes,
  opacity/blend, transforms, and the base branch are inputs to that root; disabled roots affect retention but not pixels.
  No parallel hand-built render-state hash exists. `wb layers <id>` shows the immutable stack beside those DAG roots.

## Verification

- **10a:** one real-PGlite test creates two layer identities and a compiled composite revision, then reorders, disables, renames,
  and changes opacity. It proves the old snapshot is unchanged, exactly one active revision/output advances per mutation, shared
  nodes remain, disabled content/mask roots stay retained, the v2 recipe exactly projects enabled snapshot rows, and a stale
  expected revision fails atomically without orphan identities. A schema-v8→v9 upgrade test exercises every foreign key/check and the base-root
  backfill. A pure asymmetric 2×3 coordinate test proves S→R→T, absolute idempotence, and relative composition.
- **10b1:** Rust unit tests cover bilinear and Lanczos3 on tiny asymmetric grids plus exact horizontal-flip and four-quarter-turn
  identities. `preview-resampler.test.ts` uses pixels for which Rust bilinear differs from Sharp's default, proving the production
  route rather than dimensions alone and proving Sharp performs no intermediate resize.
- **10b2:** a 2×3 base, two disjoint overlays, and asymmetric masks prove every unmasked sample is bit-identical at the composite
  fold boundary, the later layer cannot erase the earlier layer outside its own mask, and masked samples obey opacity. Mask
  publication/read/hash and missing/corrupt repair round-trip through the typed artifact
  owner. Tiny asymmetric masks pin dilate, erode, feather, transform, and lift. Composite-v2 tests bind each opacity to the correct
  ordered content/mask pair and omit disabled branches without releasing their retained roots. A move test applies the exact same
  matrix to content and active mask while retaining the original silhouette mask for vacancy.
- **10b3:** public evaluator/document tests prove `exposure=0.5` creates a delta node and a pinned untouched branch matches a base
  rerender within ±1 display LSB; `shadows=40` creates no compensation and reports stale; white balance +200 K compensates while
  +400 K is stale. The lineage points at the exact pre-change develop ancestor and the response contains stable layer ids.
- **10c1:** command tracers add one manual box, then exercise `layer list/show`, transform, reorder, opacity, rename, duplicate,
  remove, and clear. Each mutation returns a new revision/hash, preserves historical queries, and creates no preview until `show`.
  `graph show --layer` pages from that layer root with a cursor bound to both revision and layer.
- **10c2:** `develop` reports actual layer ids in `delta_applied`/`stale`; `show` materializes the ordered composite; export warns
  only for enabled active vacancy; `fill --move` preserves the original silhouette, creates the vacancy layer, and round-trips
  absolute/relative positioning. `wb layers` is compared and then receives an unprimed screenshot critique.

## Dependency graph

```text
09c v8 + 08c1a/b ──→ 10a
08c1a/b ───────────→ 10b1
08c2 + 08c3 ───────→ 10b2
08c2 + 08c3 ───────→ 10b3
10a + 10b1 + 10b2 ─→ 10c1
10c1 + 10b3 ───────→ 10c2 → visual gate
```

## Delegated: nothing beyond blob compression.
## Checkpoint: `wb layers` — layer/DAG relationship and placeholder legibility only. Run `compare-screenshots` on the generated
frame and `screenshot-critique` last. Non-blocking per the root rule.
## Must stay green: 01–09. Deps: 08c and 09c as graphed above. Firewall: no SAM inference; no gateway pixels; only manual
segmentation and non-generative move land here; provider-backed refresh/fill lands in 12. No blend mode beyond `normal` until its
math and a concrete caller are specified.
