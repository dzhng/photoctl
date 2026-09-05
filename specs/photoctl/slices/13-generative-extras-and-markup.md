# 13 — 13a reimagine/relight/generate · 13b auto_enhance · 13c markup · 13d retouch

- **13a** ✓ `reimagine <id> --prompt ... [--strength f]` runs Slice 12's shared DAG planner with `scope:"full-frame"`: current source/develop → generation →
  optional density-matching generative upscale → exact resample to oriented base dimensions → `role:"reimagine"` layer root
  (never overwrite), `drift:"full-frame"`; C3 template. Strength defaults to `1`, is bounded to `0..1`, becomes both versioned
  provider guidance and a constant full-frame composite coverage, and therefore has a defined pixel effect. Removing the layer
  redirects the active revision to its prior root and pixels exactly. The keyless fixture proves lazy materialization, one generation
  plus optional configured upscale, target dimensions, provider provenance, no native mask, and no provider rerun during show/remove.
  A developed exposure remains valid input. Crop/rotate output is refused before provider work because v1 cannot yet composite a
  base-sized reimagine layer into a changed current frame without mixing coordinate spaces. The same dimension-retaining-source
  requirement excludes a smaller pinned fallback: composite-v2 requires every layer and mask to match the exact document base
  raster, so silently accepting it would commit a layer that fails when shown.
  `relight` remains open.
  `generate --prompt [--ref] [--size 1024x1024] [--seed] [--model]` → canonical generated artifact → imported photo tagged
  `generated`; it has no base-density target, so library `auto` does not invent one. Explicit `--upscale` uses the requested
  `--size` only when the provider returned fewer pixels. Tests: `reimagine-layer.test.ts` (full target dimensions; remove restores),
  `reimagine-upscale-fallback.test.ts` (generation survives upscaler failure), `reimagine-journey.test.ts` (built CLI),
  `generate.test.ts`, `relight-template.test.ts`. Deps 12.
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

## 13b public auto-enhance checkpoint — 2026-09-05

The public develop command sends the current graph render as a 1024-pixel-long-edge sRGB JPEG to the fixed structured-model purpose.
Its stats contract uses transfer-decoded linear light for Rec.709 luminance and gray-world McCamy temperature, type-7 interpolated
percentiles, encoded-sRGB mean saturation, and the literal C4 clipping fields `clipped_lo_pct` and `clipped_hi_pct`. The versioned C4
prompt owns its narrower proposal ranges; accepted values are clamped there and then enter the ordinary develop mutation owner as
one batch.

The resulting revision atomically stores a versioned auto-enhance discriminator, `develop_before_auto`, and the structured execution
identity in generic revision metadata.
Only an active auto-enhance revision can be undone, so a later manual edit cannot silently discard newer intent. Provider or schema
failure leaves the active revision unchanged. Preview materialization remains current and lazy: auto-enhance renders because pixels
are its required model input, while the newly committed develop result is not rendered until the next consuming command.

The deterministic visual checkpoint and its no-op/geometry telemetry live in [`../assets/auto-enhance/`](../assets/auto-enhance/).
