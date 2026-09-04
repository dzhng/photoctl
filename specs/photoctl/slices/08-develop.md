# 08 — immutable render DAG → develop → gold exam green

Sub-slices, one seam or judged variable each: **8a1** immutable DAG/schema/full hashes · **8a2** canonical artifacts,
revisions, evaluator, graph inspection · **8b** develop dict/presets as a node (no pixels) · **8c1** global per-pixel ops ·
**8c2** masked ops (highlights/shadows/vibrance; skin crop) · **8c3** curves/levels · **8d1** local contrast
(brilliance/definition/sharpen) · **8d2** NR (texture crop) · **8d3** geometry (exact tests) · **8d4** filters + B&W (data).

## API seam
- **8a1** replaces the current linear `renderPhoto` state model with `packages/render/src/graph/{types,recipes,store,evaluate}.ts`.
  Typed immutable nodes cover `source|develop|generate|upscale|resample|transform|mask_composite|composite|crop|markup|output`;
  a registry owns each kind's parameter schema, input arity, recipe canonicalization, and evaluator. PGlite stores normalized
  `image_nodes`, ordered `image_node_inputs`, `node_executions`, `image_artifacts`, `document_revisions`, and revision roots;
  Slice 10 adds user-visible `layers.output_node_id` roots rather than a second graph. Node parameters are validated JSON, but
  topology is relational: one transactional writer verifies input existence, same-photo ownership where required, and acyclicity.
  No mutable-node update path exists.
- **8a1 identity:** recipe, artifact, render, and view hashes are full SHA-256 (`<prefix>_<64 hex>`); `--human` alone abbreviates.
  Deterministic node identity derives from `{kind,recipe_version,canonical_parameters,input_artifact_hashes}`. External generative
  executions add a distinct `execution_id`, and their node/output identity includes the bytes actually returned. Slice 08 hard-cuts
  the existing 12-hex preview protocol and paths; no compatibility alias or dual hash survives.
- **8a2 artifacts:** `packages/render/src/artifacts` is the sole canonical pixel-artifact owner under
  `<lib>/artifacts/sha256/<prefix>/<artifact_hash>.<ext>`. Normalize and hash bytes, publish/fsync without overwriting differing
  content, then commit node + edges + provenance + revision/root in one database transaction. A failed publish creates no node;
  a crash before the DB commit leaves an unreferenced file for the orphan sweep. Provenance lives in PGlite, not a second canonical
  sidecar. Preview/cache artifacts remain disposable and use the existing coordinator/index lifecycle.
- **8a2 revisions/inspection:** active output, retained undo revisions, and pinned snapshots are GC roots. Reachability and
  `artifact_available` land now, but automatic canonical-artifact deletion remains disabled until the OPEN retention measurement
  chooses count/age/storage limits. `graph show <id> [--layer L] [--history] [--limit N] [--cursor C]` returns bounded pages;
  `graph node <id> <node>` returns one bounded record. Default inspection walks only the active reachable graph, so the daemon's
  16 MiB frame cap is unchanged. `backup` stays SQL-only; restore replaces DB state while preserving `artifacts/`, source files,
  previews, and backups. Missing referenced files remain explicit `artifact_available:false` rather than being fabricated.
- **8b** `packages/render/src/develop/{dict.ts,keys.ts,tiers.ts,hash.ts,presets.ts}`: one dict (D21); `--set` absolute merge,
  `--unset`, `--reset`, `--preset` (partial overlay before `--set`; resolved keys stored; `preset` name kept as provenance, excluded
  from the hash), `--copy-from`; `filter` = `filter.name`+`filter.strength`; `developHash="h_"+sha256(canonical)`.
  **Operator table** in `keys.ts`, written before code — per key: range, operator, formula (OpenColorIO GradingPrimary/
  GradingTone math ported, BSD-3, not linked): `exposure` ×2^v · `brightness` GradingPrimary offset · `contrast` pivot 0.18 ·
  `black_point` lift · `highlights/shadows` GradingTone highlights/shadows with luminance masks · `saturation` GradingPrimary
  saturation · `vibrance` saturation weighted by (1−sat) and skin-hue protection · `white_balance.temp_offset_k/tint` Bradford ·
  `curves/levels` GradingRGBCurve · `definition` unsharp radius 3 % long edge · `brilliance` 31×31 local light map ·
  `sharpen` unsharp radius 1 px · `vignette` radial gain · `noise_reduction.{luminance,color}` NLM · `bw.*` · `cast` ·
  `selective_color`. **Tier table**: Tier-1 = `exposure brightness contrast saturation vibrance black_point` and `white_balance`
  iff |Δtemp| ≤ 300 K; Tier-2 = all else. Presets = session D1–D3 verbatim (package data; `<lib>/presets/develop/` overrides).
  Develop state is the typed `develop` node's parameters, not duplicate `photos.develop` columns. The command inserts a replacement
  node/revision and returns `{develop_hash,render_hash,layers:{delta_applied:[],stale:[]}}`.
