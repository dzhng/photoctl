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
Successful fill/refresh commits the layer pixels and parameters, returns the new `render_hash`, and does not eagerly render the
review preview; the next `show` materializes it from the committed graph.

## Verification
`fill-strict.test.ts` (case 7 over the fake gateway incl. `wrongdims` → ok + `resampled:true` + bit-exact outside; `wholeframe` +
strict → 65); `fill-defaults.test.ts`; `fill-refresh.test.ts`; `person-move.test.ts` (case 2 end to end; export writes with warnings).

`agent-preview-loop.test.ts` is the mandatory Lightroom-style real-CLI journey over a deterministic high-resolution fixture and
fake gateway. The fixture manifest provides a small “person” detail bbox and independent pixel facts, but the test drives only
public CLI commands:

1. Import, apply a global exposure adjustment, then call `show --preview-size native`; inspect the full-frame H1 master with an
   independent image reader and verify its native dimensions plus the global luminance change.
2. Call `show --region <person-bbox>` with no size; assert the same H1 but a different view hash/path, native 1:1 dimensions, and
   independently verify fine detail in the crop. Assert the H1 master path/hash/mtime is unchanged and the edit graph was not
   invoked again: zoom is a projection of the cached full-resolution master, not another full render or an enlarged overview.
   Round-trip the person's base-space anchor through `base_to_view`/`view_to_base` and prove it lands on the inspected subject.
3. Add a fill layer inside that detail; assert the mutation returns H2 but creates no H2 view eagerly. Call the same region `show`,
   assert it creates exactly one H2 full-frame master before cropping, inspect the H2 native-detail preview, and verify the intended
   local change plus protected pixels.
4. Adjust that result with `layer set --opacity 0.5`; assert H3 differs and no H3 view exists yet. Call the same region `show`,
   assert it creates exactly one H3 full-frame master before cropping, inspect it independently, and verify the expected
   half-strength composite. Earlier view files remain unchanged.
5. Call default `show` for H3 and inspect the final zoomed-out composition, proving the overview includes both the global and local
   edits, is derived without another graph evaluation from H3's master, and uses a different view path from the native detail.
6. Export; assert the item result reports H3, then decode it independently and prove it represents the verified final overview and
   native-detail state rather than H1/H2.

The test fails if an agent could inspect stale pixels, if preview generation happens on mutation rather than lazily on `show`, if
the preview path is not readable/absolute, if a native zoom is an upscaled overview, if a crop reevaluates a graph whose sufficient
full-frame master is cached, if region and overview views contaminate each other's cache keys, or if export races ahead with a
different state.

## Delegated: `--init` per adapter (documented no-op + warning where unsupported); `--ref` on models without reference input (warn).
## Checkpoint: `wb fill` on the fake gateway first (seam at the mask boundary); repeat after the smoke with a key.
## Must stay green: 01–11. Deps: 10, 11 (or `--box`), 9a. Firewall: no local generative inference.
