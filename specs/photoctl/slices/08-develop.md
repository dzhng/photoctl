# 08 — develop: 8a dict + presets, 8b render color core, 8c local ops + geometry + cheap NR → gold exam green

## Contract unlocked
`develop --preset people --set exposure=0.3` changes exported pixels; three presets ship; keyless gold
exam passes end to end on real RAW pixels.

## API seam
- **8a** `packages/render/src/develop/{dict.ts,keys.ts,tiers.ts,hash.ts,presets.ts}`: one dict per photo
  (D21); Zod schema of every spec key; `--set` absolute merge, `--unset`, `--reset`, `--preset` (partial
  overlay, applied before `--set`), `--copy-from`; `filter` = `filter.name` + `filter.strength`;
  `developHash = "h_"+sha256(canonical).slice(0,12)`. **Tier table** `tiers.ts` (A′ data): Tier-1 =
  `exposure brightness contrast saturation vibrance black_point white_balance.{temp_offset_k≤300,tint}`;
  Tier-2 = everything else. Presets `neutral/people/high-contrast.json` = session-sample D1–D3 verbatim.
  Verb result `{develop_hash, layers:{delta_applied:[],stale:[]}}` (filled in 10; shape fixed now).
- **8b** `crates/photoctl-image::develop` on f32 linear Rec.2020 (D22): levels, WB (Bradford), matrix,
  exposure, contrast (pivot 0.18), black_point, highlights/shadows (luminance mask), brightness,
  saturation, vibrance (SmartColor-style skin-protected; **not** CIVibrance), curves, levels; OpenColorIO
  GradingPrimary/GradingTone math ported (BSD-3), not linked; display transform → 16-bit. Render cache
  `dev/<id>/<hash>.<tier>.tif16`. `renderPhoto({source:"develop"})`; export picks develop when online.
- **8c** brilliance (31×31 local light map architecture), definition, sharpen, vignette, cheap NR
  (`noise_reduction.{luminance,color}` = NLM in Rust; CIRAW path may use its own — D39), B&W, filters as
  dict overlays; crop/rotate/straighten/aspect applied **last**; `auto_straighten` via `photoctl-mac
  horizon` (Mac) / Hough (portable); `crop --auto` = straighten + minimal trim; `auto_enhance` is NOT here (13).
- `wb presets <lib> --ids …` (grid preset × image, hover A/B vs neutral, histograms); `wb ab <id> --set k=v`.

## Human can run
The gold exam end to end; `photoctl presets show people`; `wb presets`.

## Verification
`gold-exam.test.ts` (case 1, keyless, 10-file set → 3 people-preset JPEGs decode, dims right, differ from
neutral); `render-determinism.test.ts` (same dict twice → byte-identical 16-bit output — prerequisite for
strict composite); `develop-dict.test.ts` (order preset→set; unset/reset/copy-from; unknown key → 2; hash
changes iff dict changes); `exposure=1` doubles linear mean within 5 %; crop-last test; Rust unit tests
per operator on synthetic ramps. Visual: `wb presets` through `screenshot-critique`; `compare-screenshots`
vs the CIRAW neutral render for 8b only (variable: global tone/color; crops: skin, sky, shadow corner);
8c compares vs neutral (variable: local contrast/edges).

## Delegated: curve constants and NR parameters (data; David's taste corrects them); whether Tier-1 delta
kernels are implemented here or in 10 (must exist by 10).
## Checkpoint: `wb presets` — people/high-contrast taste. Silent ⇒ ship sample values.
## Must stay green: 01–07. Deps: 07 (at least CIRAW). Firewall: no layers, no providers, no learned NR, no CoreML.
