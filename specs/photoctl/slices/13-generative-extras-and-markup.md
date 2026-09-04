# 13 — 13a reimagine/relight/generate · 13b auto_enhance · 13c markup · 13d retouch

- **13a** `reimagine`/`relight` run the fill pipeline with `scope:"full-frame"`, land as a `role:"reimagine"` layer (never overwrite),
  `drift:"full-frame"`; C3 template. `generate --prompt [--ref] [--size 1024x1024] [--seed] [--model]` → `<lib>/generated/<uuid>.png`
  imported through the content probe registry and tagged `generated`. Tests: `reimagine-layer.test.ts` (`layer remove` restores), `generate.test.ts`,
  `relight-template.test.ts`. Deps 12.
- **13b** `develop <id> --auto-enhance`: `develop/stats.ts` on the 1024 sRGB preview (Rec.709 Y; p02/p50/p98/clipped/mean_sat/est_wb_k)
  → `StructuredModelAdapter` with the C4 schema → one `--set` batch, clamped; `develop_before_auto` stored for `--undo-auto`.
  Test: fake output lands, clamped, `--undo-auto` restores. Deps 09a, 08.
- **13c** Migration (next number) `markup(photo_id, items jsonb)`; `markup add <id> --json '{type,…}'` with per-primitive shapes:
  `text{at,text,size_px,color}`, `arrow|line{from,to,width,color}`, `rect|ellipse{bbox,width,color,fill?}`, `path{points,width,color}`,
  `highlight{bbox,color,opacity}`; bundled OFL font Inter; `photoctl-image::draw` into the composite node; `markup list|update|remove|clear`.
  Test: opaque red rect → red pixels there, nothing else changed. Deps 10.
- **13d** `retouch <id> --at x,y [--radius]` (default 2 % long edge) → `photoctl-image::heal` (Telea) as a `role:"retouch"` layer with a
  circular mask; idempotency key `(at, radius)`. Test: outside bit-exact; inside differs; repeat → one layer. Deps 10.

Every 13a/13c/13d pixel mutation contributes its provider output or local artifact content hash plus parameters to
`renderStateHash`, returns the new hash without eager preview work, and extends `agent-preview-loop.test.ts` with at least one
representative mutation. The next `show` remains the only required preview-materialization step.

## Checkpoints: one artifact per sub-slice, one variable each. Firewall: `unblur` cut; no local generative runners.
