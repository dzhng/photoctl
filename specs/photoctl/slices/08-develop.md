# 08 — develop → gold exam green

Sub-slices, one judged variable each: **8a** dict/presets/hash (no pixels) · **8b1** global per-pixel ops · **8b2** masked ops
(highlights/shadows/vibrance; skin crop) · **8b3** curves/levels · **8c1** local contrast (brilliance/definition/sharpen) ·
**8c2** NR (texture crop) · **8c3** geometry (exact tests) · **8c4** filters + B&W (data).

## API seam
- **8a** `packages/render/src/develop/{dict.ts,keys.ts,tiers.ts,hash.ts,presets.ts}`: one dict (D21); `--set` absolute merge,
  `--unset`, `--reset`, `--preset` (partial overlay before `--set`; resolved keys stored; `preset` name kept as provenance, excluded
  from the hash), `--copy-from`; `filter` = `filter.name`+`filter.strength`; `developHash="h_"+sha256(canonical).slice(0,12)`.
  **Operator table** in `keys.ts`, written before code — per key: range, operator, formula (OpenColorIO GradingPrimary/
  GradingTone math ported, BSD-3, not linked): `exposure` ×2^v · `brightness` GradingPrimary offset · `contrast` pivot 0.18 ·
  `black_point` lift · `highlights/shadows` GradingTone highlights/shadows with luminance masks · `saturation` GradingPrimary
  saturation · `vibrance` saturation weighted by (1−sat) and skin-hue protection · `white_balance.temp_offset_k/tint` Bradford ·
  `curves/levels` GradingRGBCurve · `definition` unsharp radius 3 % long edge · `brilliance` 31×31 local light map ·
  `sharpen` unsharp radius 1 px · `vignette` radial gain · `noise_reduction.{luminance,color}` NLM · `bw.*` · `cast` ·
  `selective_color`. **Tier table**: Tier-1 = `exposure brightness contrast saturation vibrance black_point` and `white_balance`
  iff |Δtemp| ≤ 300 K; Tier-2 = all else. Presets = session D1–D3 verbatim (package data; `<lib>/presets/develop/` overrides).
  Migration (next number) adds `photos.develop jsonb default '{}'`, `develop_hash`. Result `{develop_hash, layers:{delta_applied:[],stale:[]}}`.
- **8b/8c** `crates/photoctl-image::develop` on f32 linear Rec.2020 (D22) → display 16-bit; render cache `dev/<id>/<hash>.<tier>.tif16`;
  `renderPhoto({source:"develop"})`; export uses develop when online. `render <id> --linear --to out.tif` probe. Geometry keys
  `crop:{x,y,w,h}`, `straighten_deg`, `rotate ∈ {0,90,180,270}` applied last; `show.crop` mirrors them. `auto_straighten`: Hough
  (portable, the only implementation in tests); `crop --auto` = straighten + minimal trim. NR only in Rust; CIRAW invoked with NR off.
- `scripts/gold-exam.sh` gains the develop step. `wb presets`, `wb ab`.

## Verification
`gold-exam.test.ts` (runs the script on a 10-file set; 3 people-preset JPEGs; people's `highlights=-20` lowers p98 vs neutral);
`render-determinism.test.ts` (same dict twice → byte-identical); `develop-dict.test.ts`; `exposure=1` doubles linear mean within 5 %
via `render --linear`; crop-last test; Rust unit tests per operator on ramps. Visual: 8b1 `compare-screenshots` vs CIRAW neutral
(global tone/color; crops skin/sky/shadow); 8b2 skin crop; 8c1/8c2 100 % crops vs neutral; `screenshot-critique` last.

## Delegated: operator constants (data); NLM parameters.
## Checkpoints: one per sub-slice as listed. Silent ⇒ ship sample values.
## Must stay green: 01–07. Deps: 7b (functional), 7a (macos). Firewall: no layers, no providers, no learned NR, no CoreML, no VLM.
