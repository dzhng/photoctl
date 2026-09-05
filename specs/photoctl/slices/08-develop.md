# 08 — immutable render DAG → develop → gold exam green

Sub-slices, one seam or judged variable each: **8a1** immutable logical DAG/schema/revisions/full hashes · **8a2** canonical
artifact publication, evaluator, graph inspection · **8b** develop dict/presets as a node (no pixels) · **8c1a** exact
scene-linear graph artifacts · **8c1b** global per-pixel ops ·
**8c2** masked ops (highlights/shadows/vibrance; skin crop) ✓ · **8c3** curves/levels ✓ · **8d1** local contrast
(brilliance/definition/sharpen) · **8d2** NR (texture crop) · **8d3** geometry (exact tests) · **8d4** filters + B&W (data).

## API seam
- **8a1** replaces the current linear `renderPhoto` state model with `packages/render/src/graph/{types,recipes,store}.ts`.
  Typed immutable nodes cover `source|develop|generate|upscale|resample|transform|mask_composite|composite|crop|markup|output`;
  a registry owns each kind's supported recipe versions, parameter schema, input arity, recipe canonicalization, and determinism
  declaration. PGlite stores normalized
  `image_nodes`, ordered `image_node_inputs`, `node_executions`, `image_artifacts`, `document_revisions`, and revision roots;
  Slice 10 adds user-visible `layers.output_node_id` roots rather than a second graph. Node parameters are validated JSON, but
  topology is relational: one transactional writer verifies input existence, same-photo ownership where required, and acyclicity.
  No mutable-node update path exists. One compare-and-swap transaction inserts a mutation's whole node chain, copies untouched roots,
  redirects typed roots, and advances the document revision; logical nodes may remain unevaluated.
- **8a1 identity:** recipe, execution, artifact, render, and versioned view hashes are full SHA-256 (`<prefix>_<64 hex>`); `--human` alone
  abbreviates. Logical node identity derives from `{kind,recipe_version,canonical_parameters,ordered_input_node_ids}`, so a mutation
  can commit its revision and `render_hash` without rendering pixels. Deterministic evaluation identity separately combines the node
  recipe with ordered input artifact hashes; nondeterministic attempts retain distinct `execution_id`s even when output bytes match.
  Slice 08 hard-cuts the existing 12-hex preview protocol and paths; no compatibility alias or dual hash survives. A `source` node is
  stable photo state; each source execution records its actual locator/tier, dimensions, decoder id/version, and decoded artifact hash.
  Online full resolution and pinned fallback therefore keep one document render state while using distinct evaluation/cache identity.
- **8a2 artifacts:** `packages/render/src/artifacts` is the sole canonical pixel-artifact owner under
  `<lib>/artifacts/sha256/<prefix>/<artifact_hash>.<ext>`. Normalize and hash bytes, publish/fsync without overwriting differing
  content, then commit the execution + provenance in one database transaction. Logical nodes and revisions already exist before
  evaluation; a failed publish cannot activate an execution. A crash before the DB commit leaves an unreferenced file for the orphan sweep.
  Provenance lives in PGlite, not a second canonical
  sidecar. Preview/cache artifacts remain disposable and use the existing coordinator/index lifecycle.
- **8c1a artifact correction:** canonical graph artifacts are oriented scene-linear Rec.2020 RGB IEEE-f32 TIFFs. Their content
  hash covers the exact unclamped samples consumed by the next node. The artifact owner converts to display-sRGB RGB16 only for
  view/delivery readers; a provider may return display pixels and enter working linear once without settling the OPEN retention
  encoding for its paid response. Legacy display-RGB canonical files fail linear validation, become unavailable during
  reconciliation, and are lazily reevaluated from the normal source ladder.
- **8a1 revisions / 8a2 inspection:** active output, retained undo revisions, and pinned snapshots are GC roots. Reachability and
  `artifact_available` land now, but automatic canonical-artifact deletion remains disabled until the OPEN retention measurement
  chooses count/age/storage limits. `graph show <id> [--layer L] [--history] [--limit N] [--cursor C]` returns bounded pages;
  its opaque cursor is bound to the inspected document revision so concurrent edits cannot mix pages. `graph node <id> <node>`
  returns one bounded record. Default inspection walks only the active reachable graph, so the daemon's
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
  node/revision and returns `{develop_hash,render_hash,layers:{delta_applied:[],stale:[]}}`; an already-resolved no-op returns the
  active hashes without adding a duplicate revision.
