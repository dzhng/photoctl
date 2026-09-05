# 13 — 13a reimagine/relight/generate · 13b auto_enhance · 13c markup · 13d retouch

- **13a** `reimagine`/`relight` run Slice 12's DAG planner with `scope:"full-frame"`: current source/develop → generation →
  optional density-matching generative upscale → exact resample to oriented base dimensions → `role:"reimagine"` layer root
  (never overwrite), `drift:"full-frame"`; C3 template. Removing the layer redirects the active revision to its prior root.
  `generate --prompt [--ref] [--size 1024x1024] [--seed] [--model]` → canonical generated artifact → imported photo tagged
  `generated`; it has no base-density target, so library `auto` does not invent one. Explicit `--upscale` uses the requested
  `--size` only when the provider returned fewer pixels. Tests: `reimagine-layer.test.ts` (full target dimensions; remove restores),
  `reimagine-upscale-fallback.test.ts` (generation survives upscaler failure), `generate.test.ts`, `relight-template.test.ts`. Deps 12.
- **13b** `develop <id> --auto-enhance`: `develop/stats.ts` on the 1024 sRGB preview (Rec.709 Y; p02/p50/p98/clipped/mean_sat/est_wb_k)
  → `StructuredModelAdapter` with the C4 schema → one `--set` batch, clamped; `develop_before_auto` stored for `--undo-auto`.
  Test: fake output lands, clamped, `--undo-auto` restores. Deps 09a, 08.
- **13c** Migration (next number) `markup(photo_id, items jsonb)`; `markup add <id> --json '{type,…}'` with per-primitive shapes:
  `text{at,text,size_px,color}`, `arrow|line{from,to,width,color}`, `rect|ellipse{bbox,width,color,fill?}`, `path{points,width,color}`,
  `highlight{bbox,color,opacity}`; bundled OFL font Inter; `photoctl-image::draw` into the composite node; `markup list|update|remove|clear`.
  Test: opaque red rect → red pixels there, nothing else changed. Deps 10.
- **13d** ✓ `retouch <id> --at x,y [--radius n] [--norm]` (default 2 % long edge) → the deterministic native
  `photoctl-image::heal` fast-marching fill with bounded harmonic refinement as a `role:"retouch"` layer with a permanent circular mask; idempotency key
  `(at, radius)`. The target radius is independent of the recipe's fixed three-pixel reconstruction neighborhood. The heal consumes
  the current pre-retouch document output, while the existing composite owner preserves every pixel outside the mask bit-for-bit.
  Tests prove native/graph determinism, oriented and normalized coordinates, lazy materialization, exact repeat reuse, independent
  export decoding, zero gateway work, and canonical outside-mask equality. Deps 10.

Every 13a/13c/13d pixel mutation creates typed nodes whose full input artifact hashes and parameters determine the active output
root/render hash, returns a new document revision without eager preview work, and extends `agent-preview-loop.test.ts` with at
least one representative mutation. The next `show` remains the only required preview-materialization step.

## 13a upscaler quality spike (non-blocking)

The fake adapter is the contract gate. When an upscaler is explicitly configured, `wb upscale-spike` uses identical inputs to make
separate contact sheets for: (1) guarded inherited vs minimal prompt; (2) balanced control strength; then validation-only sheets for
face/hair, fabric/foliage, repeating architecture, generated text/logo as an expected danger case, and a mask crossing detailed
texture. Never mix prompt and strength judgments in one sheet. Each sheet records source/provider/target dimensions, resolved
adapter/model/version and controls, latency/cost, prompts, mask, and crop. Run `compare-screenshots` for candidate-against-source
telemetry and `screenshot-critique` last. Open with `preview-shots`; wait about five minutes, then choose from evidence and record the
release default/control values if the user is silent. Missing credentials records `not_run:unconfigured` and does not block the slice.

## Checkpoints: one artifact per sub-slice, one variable each; all inherit the root visual gates and non-blocking review rule.

Firewall: `unblur` cut; no generic local generative runners. A future local UpscaleAdapter is allowed only as a separately configured
external-boundary implementation; this slice does not add one.
