# 12 — fill pipeline; strict composite; person-move flow

## Pre-gate (with key, first): `smoke:mask-polarity` → each adapter's `maskPolarity` + a fake-gateway fixture. Until recorded,
live native-mask fills refuse `provider_unverified_mask` 69; fake-gateway runs are unaffected.

## API seam
`packages/render/src/fill/{pipeline.ts,fit.ts,crop.ts}` + `providers/prompts/{remove,outpaint}.ts` (C1/C2, versioned ids).
Crop = mask bbox + `--pad N` (default 64, base px), rounded up to ×16; without `--full-res` the sent long edge is capped at 1536.
`fit`: strict = hard; `expand=N` (default 24, base px); free = feather 24 px. Pipeline: → `adapter.buildEdit` → gateway →
`adapter.normalize` (**strict never fails on geometry, D27**: dims mismatch → resample, `resampled:true`) → provider "whole image"
warning under strict → `provider_whole_frame` 65 → `composite.overlay` → pin pixels + `develop_hash` + `fill_params`
(`{op,prompt,seed,fit,pad,model}`; `--refresh` replays them). `--strength f` → `feather_px = round(f×64)` (documented: not denoise).
Flags: `--remove|--prompt [--ref] [--fit] [--full-res] [--pad] [--strength] [--init original|fill|noise|empty] [--seed] [--model]
| --move --to|--by | --outpaint [--aspect|--px] | --refresh`. Defaults: remove→strict, prompt→expand=24. Results `composite:{
unmasked_bit_exact, returned_px, resampled}`, `provider:{gateway, model, seed, warnings, cost_usd, ms}`. `wb fill <id> --layer L`.

## Verification
`fill-strict.test.ts` (case 7 over the fake gateway incl. `wrongdims` → ok + `resampled:true` + bit-exact outside; `wholeframe` +
strict → 65); `fill-defaults.test.ts`; `fill-refresh.test.ts`; `person-move.test.ts` (case 2 end to end; export writes with warnings).

## Delegated: `--init` per adapter (documented no-op + warning where unsupported); `--ref` on models without reference input (warn).
## Checkpoint: `wb fill` on the fake gateway first (seam at the mask boundary); repeat after the smoke with a key.
## Must stay green: 01–11. Deps: 10, 11 (or `--box`), 9a. Firewall: no local generative inference.
