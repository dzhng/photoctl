# 10 — layers, full transforms, composite, vacancy, A′ delta/stale (no SAM, no gateway)

## Contract unlocked
Real layer rows with masks and editor transforms, composited in display-referred 16-bit above develop;
`fill --move` and the magenta vacancy; export flattens; the strict-composite primitive exists and is
bit-exact; Tier-1 keys delta-apply, Tier-2 mark stale.

## API seam
- Migration `0005-layers.ts`: `layers(id, photo_id, z, name, role subject|vacancy|reimagine|retouch, state
  selected|moved|filled|stale, of_layer, mask_path, pixels_path, develop_hash, transform jsonb, opacity, blend,
  created_at)` + schema-v5 fixture. Blobs under `<lib>/layers/<photo>/<layer>.{mask.png,pixels.tif}` (paid
  state, not the deletable cache).
- `packages/render/src/layers/{model.ts,ops.ts}`, `packages/render/src/transforms.ts`: `Transform{dx,dy,scale,
  rotate,flip,anchor}` absolute by default, `--relative`; S→R→T about anchor (default mask centroid) computed
  once as a matrix; coords via `coordinates.ts` (oriented uncropped base; crop last). Verbs `segment --box|--brush`
  (geometry only), `layer list|show|transform|reorder|set|duplicate|remove|clear`, `fill --move --to|--by`
  (D11: emits vacancy = full original silhouette, D15; magenta placeholder, D16).
- `crates/photoctl-image::{mask,composite}`: dilate/erode/feather, `resample(layer, T, lanczos3|bilinear)` with
  exact flips/quarter-turns, `overlay(base16, layer16, mask, blend, opacity)`, `lift(base16, mask)`. Render graph
  gains the composite node. `develop` computes `delta_applied` (Tier-1 kernels applied to pinned pixels in
  display space) vs `stale` (Tier-2). Export writes with `warnings[]` (`layers_stale`, `vacancy_unfilled`).
- `wb layers <id>`: base, masks, transformed outlines, composite, and `|composite − base|` outside the mask
  union (must be black).

## Human can run
`segment <id> --box 2210,940,1380,3120 && fill <id> --layer 1 --move --by 1200,0 && layer list --human && export`.

## Verification
`strict-composite.test.ts` (case 7 half: every pixel outside the mask equals the pre-composite render byte-for-
byte on the 16-bit export; falsify by feathering); `layer-transform.test.ts` (absolute idempotence; `flip h`
twice = identity; `rotate 90`×4 = identity; 2×3 fixture exact pixels); `vacancy.test.ts` (layer 2 role vacancy,
`mask_px` equals layer 1's at lift; export exit 0 + warning); `tier-delta.test.ts` (`exposure=0.5` →
`delta_applied:[1,2]`; `shadows=40` → `stale:[1,2]`, driven by `tiers.ts`).

## Delegated: mask/pixel blob formats; blend subset (normal/multiply/screen v1).
## Checkpoint: `wb layers` — placeholder legibility, transform defaults; Tier placement of `white_balance`/`vibrance`.
## Must stay green: 01–09. Deps: 08. Firewall: no SAM; no gateway pixels; no `--refresh`.
