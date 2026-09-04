# 08 — develop → gold exam green

Sub-slices, one judged variable each: **8a** dict/presets/hash (no pixels) · **8b1** global per-pixel ops · **8b2** masked ops
(highlights/shadows/vibrance; skin crop) · **8b3** curves/levels · **8c1** local contrast (brilliance/definition/sharpen) ·
**8c2** NR (texture crop) · **8c3** geometry (exact tests) · **8c4** filters + B&W (data).

## API seam
- **8a** `packages/render/src/develop/{dict.ts,keys.ts,tiers.ts,hash.ts,presets.ts}`: one dict (D21); `--set` absolute merge,
  `--unset`, `--reset`, `--preset` (partial overlay before `--set`; resolved keys stored; `preset` name kept as provenance, excluded
  from the hash), `--copy-from`; `filter` = `filter.name`+`filter.strength`; `developHash="h_"+sha256(canonical).slice(0,12)`.
  **Operator table** in `keys.ts`, written before code — per key: range, operator, formula (OpenColorIO GradingPrimary/
  GradingTone math ported, BSD-3, not linked): `exposure` ×2^v · `brightness` GradingPrimary offset · `contrast` pivot 0.18 ·
  `black_point` lift · `highlights/shadows` GradingTone highlights/shadows with luminance masks · `saturation` GradingPrimary
  saturation · `vibrance` saturation weighted by (1−sat) and skin-hue protection · `white_balance.temp_offset_k/tint` Bradford ·
  `curves/levels` GradingRGBCurve · `definition` unsharp radius 3 % long edge · `brilliance` 31×31 local light map ·
  `sharpen` unsharp radius 1 px · `vignette` radial gain · `noise_reduction.{luminance,color}` NLM · `bw.*` · `cast` ·
  `selective_color`. **Tier table**: Tier-1 = `exposure brightness contrast saturation vibrance black_point` and `white_balance`
  iff |Δtemp| ≤ 300 K; Tier-2 = all else. Presets = session D1–D3 verbatim (package data; `<lib>/presets/develop/` overrides).
  Migration (next number) adds `photos.develop jsonb default '{}'`, `develop_hash`. Result `{develop_hash, layers:{delta_applied:[],stale:[]}}`.
- **8b/8c** `crates/photoctl-image::develop` on f32 linear Rec.2020 (D22) → display 16-bit; render cache `dev/<id>/<hash>.<tier>.tif16`;
  `renderPhoto({source:"develop"})`; export uses the develop render for every source format. Full-resolution decoding is preferred;
  an embedded or pinned-preview fallback runs the same graph at its available dimensions and returns a source warning.
  `render <id> --linear --to out.tif` probe. Geometry keys
  `crop:{x,y,w,h}`, `straighten_deg`, `rotate ∈ {0,90,180,270}` applied last; `show.crop` mirrors them. `auto_straighten`: Hough
  (portable, the only implementation in tests); `crop --auto` = straighten + minimal trim. NR only in Rust; CIRAW invoked with NR off.
- `packages/render/src/preview.ts` gains `ensurePreview(photo,renderHash,viewSpec) → {path,preview_info}` and
  `choosePreviewSource(photo,renderHash,viewSpec) → exact-view | sufficient-full-frame | render-master`. Slice 08 extends the
  slice-01 hash input with decoder/version, develop dict, and geometry. The canonical native full-frame display master is
  `view/<id>/<render_hash>/master.jpg`; other outputs are `view/<id>/<render_hash>/<view_hash>.jpg`. Generation uses temp-file +
  fsync + atomic rename and upserts unpinned `cache_index` rows. Every cache hit validates readable JPEG bytes before reuse.
  `show` calls `ensurePreview`; develop/crop mutations only commit state and return the new `render_hash`, without rendering pixels.
- Source selection is deterministic. An exact view wins. Otherwise a cached full-frame view is sufficient only when, after mapping
  the requested base-image region into that view, both available crop dimensions are at least the requested output dimensions.
  Choose the smallest sufficient full-frame entry and crop/downsample it. If none is sufficient, render the current graph once as
  `master.jpg` at the best available full-frame resolution, then derive the requested view from it. A native full-frame request
  returns `master.jpg` itself. Once a master exists, no region or smaller-view request for that `render_hash` may reevaluate the
  graph. The cheap default 1616 overview does not eagerly create a master. `preview_info.cache_source` is one of
  `exact_view | sufficient_full_frame | render_master`, and reports the selected source dimensions as well as output dimensions.
- `PreviewCoordinator.materialize(key, work)` is the sole artifact writer. Requests for the same
  `{photo_id,render_hash,master|view_hash}` are single-flight across callers sharing the cache: one request performs the graph
  render or derivation while the others await and then validate the same path. No waiter observes a partial file; failure removes
  the flight/claim and temporary bytes so retry is possible. This invariant covers different region requests converging on the
  same missing master, not only byte-identical `ViewSpec`s. A successful exact hit or materialization updates
  `cache_index.last_used` after JPEG validation and inherits slice 03's 30-minute prune grace.
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
`preview-single-flight.test.ts` launches concurrent overview, native, and overlapping region requests at one render hash and proves
one master graph evaluation, one valid artifact per key, identical paths for identical views, retry after injected failure, and no
temporary-file residue; `preview-coordinate-contract.test.ts` round-trips base points through both transforms after orientation,
crop, rotate, and straighten, proves partial clipping is reported, and proves a fully outside region is a usage error;
`preview-color.test.ts` reads every preview tier independently and proves the `sRGB2014` ICC is embedded and agrees with
`preview_info`; slice 03's prune test holds an in-flight preview and touches a completed one while pruning to prove both survive;
`render-determinism.test.ts` (same dict twice → byte-identical); `develop-dict.test.ts`; `exposure=1` doubles linear mean within 5 %
via `render --linear`; crop-last test; Rust unit tests per operator on ramps. Visual: 8b1 `compare-screenshots` vs CIRAW neutral
(global tone/color; crops skin/sky/shadow); 8b2 skin crop; 8c1/8c2 100 % crops vs neutral; `screenshot-critique` last.

## Delegated: operator constants (data); NLM parameters.
## Checkpoints: one per sub-slice as listed. Silent ⇒ ship sample values.
## Must stay green: 01–07. Deps: 7b (functional), 7a (macos). Firewall: no layers, no providers, no learned NR, no CoreML, no VLM.
