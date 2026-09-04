# 10 — layers, transforms, composite, vacancy, A′ delta/stale (no SAM, no gateway)

## API seam
- Migration (next number): `layers(id, photo_id, z, name, role subject|vacancy|reimagine|retouch, state selected|moved|filled|stale,
  of_layer, mask_path, pixels_path, pixels_origin jsonb {x,y}, develop_hash, transform jsonb, opacity real 0..1, blend
  normal|multiply|screen, fill_params jsonb, created_at)`. Blobs: `<lib>/layers/<photo>/<layer>.mask.png` (8-bit), `.pixels.tif`
  (16-bit bbox crop + origin).
- `packages/render/src/{layers,transforms}`: `Transform{dx,dy,scale,rotate,flip,anchor}`, absolute default, `--relative`, S→R→T
  about anchor (mask centroid) as one matrix; `--norm` accepted. Verbs `segment --box x,y,w,h | --brush '[[x,y],…]'` (permanent
  geometric masks), `layer list|show|transform|reorder --to N|--up|--down|--front|--back|set --name --opacity --blend|duplicate|
  remove|clear`, `fill --move --to x,y|--by dx,dy` (vacancy layer = full silhouette at lift; magenta placeholder).
- `crates/photoctl-image::{mask,composite,delta}`: dilate/erode/feather, `resample`, `overlay`, `lift`; **delta kernels** =
  inverse display transform → the 8b operator → display transform on pinned pixels. Render graph composite node. `develop` →
  `delta_applied` (Tier-1) / `stale` (Tier-2; `layers_stale` warning); export warns `vacancy_unfilled`.
- `wb layers <id>`.

## Verification
`strict-composite.test.ts` (outside the mask byte-equal on the 16-bit export; falsify by feathering); `layer-transform.test.ts`
(absolute idempotence; `flip h`×2 and `rotate 90`×4 identity; 2×3 fixture exact); `vacancy.test.ts`; `tier-delta.test.ts`
(`exposure=0.5` → `delta_applied:[1,2]` and a pinned untouched layer equals the base re-render within ±1 LSB; `shadows=40` → stale;
`temp_offset_k=200` Tier-1, `=400` Tier-2).

## Delegated: nothing beyond blob compression.
## Checkpoint: `wb layers` — placeholder legibility only.
## Must stay green: 01–09. Deps: 08. Firewall: no SAM; no gateway pixels; no `--refresh`.