- **8c/8d** `crates/photoctl-image::develop` on f32 linear Rec.2020 (D22); deterministic linear node artifacts replace a
  separate `dev/<id>/<hash>.<tier>.tif16` identity scheme;
  the graph evaluator; export uses the develop render for every source format. Full-resolution decoding is preferred;
  an embedded or pinned-preview fallback runs the same graph at its available dimensions and returns a source warning.
  display conversion/clamping occurs at view and delivery boundaries. `render <id> --linear --to out.tif` emits the actual linear
  output artifact. Geometry keys
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
8a1's recipe/store/migration tests prove strict kind schemas, ordered shared inputs, photo scoping, immutable lazy replacement,
cycle refusal, CAS revision undo, deterministic evaluation uniqueness, distinct nondeterministic attempt ids, and a root redirect in
one transaction. Protocol and human-output tests prove full identities on machine seams and presentation-only abbreviation.
8a2's `artifact-publication.test.ts` proves byte-normalized, full-hash, no-overwrite publication;
`evaluator.test.ts` injects failure before publish and before DB commit, proving no active missing reference and a collectible
orphan, deterministic reuse, distinct nondeterministic attempts, idempotent execution retries, and source-fallback provenance;
the same evaluator test deletes and corrupts indexed canonical files and proves reevaluation repairs both at the same content address;
`inspection.test.ts` walks revision-bound history larger than one page without duplication and rejects malformed cursors before
database casts; `restore-artifacts.test.ts` preserves canonical bytes while restore reconciles missing references to
`artifact_available:false`. Command/protocol tests require full hashes, and the workbench test follows a graph beyond one page.

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
target. Checkpoints are non-blocking per the root rule. The 8a2 graph report and 8b preset report were generated and structurally
tested. Visual capture was unavailable on 2026-09-05: the in-app browser was disabled for subagent display and its hidden surface
rejected local-file navigation; no indirect workaround was permitted, so no screenshot or visual-green claim was made.
The later 8c1b production-route check used the same 7008×4672 LibRaw source and crop with exposure as the sole variable
(`0` versus `+0.7`). The neutral and edited JPEG hashes are respectively
`ae279c7aa917a50893bf22a604d82420f1592da847a56792ab352397d23c5b26` and
`bec8207afb24753f5ec6de00827eb2a74d1129bdfa119e74c28f6fcd52106d6e`; comparison measured mean luminance
`61.19→78.04`, MAE `16.90`, and unchanged framing. Fresh unprimed critique found a spatially global luminance lift with
preserved structure and no obvious clipping, banding, blur, or halos. Existing edge fringing was only made easier to see.
This verifies production pixel consumption, not that the brighter grade is aesthetically preferable.

Slice 08c2's [G6 checkpoint](../assets/gates/G6-masked-operators.md) used vibrance as the sole production-route
variable on that same landscape and crop. The edited render measurably increased chroma without moving geometry,
but fresh critique did not prefer it and found the source's existing edge fringing marginally more visible. Because
the committed fixture contains no person, skin protection remains verified by deterministic equal-saturation pixel
tests rather than a visual acceptance claim.

Slice 08c3's [G7 checkpoint](../assets/gates/G7-curves-levels.md) used one master curve through the
same production route. The render hashes and pixel telemetry prove the curve reached the canonical
scene-linear artifact path; fresh review technically accepted and preferred the stronger grade while
flagging its cyan/green saturation as the main aesthetic caveat.

## Must stay green: 01–07. Deps: 7b (functional), 7a (macos). Firewall: no layers, no providers, no learned NR, no CoreML, no VLM.

## Implementation notes

- **2026-09-05 — 8c1a canonical artifact correction.** Plan said: develop consumes and emits f32 scene-linear Rec.2020. Code
  revealed: 8a2 canonicalized display-sRGB RGB16, irreversibly clipping native highlights before develop and forcing the linear
  probe to approximate them by inversion. Call: the existing artifact owner now publishes exact IEEE-f32 linear Rec.2020 TIFFs;
  DAG evaluation, identity, repair, restore, and availability all validate those bytes, while view/delivery alone convert to
  display. Legacy display artifacts reconcile unavailable and lazily regenerate. Needs David: no; this corrects the working format
  without adding a cache owner, and keeps provider-return retention encoding OPEN.

- **2026-09-05 — 8c1a source review.** Plan said: every online original enters the existing decoder seam, while embedded and
  pinned pixels are warned fallbacks. Code revealed: preview selection fed a RAW container's largest embedded JPEG directly to the
  graph. Call: one command-layer owner resolves ordered native whole-file, embedded, and pinned linear producers plus exact
  execution provenance for show and export; fallback reasons map centrally to `decoder_fallback` or `source_offline`. Needs David:
  no; this restores the specified decoder contract before pixel operators land.

