# 12 — fill pipeline: `--fit strict|expand|free`, `--full-res --pad`, remove/prompt/outpaint/refresh; person-move flow

## Contract unlocked
One fill pipeline above the adapters (D26/D27): mask → crop → provider → composite; strict bit-exactness
asserted by the composite, never the model; playable end to end against the fake gateway.

## Pre-gate (with key, first thing): `smoke:mask-polarity` — two-tone 512² PNG + left-half mask through each
adapter; records which half changed into `adapters/*.maskPolarity` and a fake-gateway fixture. Until recorded,
a live native-mask fill refuses with `provider_unverified_mask` (69); fake-gateway runs are unaffected.

## API seam
`packages/render/src/fill/{pipeline.ts,fit.ts,crop.ts}` + `packages/providers/src/prompts/{remove,outpaint}.ts`
(C1/C2 verbatim, versioned ids). `fit.ts`: strict = hard, `expand=N` (default 24), free = feathered; `crop.ts`:
`--full-res` crop + `--pad N` ring in base coords, rounding reported in `sent_px`; pipeline: → `adapter.buildEdit`
→ `gateway.imageEdit` → `adapter.normalize` (under strict `resampled:true` → `provider_dims_mismatch` 65 with
hint; expand/free → Lanczos3) → whole-frame warning under strict = hard failure → `composite.overlay` → pin pixels
+ `develop_hash`. Flags `--remove|--prompt [--ref] [--fit] [--full-res] [--pad] [--strength] [--init] [--seed]
[--model] --refresh --outpaint [--aspect|--px]`. Defaults: remove→strict, replace→expand=24. `--strength` =
feather + guidance (documented not-A1111-denoise). Results: `composite:{unmasked_bit_exact, returned_px,
resampled}`, `provider:{gateway, model, seed, warnings, cost_usd, ms}`; stderr `provider` event.
`wb fill <id> --layer L`: sent crop/mask/prompt, returned image, composite, outside-mask heatmap.

## Human can run
Session-sample B3/B4 against the fake gateway; with a key, for real, then `screenshot-critique`.

## Verification
`fill-strict.test.ts` (case 7 in full over the fake gateway incl. `wrongdims` and `wholeframe` modes: outside
the mask bit-exact; strict + wrongdims → 65; expand + wrongdims → `resampled:true` and still bit-exact outside
the dilated mask; wholeframe + strict → hard failure); `fill-defaults.test.ts`; `fill-refresh.test.ts` (stale →
refresh → filled, hash updated); `person-move.test.ts` (case 2 end to end: segment --text (fake) → move → remove
strict → prompt expand=200 → Tier-1 nudge → Tier-2 stale → export writes with warnings).

## Delegated: feather kernel; `--init` per adapter (documented; no-op + warning where unsupported); `--ref` on
models without reference input (warn).
## Checkpoint: `wb fill` after the with-key smoke — seam at the mask boundary; `compare-screenshots` vs pre-fill.
## Must stay green: 01–11. Deps: 10, 11 (or `--box` suffices), 9a. Firewall: no local generative inference; no A1111/Comfy.
