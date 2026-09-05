# 12 — fill DAG; optional generative density matching; strict composite; person-move flow

Sub-slices: **12a** generation→mask-composite DAG with no upscaler · **12b** pure density planner and fake artifacts ·
**12c** configured upscaler execution/policy/fallback · **12d** branch refresh, transform-driven density maintenance,
and the agent preview journey. Each rung is useful and testable before the next external behavior lands.

## Pre-gate (with key, first): `smoke:mask-polarity` → each adapter's `maskPolarity` + a fake-gateway fixture. Until recorded,
live native-mask fills refuse `provider_unverified_mask` 69; fake-gateway runs are unaffected.

## API seam
`packages/render/src/fill/{pipeline.ts,fit.ts,crop.ts}` + `providers/prompts/{remove,outpaint}.ts` (C1/C2, versioned ids).
Slice 12 extends protocol `WarningCode` with `upscale_unconfigured`, `upscale_failed`, `upscale_resolution_limited`, and
`source_resolution_limited`; these are soft outcomes after usable generated pixels exist, so the command remains `ok:true`.
Crop = mask bbox + `--pad N` (default 64, base px), rounded up to ×16; without `--full-res` the sent long edge is capped at 1536.
`fit`: strict = hard; `expand=N` (default 24, base px); free = feather 24 px. **12a** plans and commits one branch:
current source/develop node → base-space crop + effective-mask nodes → `adapter.buildEdit`/gateway generation execution → normalized
generated artifact node → optional `upscale` node → exact deterministic `resample` node → `mask_composite` → replacement layer/output
root. Provider frame conversion remains inside its adapter. Same-ratio dimension mismatches resample; known letterbox/crop changes use
the adapter's reversible frame mapping; an unexplained aspect change invalidates only that external result and never stretches pixels.
- **12b density plan:** full-frame target is the oriented base dimensions; a masked target is the base-space provider crop including pad.
  `required = max(target.w/generated.w,target.h/generated.h)`. If the generated/cached upscaled artifact already covers both axes,
  skip the paid call and deterministically resize once to exact target dimensions. Otherwise select the smallest supported uniform
  generative scale that covers both axes. Never generically tile; adapter-native tiling is allowed. If adapter limits stop short,
  use its largest valid output, resize exactly, set `density_satisfied:false`, and warn `upscale_resolution_limited`.
- **12c policy:** `generation.upscale=auto|off` defaults `auto`; `--upscale|--no-upscale` override and `--upscale-model ID` implies enabled.
  The resolved model follows release default → configured library override → command override. `auto` with no explicitly configured
  adapter preserves generation and warns `upscale_unconfigured`. The default technique is generative and its adapter-neutral
  personality is balanced creative (medium detail synthesis, high resemblance).
- **12c prompt:** the versioned guarded prompt preserves composition, silhouette, identity, pose, lighting, placement, and boundary
  geometry while asking for plausible detail consistent with the original creative intent. Store both the original and exact derived
  prompt. The upscaler must not repeat the original replacement instruction.
- **12c failure:** generation is the successful commit boundary. Upscale transport failure, invalid aspect mapping, or bad output retains
  the generated branch as active and returns `upscale_failed`; no failed image node enters the graph. Retrying from upscale reuses the
  exact generation artifact. Offline/pinned-preview context remains allowed: report `source_context.{tier,pixel_scale,
  resolution_limited}` separately from `upscale.density_satisfied`, which claims output sampling only.
- **12d refresh:** `layer refresh <id> <layer> [--from <node>]` defaults to the branch's generation node. Refreshing generation rebinds
  it to the current upstream develop state and reconstructs descendants from their stored recipes; refreshing upscale reuses the
  existing generation. A new external execution gets a new execution/output identity. Deterministic descendants reuse by recipe.
  Increasing a generated layer's scale under `auto` re-evaluates required density: reuse the cached pre-exact-resize generative
  artifact when sufficient, otherwise execute a larger upscale from the original generation artifact. Never upscale the prior
  exact-size/composited result. Move, flip, and rotate alone do not call the model. If rescale upscaling fails, the transform still
  lands with the previous artifact plus `density_satisfied:false` and `upscale_failed`.
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

## 12a keyless checkpoint — 2026-09-05

`fill <id> --layer <layer> --remove|--prompt <text>` now resolves the existing image-model adapter and fake gateway, plans a clipped
base-space crop from the immutable layer mask, and commits the paid intrinsic-crop generation execution with canonical generate, resample/place,
mask-composite, replacement-layer, and output-root state in one revision. The mutation stays lazy: it publishes the provider result
needed by the graph but does not create a review preview. The strict compositor remains the protection owner, so every zero-mask
sample is copied from that node's base input exactly.

The adapter owns provider-frame validation while preserving the intrinsic raster it actually returned. The generation recipe records
those same sampling dimensions, and the canonical resample recipe alone owns exact sizing and placement into the base canvas. This
distinction is the input to 12b/12c density planning and upscaling.
An unexplained aspect change or the fake whole-frame signal returns `provider_whole_frame` (exit 65), and neither result enters the
catalog. The default live adapter remains fail-closed while native edit-mask polarity is unverified. Focused public-command tests use
an injected source plus the real adapter against the HTTP fake; they cover exact protected pixels, crop/pad metadata, wrong-size
normalization, whole-frame/aspect rejection without a revision, versioned prompt storage, and continued `fill --move` behavior.

