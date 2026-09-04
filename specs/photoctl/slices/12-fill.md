# 12 — fill DAG; optional generative density matching; strict composite; person-move flow

## Pre-gate (with key, first): `smoke:mask-polarity` → each adapter's `maskPolarity` + a fake-gateway fixture. Until recorded,
live native-mask fills refuse `provider_unverified_mask` 69; fake-gateway runs are unaffected.

## API seam
`packages/render/src/fill/{pipeline.ts,fit.ts,crop.ts}` + `providers/prompts/{remove,outpaint}.ts` (C1/C2, versioned ids).
Crop = mask bbox + `--pad N` (default 64, base px), rounded up to ×16; without `--full-res` the sent long edge is capped at 1536.
`fit`: strict = hard; `expand=N` (default 24, base px); free = feather 24 px. The command plans and commits one branch:
current source/develop node → base-space crop + effective-mask nodes → `adapter.buildEdit`/gateway generation execution → normalized
generated artifact node → optional `upscale` node → exact deterministic `resample` node → `mask_composite` → replacement layer/output
root. Provider frame conversion remains inside its adapter. Same-ratio dimension mismatches resample; known letterbox/crop changes use
the adapter's reversible frame mapping; an unexplained aspect change invalidates only that external result and never stretches pixels.
- **Density plan:** full-frame target is the oriented base dimensions; a masked target is the base-space provider crop including pad.
  `required = max(target.w/generated.w,target.h/generated.h)`. If the generated/cached upscaled artifact already covers both axes,
  skip the paid call and deterministically resize once to exact target dimensions. Otherwise select the smallest supported uniform
  generative scale that covers both axes. Never generically tile; adapter-native tiling is allowed. If adapter limits stop short,
  use its largest valid output, resize exactly, set `density_satisfied:false`, and warn `upscale_resolution_limited`.
- **Policy:** `generation.upscale=auto|off` defaults `auto`; `--upscale|--no-upscale` override and `--upscale-model ID` implies enabled.
  The resolved model follows release default → configured library override → command override. `auto` with no explicitly configured
  adapter preserves generation and warns `upscale_unconfigured`. The default technique is generative and its adapter-neutral
  personality is balanced creative (medium detail synthesis, high resemblance).
- **Prompt:** the versioned guarded prompt preserves composition, silhouette, identity, pose, lighting, placement, and boundary
  geometry while asking for plausible detail consistent with the original creative intent. Store both the original and exact derived
  prompt. The upscaler must not repeat the original replacement instruction.
- **Failure:** generation is the successful commit boundary. Upscale transport failure, invalid aspect mapping, or bad output retains
  the generated branch as active and returns `upscale_failed`; no failed image node enters the graph. Retrying from upscale reuses the
  exact generation artifact. Offline/pinned-preview context remains allowed: report `source_context.{tier,pixel_scale,
  resolution_limited}` separately from `upscale.density_satisfied`, which claims output sampling only.
- **Refresh:** `layer refresh <id> <layer> [--from <node>]` defaults to the branch's generation node. Refreshing generation rebinds
  it to the current upstream develop state and reconstructs descendants from their stored recipes; refreshing upscale reuses the
  existing generation. A new external execution gets a new execution/output identity. Deterministic descendants reuse by recipe.
  `--strength f` remains `feather_px = round(f×64)` (documented: not denoise).
Flags: `--remove|--prompt [--ref] [--fit] [--full-res] [--pad] [--strength] [--init original|fill|noise|empty] [--seed] [--model]
| --move --to|--by | --outpaint [--aspect|--px] | --upscale|--no-upscale|--upscale-model`. Defaults: remove→strict,
prompt→expand=24. Results include `graph:{revision,layer,output_node,render_hash}`, `source_context`, `upscale:{enabled,executed,
adapter,model,input,target,generated,final,density_satisfied,node?,warnings}`, `composite:{node,unmasked_bit_exact}`, and ordered
`executions[]` with cost/time. `wb fill <id> --layer L`.
Successful fill/refresh publishes canonical artifacts then atomically commits nodes/revision/root, returns the new `render_hash`, and does not eagerly render the
review preview; the next `show` materializes it from the committed graph.

## Verification
`fill-strict.test.ts` asserts exactness at the mask-composite node against that node's base input (including wrong same-ratio dims;
`wholeframe` + strict → 65); `fill-upscale-policy.test.ts` covers setting/flag/model precedence, configured consent, no-call when
sufficient, fixed-scale cover+exact resize, adapter limit, cached-upscale reuse, and separate source/output density;
`fill-upscale-failure.test.ts` covers transport/bad ratio/too-small results and proves generation remains active with no failed node;
`fill-refresh.test.ts` proves generation refresh adopts current develop while upscale refresh does not rerun generation;
`person-move.test.ts` (case 2 end to end; export writes with warnings).

`agent-preview-loop.test.ts` is the mandatory Lightroom-style real-CLI journey over a deterministic high-resolution fixture and
fake gateway. The fixture manifest provides a small “person” detail bbox and independent pixel facts, but the test drives only
public CLI commands:

1. Import, apply a global exposure adjustment, then call `show --preview-size native`; inspect the full-frame H1 master with an
   independent image reader and verify its native dimensions plus the global luminance change.
2. Call `show --region <person-bbox>` with no size; assert the same H1 but a different view hash/path, native 1:1 dimensions, and
   independently verify fine detail in the crop. Assert the H1 master path/hash/mtime is unchanged and the edit graph was not
   invoked again: zoom is a projection of the cached full-resolution master, not another full render or an enlarged overview.
   Round-trip the person's base-space anchor through `base_to_view`/`view_to_base` and prove it lands on the inspected subject.
3. Add a fill layer inside that detail with fake generation at lower density and auto-upscale; assert the mutation returns H2,
   distinct generate/upscale/resample/mask-composite nodes, and no H2 view eagerly. Call the same region `show`,
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

## Delegated: `--init` per generation adapter (documented no-op + warning where unsupported); `--ref` on models without reference
input (warn); exact wording inside the settled guarded-prompt constraints.
## Checkpoint: `wb fill` on the fake gateway first; the sole visual variable is sharpness/texture continuity across the mask edge,
using the same native-detail crop and mask before/after. Run `compare-screenshots`, then an unprimed `screenshot-critique` last.
Open with `preview-shots`; after about five minutes of silence decide from evidence, record the verdict, close shots, and continue.
Repeat after the live smoke only when configured credentials exist; its absence never blocks.
## Must stay green: 01–11. Deps: 10, 11 (or `--box`), 9a. Firewall: no local generative inference.