- **2026-09-05 — 8c1b global operators.** The develop evaluator reads the canonical f32 linear artifact directly, runs the
  fixed-order Rust owner (white balance/cast, brightness/black point, exposure, contrast, saturation), and publishes the exact
  linear result. `render --linear` serializes that artifact without a display round-trip and publishes with atomic no-replace,
  including rejection of original and hard-link aliases. A deliberate clamp made the `+3 EV` regression fall from the expected
  `8×` mean ratio to `3.515×`, demonstrating that the test detects pre-output highlight loss; the unclamped route passes with
  negative, greater-than-one, and out-of-gamut samples intact. Needs David: no; masked, curve, local, geometry, and filter operators
  remain in their named later slices.

- **2026-09-05 — 8c1b bounded-memory review.** The asynchronous N-API boundary must copy a JavaScript typed array because its
  backing memory remains mutable by JavaScript. The worker now grades that one owned Rust buffer in place, bounding a 7008×4672
  RGB call to two pixel frames (785.8 MB / 749.4 MiB) instead of three (1.18 GB / 1.10 GiB). The linear probe now hash-verifies and validates
  the canonical TIFF in its byte buffer and atomically publishes those identical bytes; it does not decode another f32 array or
  re-encode a second TIFF. Needs David: no; both changes remove redundant full-frame allocations without making native CPU work
  synchronous.

- **2026-09-05 — 8c1b event-loop review.** Reused-artifact validation and develop initially decoded every TIFF sample into a
  `Float32Array` synchronously on the persistent daemon's JavaScript thread. The artifact owner now limits JavaScript work to
  asynchronous file reads, native SHA-256, and bounded TIFF metadata/ICC checks. Full-frame finiteness validation and global grading
  run together on the N-API worker over one owned canonical-byte buffer; reuse validation also scans samples asynchronously. A
  768×512 tracer observes repeated JavaScript timer heartbeats during grading. Needs David: no; exact samples, corruption rejection,
  two-frame peak memory, and byte-identical linear probe publication remain unchanged.

- **2026-09-05 — 8c1b publication/type review.** No-replace publication now writes and fsyncs only a sibling temporary, then uses
  the native platform primitive (`renamex_np(RENAME_EXCL)` on macOS, `renameat2(RENAME_NOREPLACE)` on Linux) for one atomic install.
  Occupied and unsupported outcomes preserve the destination and clean the temporary; there are no claim files, stale-owner
  takeovers, or partial final writes. The public
  in-memory develop helper also narrows to scene-linear Rec.2020 and rejects camera-space input at runtime. Needs David: no; these
  make the existing no-clobber and color-space contracts honest without changing command schemas.

- **2026-09-05 — 8c1b color review.** Directly substituting the Planckian 6504 K chromaticity for D65 made temperature discontinuous
  around zero, and saturation used display-oriented Rec.709 luminance weights on Rec.2020 pixels. Temperature now applies the
  Planckian-locus delta relative to 6504 K onto the exact D65 anchor; near-zero, warm, and cool tests pin continuity and direction.
  Saturation uses the Rec.2020→XYZ Y row and tests preserve Y for both grayscale and boosted chroma. Needs David: no; these correct
  the declared working-space math without changing control ranges or order.

- **2026-09-05 — 8c2 masked operators.** Highlights and shadows apply smooth Rec.2020-luminance masks and bounded stop gains
  after the primary grade, followed by saturation and skin-protected vibrance. Vibrance preserves Rec.2020 luminance and weights
  low-saturation colors more strongly; skin classification converts the working primaries before measuring hue. Needs David: the
  deterministic seam is complete, but broader fixtures should tune the delegated masks and a committed portrait crop must judge
  skin protection visually before aesthetic acceptance.

- **2026-09-05 — 8c3 curves and levels.** Normalized curve points are mapped onto OpenColorIO's `GRADING_LIN` log domain,
  evaluated by its monotonic quadratic B-spline shape, and linearly extrapolated beyond the endpoint controls. Per-channel curves
  run before the RGB master curve. Levels run immediately before curves as a signed black/white normalization plus reciprocal
  midpoint gamma, preserving negative and greater-than-one scene-linear samples. Both the in-memory and canonical-TIFF routes call
  the same Rust owner and retain the established artifact publication path. Needs David: no for the deterministic seam; the G7
  curve is intentionally strong and received technical, not aesthetic, acceptance.
