# 11 — segment: 11a SAM 2.1 runtime spike, 11b verbs (`--at`, `--text` via Gemini structured output)

## Contract unlocked
Promptable segmentation entirely local (D7); `--text` grounds through Gemini `box_2d` → SAM (D7b); one
layer per instance (D8); `--dry-run` creates nothing.

## API seam
- **11a** `crates/photoctl-image::sam2` via `ort` 2.0 CPU EP (D40): encoder once per image (cached per
  `(id, tier)` in the daemon), decoder per prompt (`point_coords`, `point_labels`, `mask_input`); weights
  `sam2.1_hiera_small` (Apache-2.0) fetched on demand by `photoctl doctor --fetch-models` with license shown, cached
  under the cache root `models/`. `cargo run --example sam2 -- fixtures/…jpg 900,600` → mask PNG; verdict
  `assets/gates/G6-sam.txt` (latency ≤ 4 s encode on M5 CPU band, RSS).
- **11b** `segment <id> --at x,y… [--box] [--brush] [--dry-run]` → layers; `--text "…"` → `gateway.structured()`
  with Zod `{instances:[{box_2d:[ymin,xmin,ymax,xmax], label}]}` (0–1000, top-left; converted in
  `providers/models/gemini-vlm.ts`, never leaked) → SAM box prompt per instance; fake-gateway canned boxes keep it
  keyless. `wb masks <id>`.

## Human can run
`photoctl segment <id> --at 2900,2500 --dry-run` (session-sample B1), then commit; `wb masks`.

## Verification
`segment-at.test.ts` (mask bbox contains the click; area within a band over 3 click points — a distribution,
not a pin); `segment-text-fake.test.ts` (canned boxes → N layers with bbox in base coords; `--dry-run` → zero rows);
`cargo test -p photoctl-image sam2::` (tensor shapes).

## Delegated: hiera size within the gate; embedding-cache eviction.
## Checkpoint: `wb masks` — mask edge quality on hair/foliage crops.
## Must stay green: 01–10. Deps: 09a, 10. Firewall: no SAM 3; no macOS 27 API; CPU EP only.
