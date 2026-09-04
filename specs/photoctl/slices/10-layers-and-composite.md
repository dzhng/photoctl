# 10 — DAG-backed layers, transforms, composite, vacancy, A′ delta/stale (no SAM, no gateway)

## API seam
- Migration (next number): `layers(id,photo_id,name,role subject|vacancy|reimagine|retouch,of_layer,created_at)` is stable
  user-facing identity. `document_revision_layers(revision_id,layer_id,z,output_node_id,opacity,blend,enabled)` is the immutable
  layer-stack snapshot for that revision. Pixel paths, transforms, masks, develop hashes, and fill replay parameters do not live
  in layer rows: artifacts and operation recipes belong to Slice 08's graph owners. The revision writer builds one ordered
  `composite` node from the layer roots; there is no second render-state representation.
- `packages/render/src/{layers,transforms}`: `Transform{dx,dy,scale,rotate,flip,anchor}`, absolute default, `--relative`, S→R→T
  about anchor (default mask centroid) as one matrix stored in a typed `transform` node; `--norm` accepted. Verbs
  `segment --box x,y,w,h | --brush '[[x,y],…]'` create permanent mask artifacts/nodes;
  `layer list|show|transform|reorder --to N|--up|--down|--front|--back|set --name --opacity --blend|duplicate|remove|clear`
  create a revision and replacement composite root without mutating prior nodes. `fill --move --to x,y|--by dx,dy` creates a
  transformed subject branch plus vacancy layer (full silhouette at lift; magenta placeholder).
- `crates/photoctl-image::{mask,composite,delta}`: dilate/erode/feather, `resample`, `overlay`, `lift`; **delta kernels** =
  inverse display transform → the 8b operator → display transform on pinned pixels. Render graph composite node. `develop` →
  compatible change creates a deterministic compensation node on the old generated/pinned branch (`delta_applied`); incompatible
  change keeps that branch attached to the exact develop ancestor it saw and marks the layer stale (Tier-2; `layers_stale` warning).
  A later generation refresh rebinds to the current develop node. Export warns `vacancy_unfilled`.
- `photoctl-image::resample` becomes the one owner of every non-delivery pixel resize. Preview source mapping and downsampling
  migrate from Sharp to its bilinear preview mode; layer/composite rendering uses Lanczos3, while exact flips and quarter-turns
  stay integer transforms. Sharp remains only the encoder/profile writer and the final delivery downscale named by the global
  rule.
- `render_hash` is the full recipe hash of the active output/composite root. Ordered layer output hashes, opacity/blend, masks,
  transforms, and base branch are already inputs to that root; no parallel hand-built render-state hash exists. Every layer
  mutation returns the new revision/root hash but leaves lazy preview generation to the next `show`.
- `layer show` summarizes its processing chain. `graph show --layer` is the full paginated node/edge/provenance surface.
  `wb layers <id>` shows the layer stack beside its DAG roots.

## Verification
`strict-composite.test.ts` asserts at the `mask_composite` node boundary that every output pixel outside its effective mask equals
that node's base-input pixel byte-for-byte; later global nodes may intentionally change both. `layer-transform.test.ts`
(absolute idempotence; `flip h`×2 and `rotate 90`×4 identity; 2×3 fixture exact); `vacancy.test.ts`; `tier-delta.test.ts`
(`exposure=0.5` → `delta_applied:[1,2]` and a pinned untouched layer equals the base re-render within ±1 LSB; `shadows=40` → stale;
`temp_offset_k=200` Tier-1 compensation node, `=400` Tier-2 stale lineage); `layer-revision.test.ts` proves add/transform/opacity/
reorder/remove preserve old revisions, update exactly one active root, and retain shared nodes; `layer-preview-hash.test.ts` proves
each changes the full root hash and that `show.preview` reflects the ordered composite; `preview-resampler.test.ts` proves preview pixels pass through
the Rust bilinear kernel and that Sharp performs no intermediate resize.

## Delegated: nothing beyond blob compression.
## Checkpoint: `wb layers` — layer/DAG relationship and placeholder legibility only. Run `screenshot-critique` last; no reference
image means `compare-screenshots` is not required. Non-blocking per the root rule.
## Must stay green: 01–09. Deps: 08. Firewall: no SAM; no gateway pixels; provider-backed `layer refresh` lands in 12.