- **8c/8d** `crates/photoctl-image::develop` on f32 linear Rec.2020 (D22) → display 16-bit; deterministic node artifacts replace a
  separate `dev/<id>/<hash>.<tier>.tif16` identity scheme;
  `renderPhoto({source:"develop"})`; export uses the develop render for every source format. Full-resolution decoding is preferred;
  an embedded or pinned-preview fallback runs the same graph at its available dimensions and returns a source warning.
  `render <id> --linear --to out.tif` probe. Geometry keys
  `crop:{x,y,w,h}`, `straighten_deg`, `rotate ∈ {0,90,180,270}` applied last; `show.crop` mirrors them. `auto_straighten`: Hough
  (portable, the only implementation in tests); `crop --auto` = straighten + minimal trim. NR only in Rust; CIRAW invoked with NR off.
- `packages/render/src/preview.ts` already exposes the slice-03 coordinated, indexed preview materializer. Slice 08 makes its
  `render_hash` the current output-root recipe hash and supplies the evaluated graph as the master
  producer. The canonical native full-frame display master remains `view/<id>/<render_hash>/master.jpg`; other outputs remain
  `view/<id>/<render_hash>/<view_hash>.jpg`. Develop/crop mutations only commit state and return the new `render_hash`, without
  rendering pixels.
- Source selection is deterministic. An exact view wins. Otherwise a cached full-frame view is sufficient only when, after mapping
  the requested base-image region into that view, both available crop dimensions are at least the requested output dimensions.
  Choose the smallest sufficient full-frame entry and crop/downsample it. If none is sufficient, render the current graph once as
  `master.jpg` at the best available full-frame resolution, then derive the requested view from it. A native full-frame request
  returns `master.jpg` itself. Once a master exists, no region or smaller-view request for that `render_hash` may reevaluate the
  graph. The cheap default 1616 overview does not eagerly create a master. `preview_info.cache_source` is one of
  `exact_view | sufficient_full_frame | render_master`, and reports the selected source dimensions as well as output dimensions.
- Slice 03's `PreviewCoordinator`, artifact validation, cache-index touch, materialization lease, failure cleanup, and 30-minute
  prune grace remain unchanged as develop adds new graph producers. Slice 08 must extend the existing path, not introduce a
  second coordinator or cache lifecycle.
- `show` adds `--preview-size <long-edge-px|native>`, `--region x,y,w,h`, and `--norm`. Region coordinates use the global oriented,
  uncropped base space. Default is full-frame/1616; region-without-size is native 1:1. The preview planner selects or materializes
  a sufficient full-frame source for the current graph, extracts the requested region, then downsizes only if requested. Numeric
  sizes never upscale. If the original/full-resolution cache is unavailable, it returns the best honest view with `source_offline` plus new
  warning `preview_resolution_limited`, and `preview_info` exposes the actual source tier and pixel scale.
  Slice 08 extends `WarningCode` with `preview_resolution_limited`; it is soft state and keeps exit 0.
- Preview projection uses the coordinate owner from slice 01. `preview_info.base_to_view` and `view_to_base` are inverse affine
  transforms encoded as `{a,b,c,d,e,f}`, where `x'=a*x+c*y+e` and `y'=b*x+d*y+f`; `visible_base_polygon` lists the rendered
  boundary in base-image edge coordinates after crop/rotate/straighten. A request with no visible intersection returns `usage`;
  a partial intersection is clipped, with the clipped `actual.region` and polygon returned. It must never clamp an entirely
  outside request to a plausible one-pixel edge view.
