# 13 — reimagine, relight, auto_enhance, generate --ref; markup; retouch

## Contract unlocked
The remaining two-bucket verbs as prompt templates over the same pipeline/adapters; `auto_enhance` proposes
develop keys via structured output (C4), inspectable and undoable; vector markup flattens on export;
non-generative heal is a layer.

## API seam
- `reimagine`/`relight` run `fill/pipeline.ts` with `scope:"full-frame"` (no mask), land as a `role:"reimagine"`
  layer (never overwrite), result `drift:"full-frame"`; C3 template in `prompts/relight.ts`.
- `develop <id> --auto-enhance` → `gateway.structured()` with the C4 Zod schema over the 1024 preview +
  `develop/stats.ts` (p02/p50/p98/clipped/mean_sat/est_wb_k) → ordinary keys, clamped to ranges.
- `generate --prompt [--ref] [--size] [--seed] [--model]` → file + import tagged `generated`.
- Markup: migration `0006-markup.ts` `markup(photo_id, items jsonb)` + schema-v6 fixture;
  `packages/render/src/markup/{model.ts,flatten.ts}` (text/arrow/line/rect/ellipse/path/highlight in base coords);
  `crates/photoctl-image::draw` into the composite node; verbs `markup list|add|update|remove|clear`.
- Retouch: `retouch <id> --at x,y [--radius]` → `crates/photoctl-image::heal` (PatchMatch/Telea-style from
  surrounding pixels) as a `role:"retouch"` layer with a circular mask.
- `wb enhance <id>`, `wb markup <id>`.

## Verification
`reimagine-layer.test.ts` (`drift:"full-frame"`; `layer remove` restores the base); `auto-enhance.test.ts`
(fake structured output → keys in dict, out-of-range clamped, `--reset` undoes); `relight-template.test.ts`;
`markup-flatten.test.ts` (opaque red rect → red pixels there, nothing else changed vs no-markup export);
`retouch.test.ts` (outside radius bit-exact; inside differs; identical call idempotent — one layer).

## Delegated: markup raster lib inside the crate; heal algorithm; relight wording.
## Checkpoint: one artifact per verb — prompt/default-model taste, independently.
## Must stay green: 01–12. Deps: 12. Firewall: `unblur` cut; no local generative runners.