This checkpoint does not claim live provider polarity, outpaint canvas behavior, `--ref`, alternate fit/init/full-resolution modes,
or visual continuity. Slice 12c owns configured upscaler selection, warnings, and partial-failure
semantics; 12d owns refresh, transform-driven density reuse, and the person-move/agent-preview journey. Their live, visual, and
performance gates remain open.

## 12b density-planning checkpoint — 2026-09-05

`planOutputDensity` now owns the pure choice between a sufficient generation artifact, a sufficient lineage-bound cached upscale,
or the smallest supported uniform upscale that fits within adapter limits. Its executable plan always ends with exactly one
deterministic resize to the oriented full-frame or padded base-space crop target. If no allowed scale reaches both target axes, the
largest valid output is retained, `density_satisfied` is false, and `upscale_resolution_limited` is returned; no generic tiling is
introduced. Source-context resolution remains a separate record and cannot make an undersampled output claim sufficient density.
Slice 12c still owns settings/flag/model precedence, configured adapter execution, guarded prompts, and partial-failure retention.

## 12c1 keyless policy checkpoint — 2026-09-05

Upscale policy is now a pure decision: release, library, and command model choices resolve in that order; command enablement beats
the library mode; and sending pixels requires both explicit configuration and an available adapter. A requested but unavailable
upscaler keeps the successful generation and reports a soft warning. Source-input resolution is reported independently, so a
limited pinned source never masquerades as a claim about generated output density.

The provider prompt owner now returns the original operation beside a versioned, exact guarded prompt instead of interpolating the
operation back into model instructions. The guard requests balanced detail while preserving photographic and mask-boundary
geometry. Slice 12c2 still owns adapter execution, output validation, retry reuse, and failure retention; no live or graph-mutation
gate is claimed here.

## 12c2 keyless execution checkpoint — 2026-09-05

Strict fill now resolves the pure upscale policy against the configured registry and runs a selected fake adapter from the original
intrinsic generation crop. Successful output is validated, any reversible provider frame is cropped to its declared sampling area,
and exactly one canonical Lanczos3 resample performs final sizing and placement. Sufficient generated or exact cached upscale pixels
skip the paid call. Source-resolution provenance remains separate from output-density truth.

Generation is the successful commit boundary. Transport, invalid geometry, undersized, or unreadable upscale output commits the
generation path with `upscale_failed`, no failed image node, and unsatisfied density. A retry recognizes only the active canonical
fill branch, reuses its pinned generation execution and original base, and retries the upscaler; an exact cached upscale also reuses
its pinned execution during ordinary evaluation. Live adapter credentials, quality/polarity evidence, refresh, general transform
ancestry, person movement, and visual continuity remain open for 12d and the named live gates.

## 12d preview-cache foundation — 2026-09-05

Once the current render state has a validated full-frame display master, default overview inspection projects that master instead
of evaluating the graph again. The cheap direct overview remains the cold-cache path and never creates a master by itself. Existing
master reads use the preview coordinator's path lease and cache accounting, so reuse cannot race pruning and a valid file can repair
a missing index row. The full agent-preview journey remains the owner of visual continuity evidence across fill revisions.

## 12d provider-runtime foundation — 2026-09-05

The provider package now owns the runtime upscaler roster used by fill and the workbench. Adapter availability remains only a
capability: the existing policy still requires persisted, purpose-scoped consent before sending pixels. The provisional deterministic
fake therefore supports built command-path verification without becoming an ambient opt-in or a live-model selection. Callers may
still inject a registry at the same boundary for failure modes and future adapter evidence.

## 12d1 branch-refresh checkpoint — 2026-09-05

Explicit refresh treats the active canonical fill ancestry as a stored program rather than as a flattened image. Generation refresh
reruns the original operation against the current develop root, gives the paid result a new immutable execution and node identity,
and rebuilds the deterministic placement/composite/transform descendants from their stored recipes. Develop compensation belongs to
the old base relationship, so generation refresh discards it. Upscale-only refresh instead reads the pinned original generation,
preserves compensation and transforms, and gives only the new upscale execution/output a fresh identity; it therefore remains usable
when the original photo source is offline.

One canonical branch descriptor now owns the topology, exact placement/composite recipes, persisted source context, and pinned paid
provenance used by retry and refresh. Public results extend the established fill result with the selected old node and refreshed node,
while graph, source, density, exact-composite, and ordered execution/reuse facts keep their existing meanings. Provider configuration
remains consent even when an adapter is injected: an explicit upscale refresh with no configured stored model changes no revision.
Generation refresh rejects a fill whose input was already transformed, before paid work or revision mutation, because rebinding that
mask/crop geometry directly to the document base would address the wrong pixels.

Transform-driven density reevaluation, historical upscale-cache selection, person movement, the agent preview journey, live adapters,
and visual gates remain 12d2 work. Its affine branch rebasing replaces the transformed-input refusal.