- Preview encoding applies orientation, flattens to opaque display pixels, converts to sRGB, and embeds the bundled
  `sRGB2014.icc` in pinned previews, `master.jpg`, and derived views. `preview_info` fixes
  `color_space:"srgb",icc:"sRGB2014"`; viewers do not infer color from untagged JPEG bytes.
- `scripts/gold-exam.sh` gains the develop step. `wb presets`, `wb ab`.

## Verification
`graph-schema.test.ts` proves ordered shared inputs, immutable replacement, cycle refusal, revision undo, and a root redirect in one
transaction; `graph-dedup.test.ts` distinguishes deterministic recipe reuse from two equal generative requests with distinct
execution/output identities; `artifact-publication.test.ts` injects failure before publish and before DB commit, proving no active
missing reference and a collectible orphan; `graph-pagination.test.ts` walks a history larger than one page without duplication and
keeps each daemon frame bounded; `restore-artifacts.test.ts` restores corrupt PGlite metadata while canonical artifact bytes remain
unchanged; protocol tests require full hashes and human output abbreviates them.

`gold-exam.test.ts` (runs the script on a 10-file set; 3 people-preset JPEGs; people's `highlights=-20` lowers p98 vs neutral);
`develop-format-matrix.test.ts` applies the same develop dict to representative whole-file, embedded-container, and
unknown-extension inputs and proves identical envelope/result structure plus a render at the best available tier;
`lazy-preview.test.ts` proves a develop mutation changes `render_hash` without creating its preview, the next `show` creates it,
and repeated `show` reuses the same valid path while a missing/corrupt artifact is atomically repaired;
`preview-viewport.test.ts` uses a high-resolution fixture with independently known fine detail: default `show` is ≤1616px and does
not create `master.jpg`; `show --preview-size native` creates the full-frame master once; a subsequent native person-region has the
same `render_hash`, crops that unchanged master, and does not invoke the graph again. A cached numeric full-frame view is reused
when its mapped crop has enough real pixels, while an insufficient one promotes to the master instead of being enlarged.
`--preview-size 2048` has a 2048px long edge; numeric region size downsizes but never upscales; different views share `render_hash`
and have different `view_hash`/paths; offline native detail truthfully reports its lower actual tier/scale and
`preview_resolution_limited` instead of upscaling the overview. The cache-planner assertions use an instrumented graph invocation
counter plus master path/hash/mtime checks, not timing;
slice 03's `preview-single-flight.test.ts` stays green while the producer runs the developed graph;
`preview-coordinate-contract.test.ts` round-trips base points through both transforms after orientation,
crop, rotate, and straighten, proves partial clipping is reported, and proves a fully outside region is a usage error;
`preview-color.test.ts` reads every preview tier independently and proves the `sRGB2014` ICC is embedded and agrees with
`preview_info`; slice 03's prune test holds an in-flight preview and touches a completed one while pruning to prove both survive;
`render-determinism.test.ts` (same dict twice → byte-identical); `develop-dict.test.ts`; `exposure=1` doubles linear mean within 5 %
via `render --linear`; crop-last test; Rust unit tests per operator on ramps. Visual: 8b1 `compare-screenshots` vs CIRAW neutral
(global tone/color; crops skin/sky/shadow); 8b2 skin crop; 8c1/8c2 100 % crops vs neutral; `screenshot-critique` last.

## Delegated: normalized table/column names within the named ownership split; operator constants (data); NLM parameters.
## Checkpoints: 8a2 `wb graph <id>` shows a source→develop→output chain plus revision/identity facts (structure only); one visual
variable per later sub-slice as listed. Any shot runs `screenshot-critique` last and `compare-screenshots` when it has a prior/reference
target. Checkpoints are non-blocking per the root rule.
## Must stay green: 01–07. Deps: 7b (functional), 7a (macos). Firewall: no layers, no providers, no learned NR, no CoreML, no VLM.
