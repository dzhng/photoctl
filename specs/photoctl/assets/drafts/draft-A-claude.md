# photoctl v1 — Draft A (fewest-slices bias)

Recon basis (cited inline): `write-spec/spec-input.md`, `map.html` (D1–D40, A′, 7 OPEN, 8 integration cases), `session-sample.html` (A1–D3; B3/B4 superseded by D27/D28), `~/dev/duet-agent` (file-lock.ts, memory/{pglite,session,embedding-worker,migrations,recall}.ts, tests, eval), `~/dev/duet` (Bun workspaces + catalog + turbo + oxlint/oxfmt + docker-run test script), `~/dev/game` (root Cargo workspace + thin root scripts `test:rust`/`test:web`/`verify`), `.agents/skills/{write-tests,refactor-clean,write-spec}/SKILL.md`, `scratchpad/spike/*.mjs`, `fixtures/a7c2.ARW` (already at `/Users/david/dev/photoctl/fixtures/a7c2.ARW`, gitignored via `fixtures/*.ARW`). Measured on the fixture: embedded JPEG SOI markers at byte 44146 (8,217 B, 160×120), 192674 (466,017 B, 1616×1080), 659456 (6,730,200 B, 7008×4672). `specs/photoctl/{slices,visualizations,assets}` already exist; `slices/` is empty.

Ladder: **7 slices.** Gold exam is green after slice 04; every slice before it is useful on its own (01 = a working keyless culling + delivery tool). Nothing ships twice; nothing is scaffolding that a later slice deletes, with the two named exceptions in §3.

---

## 1. Slice graph

### 01-library — init, schema v1, lock, JSON contract, import --link, cull verbs, XMP read/write, identity-path export

**Contract unlocked.** `photoctl init → import fixtures/a7c2.ARW --link → show → export` produces a JPEG a human opens (interview checkpoint). Everything in the "cull → deliver" loop except develop, with no Rust, no Swift, no daemon, no gateway. Concurrency is *correct* (lockfile) but not yet *fast* (that is 02).

**API seam** (package `@photoctl/core`, app `photoctl`):
- `packages/core/src/library/db.ts` — `openLibrary(path, {noDaemon?, lockBudgetMs?}): Promise<Library>`; `Library = { db: Queryable, settings, close() }`; `Queryable = { query<T>(sql, params?): Promise<{rows:T[]}>; tx<T>(fn): Promise<T> }`. Single DB access owner. In 01 the only transport is direct PGlite under the lockfile; 02 adds the socket transport behind the *same* `Queryable` (designed for it now, so 02 is not a parallel abstraction).
- `packages/core/src/library/lock.ts` — port of duet `src/file-lock.ts:29-51` (JSON payload `{pid,startedAt}`, `wx` open, stale-by-age at `file-lock.ts:67-82`) **plus** the pid-liveness check from `pglite.ts:886-893` with EPERM → *unknown* (not alive), bounded age, `SIGINT`/`SIGTERM` handlers (spike `lock.mjs:7-8`), exit-time unlink (`pglite.ts:222-236`). One lock model; `tryAcquire`/`poll(budget)`/`release` as in `spike/lock.mjs:12-38`. `pollAcquire` backoff `[10,20,40,60,80,100]` ms, ceiling 100 ms (D6), budget 30 s default → `library_locked` exit 75. Also keep `clearStalePostmasterLock` (`pglite.ts:848-865`; 0.5.8 writes `postmaster.pid`). Lock path `<library>/.photoctl-open.lock`.
- `packages/core/src/library/open.ts` — open = `PGlite.create({dataDir, extensions:{vector}})` with `@electric-sql/pglite-pgvector` (not `@electric-sql/pglite/vector`, cf. duet `pglite.ts:2` port card); `CREATE EXTENSION IF NOT EXISTS vector` asserted **outside** any recovery path (`pglite.ts:475-500` had it inside the probe). Unreadable dir → `library_unreadable`, exit 69, prints path + `photoctl restore <snapshot>` (D36); `PG_VERSION` mismatch → `run photoctl migrate` (never quarantine, never `pglite.ts:715` `quarantineDataDirectory`).
- `packages/core/src/library/migrations.ts` — runner lifted from duet `migrations.ts:387-435` shape (`schema_version` table, strictly ascending, transactional, `LATEST_SCHEMA_VERSION`). **Squashed v1** = `settings(key,value)`, `photos(id uuidv7 pk, content_key, size, full_sha256 null, shot_at timestamptz, shot_offset_min int, width, height, orientation, camera jsonb, exposure jsonb, rating int 0..5, flag text pick|reject|none, label text null, caption text null, folder text, filename text, develop jsonb default '{}', develop_hash text, created_at)`, `files(photo_id, volume_uuid, rel_path, seen_at, pk(volume_uuid, rel_path))` (D9 1:N locator table), `tags(photo_id, tag)`, `xmp_state(photo_id, sidecar_rel_path, read_mtime, read_at)`, `previews(photo_id, tier text emb160|emb1616|full, offset bigint, length bigint, cache_path text)` (D32). No embeddings/layers tables yet (refactor-clean: model what production writes; those arrive with their writers in 05/06).
- `packages/core/src/library/snapshot.ts` — `backup`/`restore` as `pg_dump` SQL via `@electric-sql/pglite-tools` (D37; replaces `pglite.ts:626` `cpSync`). Also emits `fixtures/libraries/schema-v1.sql` (the fixture the migration-upgrade test consumes from the first schema change, 05).
- `packages/core/src/library/identity.ts` — `contentKey(path): "ck_" + sha256(sizeLE64 ‖ head 1 MiB ‖ tail 1 MiB).hex.slice(0,16)`; full sha256 only on key collision (D9).
- `packages/core/src/library/volumes.ts` — `identifyVolume(absPath): {uuid, mount, online}`; macOS via `diskutil info -plist`; Linux via `findmnt`; **test seam** `PHOTOCTL_VOLUME_TABLE=<json>` (declared filesystem-edge mock per write-tests; it is how the Docker suite flips `online:false`).
- `packages/core/src/import/exif.ts` — exifr with `reviveValues:false`; instant = `DateTimeOriginal` + `OffsetTimeOriginal` parsed by us (sharp edge: exifr shifted the sample 6 h); stores `shot_at` + `shot_offset_min`.
- `packages/core/src/import/embedded.ts` — `locateEmbeddedJpegs(fd): {w,h,offset,length}[]` via TIFF IFD walk (StripOffsets/JPEGInterchangeFormat), fallback SOI scan of the first 8 MiB; extract the 1616×1080 to cache eagerly (D23/D32), record the 7008×4672 `(offset,length)`.
- `packages/core/src/cache/` — `cacheDir(libId)` default `~/Library/Caches/photoctl/<lib-id>` (D30), `init --cache-max`, `cache prune` LRU.
- `packages/core/src/xmp/` — `readSidecar(path): {rating,label,keywords,flag?}` (`xmp:Rating`, `xmp:Label`, `dc:subject`; flag under `photoctl:Flag` namespace since Classic keeps flags in-catalog); `writeSidecar` for `photoctl xmp write <id...>` and `xmp sync --read` (D19/D20: explicit only, sidecars only, mtime stored, `--xmp-stale` on list/doctor). Pure-JS XML.
- `packages/core/src/export/write.ts` — `writeExport(source: {kind:"jpeg-bytes"}|{kind:"rgb16", w,h,data}, opts): {file,w,h,bytes,icc}` via **sharp** (sole encoder/resizer in the repo; sRGB2014 ICC embedded; formats jpeg|tiff|png; `--quality`, `--resize`, `--template "{date}_{seq:03}_{stem}"`, `--on-collision skip|overwrite|rename`, `--iptc k=v…`, `--preset`). 01 feeds it the embedded 7008×4672 JPEG bytes (online) or the cached 1616 (offline, `warnings[].code="source_offline"`, still exit 0 per D28 — this resolves the map's integration case #5 wording "export exits 69", which predates D28; reviewer may flip it back by making `source_offline` a refusal in one function).
- `apps/photoctl/src/envelope.ts` — the one JSON owner (D10): stdout `{schema:1, ok, code?, data?}`; multi-id `{schema, ok:false, code:"partial", summary:{ok,failed}, results:[{id,ok,code?,…}]}`; exit 0/2/65/69/75; stderr NDJSON `{"event":"progress"|"warn"|"daemon"|"provider",…}`; `--human`; `--stream` on list/search; `warnings[]` inside `data`/`results[]` (D28). Every mutating verb takes `<id...>`; ids are UUIDv7, unambiguous prefix accepted.
- Verbs: `init [--path] [--cache-max] [--embed auto|manual]`, `import <folder|file> [--link|--copy] [--recursive]`, `list [--rating ">=4"] [--flag] [--label] [--tag] [--folder] [--xmp-stale] [--stream]`, `show`, `next [--unflagged]`, `rate --stars`, `flag --pick|--reject|--none`, `label <color|none>`, `tag --add|--remove`, `remove [--from-disk --yes]` (D34, Trash on Mac), `xmp write|sync --read`, `export …`, `cache prune`, `backup`, `restore`, `migrate`, `config get|set`, `doctor`.

**Human runs/sees.** `photoctl init --path /tmp/lib && photoctl import fixtures/a7c2.ARW --link && photoctl list --human && photoctl show <id> && photoctl export <id> --to /tmp/out --resize 2048` → open `/tmp/out/2023-10-02_001_a7c2.jpg`. `photoctl xmp write <id>` → open the sidecar next to the ARW.

**Verification** (all through `apps/photoctl/test/harness.ts:run(args,{library,env})` spawning `dist/photoctl.js`, gated `PHOTOCTL_TEST_IN_DOCKER=1`):
- import → export → JPEG decodes with sharp, `w=7008,h=4672`, ICC present; `--resize 2048` → `2048×1365`.
- Timezone (integration #6): `show.shot == "2023-10-02T18:18:37+02:00"`; `{date}` template renders `2023-10-02` under `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`.
- Re-import idempotency (#4): second import → `already_present:1, imported:0`; move the file within the volume → same id, new `files` row, old row gone.
- Offline (#5, amended): volume table flips `online:false` → `list` shows it, `rate` works, `export` writes from `emb1616` with `warnings[0].code=="source_offline"`.
- Concurrency-correctness (#3, lock arm only): 8 processes × 25 `tag --add` on one library → exactly 200 rows; 9th process with `--lock-budget 0` → `library_locked` exit 75, never silent loss (seed: `spike/cli-lock.mjs`, `spike/cli-nolock.mjs` as the red control).
- Multi-id partial: `rate a b ZZZZ --stars 5` → `code:"partial"`, exit 65, two ok results.
- XMP round-trip: `rate`/`tag`/`label`/`flag` → `xmp write` → fresh library `import` reads them back equal (assert values, not counts).
- `restore` from `backup` snapshot equals `list` output before.
- Doctor reports missing library / stale lock / cache size.

**Delegated.** CLI arg parser library; pure-JS XML parser choice; uuidv7 implementation; `--human` table formatting; cache LRU bookkeeping structure; whether `settings` is a table or a JSON row (must be in the DB, not a dotfile).
**Stays green.** n/a (first slice). **Deps.** none.

---

### 02-daemon — pglite-socket daemon, auto-start under the lock, thin client, `--no-daemon`

**Contract.** Same verbs, 111 ms instead of 1756 ms wall at 8 clients (map spike). Correctness already proven by 01; this slice is speed + the host process that 05's embed worker will live in.

**Seam.** `packages/core/src/library/db.ts` gains the second transport for `Queryable`: `pg` Client over `$TMPDIR/photoctl-<hash8(libraryPath+version+schema)>.sock` (≤104-byte edge; never in the library). `packages/core/src/daemon/{server,client,spawn}.ts`: `PGLiteSocketServer({db, path, maxConnections:8})` as in `spike/daemon.mjs:5`; spawn is guarded by the 01 lock; stale socket → check pid, respawn once, else `daemon_unavailable` exit 69; idle-exit 15 min (`idleExit` injectable; 05 suppresses it while the queue is non-empty); shutdown when the library dir disappears (volume unmount); `--no-daemon` on every verb; stderr `{"event":"daemon","action":"spawned"|"connected"|"exited",pid,socket,version,schema}` (session A1). Verbs `daemon start|stop|status`. Mutations are sent as one `BEGIN…COMMIT` statement batch per verb so the socket multiplexer never interleaves two writers mid-transaction.

**Human sees.** `time photoctl list` before/after; `photoctl daemon status` → `{pid, socket, uptime_s, clients}`; `--no-daemon` still works with the daemon down.

**Verification.** Integration #3 daemon arm: 8×25 and 24×25 rows exact (`spike/boundary.sh` seed); over-capacity refuses loudly (`daemon_busy` exit 75), never silent loss; kill -9 the daemon mid-run → next command respawns once and succeeds; stale socket file with dead pid → respawn; `--no-daemon` and daemon paths produce byte-identical `list` JSON. Perf gate: p50 of `photoctl show` < 250 ms with daemon warm (asserted as a band over 20 runs, not one sample).

**Delegated.** idle timeout value (15 min proposed, D6 "tweakable"); whether `doctor` restarts the daemon; version-key granularity of the socket hash.
**Stays green.** all of 01. **Deps.** 01. Reorderable: may land any time before 05.

---

### 03-decode — one decoder interface, CIRAWFilter helper, vendored LibRaw addon, oracle test, export from a real render

**Contract.** `export` renders from RAW (demosaiced, our colour pipeline) instead of the embedded JPEG; both decoders behind one interface; they are each other's oracle (D14, integration #8).

**Seam.**
- `packages/core/src/render/decoder.ts` (one owner): `interface Decoder { id:"ciraw"|"libraw"; available(): Promise<Availability>; decode(path, {maxLongEdge?}): Promise<LinearImage> }`; `LinearImage = { w,h, orientation, data: Float32Array /* RGB, linear Rec.2020, D22 */, meta:{whiteLevel, blackLevel, asShotWb, camXyz?, wbPreApplied:boolean /* Sony M/S edge */} }`. `selectDecoder(settings)` → prefer `libraw`, fall back to `ciraw`, `doctor` lists both. Coordinate space is the oriented, uncropped base (D13) — orientation is applied here, once.
- `packages/ciraw/` — Swift package `photoctl-ciraw` (no AppKit; CoreImage/ImageIO only, as `scratchpad/headless.swift:1-6`), CLI `photoctl-ciraw decode <in> --out <f32 raw> --meta <json>` rendering `CIRAWFilter(imageURL:)` with `identifierHint`, validity via `supportedDecoderVersions != ["None"]` (`scratchpad/rawtest.swift:33-35`), `workingColorSpace` linear, output linear Rec.2020 RGBAf → written as raw f32 + JSON header. TS wrapper spawns it. Mac-only code isolated here (spec success criterion).
- `crates/libraw-sys/` — LibRaw **0.22.2** vendored source (CDDL-1.0; 0.21.x silently returns the A7C mk1 matrix, map Q4), built with `--disable-openmp`, libc++ dynamic, no Homebrew paths (sharp edge). `crates/img/` — napi-rs crate exposing `decode(path) -> {w,h,orientation,meta,data:Float32Array}`; LibRaw used for unpack + metadata + demosaic only; **we** own black/white level, WB, `cam_xyz`→XYZ→Rec.2020, no auto-bright, no dcraw gamma (sharp edge on `dcraw_process()` defaults). `packages/img/` — the npm package around the `.node` (`darwin-arm64`, `darwin-x64`, `linux-arm64` for Docker).
- `packages/core/src/render/render.ts` — `renderBase(photo): Promise<Rgb16>` = decode → (develop ops arrive in 04; identity here) → display transform (linear Rec.2020 → sRGB piecewise TRC with negative reflection, sharp edge) → RGB16 → `writeExport({kind:"rgb16"})`. Lazy; cache tier `full` written under the cache dir.

**Human sees.** `photoctl export <id> --decoder libraw` and `--decoder ciraw` side by side; generated `specs/photoctl/visualizations/decoder-oracle.html` (contact sheet + per-channel diff heat map + stats).

**Verification.** Oracle (#8): both renders of `a7c2.ARW`, after each pipeline's WB and TRC, agree within a stated tolerance — mean ΔE00 < 3 over a 64×64 grid of patches excluding pixels above 0.9 (white level 16383 vs 15360 edge) — asserted as a distribution over patches, not one pixel. `linux-arm64` Docker run: `libraw` decodes the fixture to `7008×4672`; `ciraw` reports `unavailable` cleanly (not a crash) and `doctor` says so. `test:mac` (host gate `PHOTOCTL_TEST_ON_MAC=1`): `ciraw` decodes under `ssh localhost` (no window server — map lists this untested). Export from RAW still passes every 01 export test with `w=7008`. Perf gate: LibRaw decode+render of the fixture < 6 s on M5 (band).

**Delegated.** f32 wire format between Swift helper and TS (raw+header vs EXR); demosaic algorithm choice inside LibRaw (AHD/DCB); how the vendored source is fetched (git submodule vs copied tree, must build with `cargo build` alone, cmake absent on this machine).
**Stays green.** 01, 02. **Deps.** 01. Internal order: land `ciraw` first (gold exam unblocked on Mac), then `libraw` (oracle test turns on); each half has its own commit gate.

---

### 04-develop — develop dict, tiering table, presets, tone/colour math, filters, crop/straighten, retouch, cheap NR  → **gold exam green**

**Contract.** `develop <id...> --preset people --set exposure=0.3` changes the exported pixels; three presets ship; keyless gold exam passes end to end.

**Seam.**
- `packages/core/src/develop/keys.ts` — **the** tiering table (A′): `DEVELOP_KEYS: Record<Key,{tier:1|2, range:[min,max], default}>`. Tier-1: `exposure, brightness, contrast, saturation, vibrance, black_point, white_balance.temp_offset_k|tint (|Δ|≤300 K)`; Tier-2: everything else (`curves, levels, highlights, shadows, brilliance, definition, noise_reduction, selective_color, bw.*, sharpen, vignette, cast, filter, crop, rotate, straighten, retouch`). Consumers: CLI validation, XMP (none — develop isn't in XMP), Rust op ordering, 06's stale/delta logic. One owner, one file.
- `packages/core/src/develop/dict.ts` — one dict per photo (D21): `applyPreset(dict, preset)` then `--set k=v` merge, `--unset`, `--reset`, `--copy-from <id>`; `filter` = two keys `filter.name`/`filter.strength`; `developHash = "h_"+sha256(canonicalJSON).slice(0,12)`. Presets `packages/core/src/develop/presets/{neutral,people,high-contrast}.json` exactly as session D1–D3; `presets list|show|save`.
- `crates/img` — `develop(linear: &LinearImage, dict_json) -> LinearImage` on f32 linear Rec.2020 (D22): exposure, black point, brightness/contrast, highlights/shadows/brilliance as a SmartTone-style local light map (31×31, sharp edge — replicate the architecture, not the curve), saturation/vibrance (Photos' vibrance ≠ CIVibrance), WB offset via Bradford, curves/levels, definition (large-radius local contrast), selective colour, cheap NR (D39: luminance/colour NLM on the linear image; learned NR deferred), sharpen, vignette, B&W, filters (recipes = partial dict overlays + tone curve, strength lerps to identity), `retouch:[{x,y,r}]` heal (PatchMatch/Telea, local), then crop/rotate/straighten **last** (D13). Grading operators ported from OpenColorIO's GradingPrimary/GradingTone math (BSD-3; spec amendment replacing "port darktable/ART"), not linked.
- Verbs: `develop`, `presets`, `filter`, `crop --aspect [--straighten] [--auto]` (auto = horizon detection in the Swift helper via Vision `VNDetectHorizonRequest`, Mac-only, `unavailable` elsewhere), `retouch --at x,y [--radius]`. `--norm` coordinates 0..1 accepted everywhere coordinates are.
- `auto_enhance` is **not** here (needs the VLM → 07).

**Human sees.** `scripts/contact-sheet.ts <id>` → `specs/photoctl/visualizations/presets-<id>.html` with neutral / people / high-contrast renders of `a7c2.ARW` at 1616 px plus a 100 % crop on skin/highlights. **Taste checkpoint** (§6).

**Verification.** Gold exam (#1) in Docker with a 10-photo fixture set (`scripts/make-fixture-set.ts` — 10 byte-perturbed copies of a7c2 with distinct content keys) and keyless env: `import --link → list → rate ×10 → develop ×3 --preset people → export` → 3 JPEGs decode, dims right, differ from the neutral render. Determinism: same dict twice → byte-identical export (this is what makes 07's strict test meaningful). `exposure=+1` → mean luminance ≈ ×2 on a linear probe (band). `--set` after `--preset` wins (session A5). Crop last: `crop --aspect 1:1` after `straighten 2` → dims square, straightened content. `retouch` changes only pixels within radius+feather. Everything in 01–03 stays green with real renders.

**Delegated.** Exact curve parameters of the base tone sigmoid, local-light map radius, NR kernel, heal algorithm, filter recipes — all "data", judged at the checkpoint; whether Tier-1 ops also compile to a display-space delta now (06 needs it; landing it here is allowed).
**Stays green.** 01–03. **Deps.** 03.

---

### 05-search — provider seam (gateway × model adapter), embed worker in the daemon, hybrid search with RRF, schema v2 + first migration test

**Contract.** `search <query>` returns hybrid hits when a key exists and keyword hits (with `warnings[].code="provider_unconfigured"`) when not; embeddings never block import; cost is stated up front.

**Seam.**
- `packages/core/src/provider/` — introduced **once**, here, grown in 07: `interface Gateway { id:"vercel"|"stub"; call(req: GatewayRequest): Promise<GatewayResponse> }` (auth via `AI_GATEWAY_API_KEY`, retries, cost/ms accounting, `getCredits` for doctor); `interface ModelAdapter<Cap> { model: string; cap: Cap; toRequest(input): GatewayRequest; fromResponse(res): Output }`; capabilities `"embed" | "edit" | "generate" | "ground" | "restore"(reserved, D35)`; `packages/core/src/provider/models.ts` hard-coded per-verb table (D25; no capability fields read): `{embed:"google/gemini-embedding-2", edit:"openai/gpt-image-2", generate:"openai/gpt-image-2", ground:"google/gemini-3.1-flash"}` all confirmed present in `vercel-models.json`; overridable via `config set model.<cap>=…`. Missing key → `provider_unconfigured` exit 69. `gateway-stub.ts` (selected by `PHOTOCTL_GATEWAY=stub`) is the network-edge mock the Docker suite uses: canned vectors here, canned pixels in 07. Structured answers via `generateObject`+Zod (D29). OpenRouter is a second `Gateway` later, no caller change.
- Schema **v2**: `embeddings(photo_id pk, model text, vec halfvec(3072), created_at)` + `HNSW (vec halfvec_cosine_ops)` (D31); `photos.fts tsvector GENERATED` over tags/filename/caption/folder + GIN. **First real migration → the upgrade test**: load `fixtures/libraries/schema-v1.sql` (from 01), run `photoctl migrate`, assert v2 and that `list` equals the pre-migration list.
- `packages/core/src/search/worker.ts` — lift `embedding-worker.ts` drain shape (batch 50, `relinquish()` between batches, per-id cooldown, `interBatchYieldMs` injectable; re-derive yield vs the 100 ms poll ceiling together — the duet pairing is admitted unsound at `embedding-worker.ts:47-58`). Hosted in the 02 daemon (auto) or run by `photoctl embed [--all|<id...>]` (manual). Input = the cached 1616 preview (multimodal) — shape pending smoke 2. Daemon idle-exit suppressed while the queue is non-empty (D6). `init --embed auto|manual`; `import` result gains `embeddings:{queued, est_usd}` (D33, ~$0.90/2000).
- `packages/core/src/search/hybrid.ts` — port `reciprocalRankFusion` from duet `recall.ts:391-401`; keyword arm `ts_rank(websearch_to_tsquery)` (`recall.ts:287`), vector arm `<=>` (`recall.ts:319`); `search --stream`.
- TOAST probe (OPEN): a Docker test that upserts 3072-dim halfvec rows 5,000× then reads all back; if it reproduces duet `migrations.ts:356`, the worker writes delete+insert instead of UPSERT (decided at slice time, recorded in the slice file).

**Human sees.** `photoctl search "person in warm light"` → hits; `photoctl embed --all` progress on stderr; `photoctl doctor` shows key present/absent and each model id resolving.

**Verification.** Keyless: `search` returns keyword hits + `provider_unconfigured` warning; `import` says `embeddings:{queued:0, note:"manual"}`. Stub: worker drains N rows → N `embeddings` rows with the stub model id stored; `search` hybrid order equals RRF of the two arms computed from public rows (consume the owner's scores, don't re-derive). Lock-starvation regression (port of `test/memory-embedding-worker-lock-starvation.test.ts:27-43`, budgets re-derived for Node spawn time): a fresh `photoctl list` completes while the worker drains 30 batches. Migration upgrade test as above. Keyed (`test:smoke`, on demand): smoke 2 real request shape.

**Delegated.** worker batch size and yield constants (must be injectable); how `est_usd` is priced (constant table); stub vector generator.
**Stays green.** 01–04. **Deps.** 01, 02.

---

### 06-layers — segment (SAM 2.1 local, `--text` via Gemini grounding), layer model with full transforms, compositor, vacancy, markup, A′ staleness

**Contract.** Real editor layers, entirely local except `--text`; export flattens layers + markup; `develop` reports `delta_applied`/`stale`; unfilled vacancy renders magenta (D16). No paid fill yet.

**Seam.**
- Schema **v3**: `layers(id, photo_id, z, name, role subject|vacancy, state selected|moved|filled|stale, mask_path, pixels_path, transform jsonb {dx,dy,scale,rotate,flip,anchor}, opacity, blend, develop_hash, of_layer, created_at)`; `markup(id, photo_id, z, kind text|arrow|line|rect|ellipse|path|highlight, geometry jsonb, style jsonb)`. Mask/pixel blobs live under `<library>/layers/<photo>/<layer>.{mask.png,pixels.tif}` (paid state, not the deletable cache; 32 MP × RGB16 doesn't belong in wasm Postgres).
- `packages/core/src/layers/model.ts` — one layer noun (D8); transforms absolute by default, `--relative`; order scale→rotate→translate about anchor (default mask centroid) (D12/D13); coords in the oriented uncropped base; `layer list|transform|reorder|set|duplicate|remove|clear`; `fill --move --to|--by` is pure geometry here (D11) and emits the vacancy layer with the full original silhouette stored at lift (D15).
- `crates/img` — `segment(image, prompt: At|Box|Brush) -> Mask` via ort 2.0 rc CPU EP with SAM 2.1 (Apache-2.0; D7/D40 — CPU default, EP recorded in provenance); `mask_dilate/blur`; `composite(base: Rgb16, layers: &[PixelLayer], markup: &[Raster]) -> Rgb16` — Lanczos3 resample once at render, exact flips/quarter-turns, blend modes in display-referred 16-bit (D22). Markup is rasterized (resvg, MIT) inside the same crate and fed to the **same** composite pass — one compositor.
- `--text`: `ground` capability via the 05 provider seam: Gemini structured output `box_2d[]` (`[ymin,xmin,ymax,xmax]` 0–1000, converted in the adapter, never leaked) → SAM box prompt; all instances → one layer each; `--dry-run` creates nothing (D7b/D8).
- A′ hookup in `develop`: Tier-1 key change → delta-apply to layer pixels (`delta_applied:[…]`); Tier-2 → `state=stale` (`stale:[…]`, hint `fill --refresh`). Export writes anyway with `warnings[]` (`layers_stale`, `vacancy_unfilled`) (D28 supersedes session B4).
- Models: SAM 2.1 ONNX files fetched on first use to `~/Library/Caches/photoctl/models/`; daemon owns the compiled-model cache (D40); `doctor` reports presence.

**Human sees.** `segment <id> --at 2900,2500` → `layer list --human` + `scripts/mask-overlay.ts` writes `specs/photoctl/visualizations/mask-<id>-<layer>.png`; `fill --move --by 1200,0` → export shows the subject moved and a magenta vacancy; `markup add <id> --arrow 100,100 400,300` → flattened on export.

**Verification.** Keyless, all in Docker: mask from `--at` on the fixture covers the clicked pixel and is a single connected component of plausible area (band); `--brush` polygon round-trips exactly; transforms: `flip h` twice = identity byte-exact; `rotate 90` ×4 = identity byte-exact; `scale 1` `dx=0` render == base render bit-exact (the compositor's identity contract that 07 leans on); vacancy silhouette equals the mask at lift regardless of later moves; `develop --set exposure=0.5` → `delta_applied` contains every layer and the export still contains the moved pixels (brightened, band); `--set shadows=40` → `stale`, export writes with `warnings[].code=="layers_stale"`; markup arrow pixels present in export and absent from `show`'s base render. `--text` through the stub `ground` adapter (canned box) → same layer as `--box`. Perf gate: SAM image-encode ≤ 4 s on M5 CPU (band), 1024-px long edge.

**Delegated.** SAM 2.1 size (tiny/small/base) within the perf gate; resvg vs alternative raster (must live in `crates/img`); blob file formats; anchor semantics for `reorder`.
**Stays green.** 01–05. **Deps.** 04, 05 (provider seam for `--text` only; everything else keyless).

---

### 07-fill — `edit`/`generate` capabilities, model adapters, `--fit` pipeline, strict composite gate, refresh, reimagine, relight, outpaint, generate, auto_enhance

**Contract.** Every generative verb, one fill pipeline, strict leaves unmasked pixels bit-exact for *any* adapter — provable keyless via the stub.

**Seam.** `packages/core/src/fill/pipeline.ts` (one owner, above the adapters — D26): build diffusion mask (`strict` hard | `expand[=24]` dilate | `free` soft) → optional `--full-res` crop + `--pad N` → `ModelAdapter<"edit">` → adapter normalizes to sent dims (resample if needed, `resampled:true`; D27) → `composite(original, gen, mask)` via the 06 compositor → `unmasked_bit_exact` asserted by diffing against the pre-fill render, never trusted. Adapters: `gpt-image-2` (native mask, PNG requested), `gemini-3.1-flash-image` and `grok-imagine-image-2.0` (instruction+composite; "whole image" warning under strict = hard failure `provider_whole_frame`). Defaults replace→`expand=24`, remove→`strict`. Prompts C1–C4 as `packages/core/src/fill/prompts.ts` data. Flags `--remove|--prompt [--ref] [--fit] [--full-res] [--pad] [--strength] [--init original|fill|noise|empty] [--seed] [--model] --refresh --outpaint [--aspect|--px]`. `--strength` documented as feather + guidance, not A1111 denoise. `reimagine` (full frame, `drift:"full-frame"`), `relight` (C3 template through reimagine's path), `generate` (writes a file and imports it tagged `generated`), `auto_enhance` (C4 via `generateObject`+Zod on the 1024 preview + stats → ordinary develop keys). stderr `{"event":"provider",gateway,model,op,mask,sent_px,format}` (session B3). Provider results carry `cost_usd`, `ms`, `warnings[]`.

**Human sees.** After smoke 1 passes with a real key: the session-B flow on a7c2 (`segment --text` → `--move` → `fill --remove --fit strict` → `fill --prompt "…hat" --fit expand=200` → export), contact sheet `specs/photoctl/visualizations/fill-<id>.html` with before/after/mask.

**Verification.** Keyless with `PHOTOCTL_GATEWAY=stub` (stub returns a checkerboard at sent dims, and a second mode returning dims+28 px to exercise D27 resampling): strict composite (#7) — every pixel outside the mask equals the pre-fill render bit-for-bit, for both stub modes, for `strict`; `strict` + dims-mismatch mode → `provider_dims_mismatch` exit 65 with the hint; `expand=24` + mismatch → `resampled:true`, still bit-exact outside the dilated mask; `--refresh` on a stale layer regenerates and clears `stale`; `reimagine` output marked `drift:"full-frame"`; `generate` → new photo row tagged `generated`; `auto_enhance` with stub structured output → develop keys written, visible in `show`, `--reset` undoes; all gen verbs without key → `provider_unconfigured` exit 69 and gold exam remains green. Person-move flow (#2) end to end through the stub. Keyed (`test:smoke`): smoke 1 mask polarity (transparent-vs-white), one call per adapter.

**Delegated.** stub pixel pattern; how `--init` is honoured per adapter (documented per adapter); `--ref` handling for models without reference input (warn).
**Stays green.** 01–06. **Deps.** 05, 06.

*Not on the ladder:* MCP (spec step 9 "optional") — a v1.x client of the same verbs; `unblur` (D35 cut); learned NR (D39 deferred).

---

## 2. Boundaries, layout, root scripts, Docker seam

**Choice.** Bun as package manager + script runner (duet precedent: workspaces + `catalog` for the exact `@electric-sql/pglite 0.5.8` ↔ `pglite-pgvector 0.0.9` peer pin, `packageManager: "bun@1.3.x"`), **Node 24 as the runtime** for `photoctl`, the daemon, and the test runner (`node --test`; test files are `.ts` via Node 24's built-in type stripping; the process under test is always the built `apps/photoctl/dist/photoctl.js`, per D38). Rust via root Cargo workspace (game precedent). `engines.node >= 24`.

```
photoctl/
  package.json               workspaces ["apps/*","packages/*"], catalog, root scripts
  turbo.json                 build/check-types/lint/test (duet shape; test dependsOn ^build)
  Cargo.toml                 [workspace] members = ["crates/libraw-sys","crates/img"]
  .oxlintrc.json  oxfmt      (duet precedent)
  Dockerfile.test            node:24-bookworm + rustup (from 03) ; cargo target in a named volume
  scripts/test-in-docker.sh  scripts/gold-exam.sh <arw-dir>  scripts/make-fixture-set.ts  scripts/contact-sheet.ts
  apps/photoctl/             bin "photoctl" → dist/photoctl.js ; src/{cli.ts,envelope.ts,verbs/*.ts,daemon-entry.ts} ; test/harness.ts + *.test.ts (all functional)
  packages/core/             @photoctl/core: library/ import/ cache/ xmp/ export/ render/ develop/ provider/ search/ layers/ fill/ daemon/
  packages/img/              @photoctl/img: napi package for crates/img ; optionalDependencies @photoctl/img-darwin-arm64 | -darwin-x64 | -linux-arm64
  packages/ciraw/            @photoctl/ciraw: Swift package (Package.swift) + TS spawn wrapper ; Mac-only, no AppKit
  crates/libraw-sys/         vendored LibRaw 0.22.2 (CDDL-1.0), build.rs, --disable-openmp
  crates/img/                napi-rs: decode, develop ops, masks, sam, composite, markup raster
  fixtures/                  a7c2.ARW (gitignored) ; libraries/schema-v1.sql (committed) ; xmp/*.xmp (committed)
  specs/photoctl/            README.md slices/ visualizations/ assets/
```

Root scripts (game convention: bare = whole job, `:suffix` = one part):
```
"build":        "bun run build:rust && bun run build:swift && turbo build"
"build:rust":   "bun run --cwd packages/img build"        # napi build --release
"build:swift":  "bun run --cwd packages/ciraw build"      # swift build -c release (mac only; no-op elsewhere)
"test":         "bun run test:rust && bun run test:web"
"test:rust":    "cargo test --workspace"
"test:web":     "bash scripts/test-in-docker.sh"          # PHOTOCTL_TEST_IN_DOCKER=1 turbo test, gate ON
"test:mac":     "PHOTOCTL_TEST_ON_MAC=1 node --test apps/photoctl/test/mac/*.test.ts"   # ciraw, Trash, diskutil
"test:smoke":   "PHOTOCTL_SMOKE=1 node --test apps/photoctl/test/smoke/*.test.ts"       # real AI_GATEWAY_API_KEY, on demand
"gold":         "bash scripts/gold-exam.sh"               # needs the ARW folder path (OPEN #1)
"lint" / "typecheck" / "fmt" / "fmt:check" as game/duet
"verify":       "bun run fmt:check && bun run lint && bun run typecheck && bun run test && bun run test:mac"
```

**Docker seam.** `scripts/test-in-docker.sh` mirrors duet-agent `package.json` `test`: `docker run --rm -v "$PWD:/src:ro" -v photoctl-cargo:/work/target -w /work -e PHOTOCTL_TEST_IN_DOCKER=1 -e HOME=/tmp/home photoctl-test sh -lc 'cp -R /src/. /work && bun install --frozen-lockfile && bun run build && node --test apps/photoctl/test/*.test.ts'`. `apps/photoctl/test/helpers/docker-only.ts` = duet `test/helpers/docker-only.ts` shape with the env renamed; **CI runs the gate ON** and fails if zero tests executed (`--test-reporter` count assertion). Missing fixture inside Docker = failure, not skip. Timing constants (`PEER_LOCK_BUDGET_MS` etc.) re-derived for Node spawn (~150 ms vs Bun's ~1 s assumption at `memory-embedding-worker-lock-starvation.test.ts:43`).

---

## 3. Single-owner seams (refactor-clean)

| Concept | Owner | Introduced | Later slices |
|---|---|---|---|
| JSON envelope, exit codes, stderr events | `apps/photoctl/src/envelope.ts` | 01 | only add event kinds |
| DB access (`Queryable`, lock, open, migrations, snapshots) | `packages/core/src/library/` | 01 | 02 adds transport behind the same interface |
| Lock model | `library/lock.ts` (one, not duet's two) | 01 | — |
| Locator/identity (content key, `files` table, volumes) | `library/identity.ts`, `library/volumes.ts` | 01 | — |
| Export writer / encoder / resizer (sharp) | `export/write.ts` | 01 | 03 feeds RGB16 instead of JPEG bytes; Rust never encodes |
| XMP read/write | `xmp/` | 01 | — |
| Decoder interface + `LinearImage` + coordinate space | `render/decoder.ts` | 03 | 04/06 consume; orientation applied once here |
| Render graph (`renderBase` → composite → export) | `render/render.ts` | 03 | 04 inserts develop ops, 06 inserts composite |
| Develop dict + tiering table + presets | `develop/keys.ts`, `develop/dict.ts` | 04 | 06 reads tiers; 07 `auto_enhance` writes keys |
| Provider interface (gateway × model adapter × model table) | `provider/` | 05 | 06/07 add capabilities, never a second client |
| Layer model + compositor (pixel layers and markup) | `layers/model.ts`, `crates/img::composite` | 06 | 07 uses it unchanged |
| Fill pipeline + prompts | `fill/` | 07 | — |

Transitional scaffolding, both named with removal: (a) 01's identity-path source for `export` (embedded JPEG bytes) survives as the **offline** source only — it is not removed, it is demoted in 03 (`source_offline` warning path); (b) 05's `gateway-stub.ts` is a permanent test edge, not scaffolding. No compat wrappers anywhere; schema changes are hard cutovers via forward-only migrations.

---

## 4. Playable after each slice

01: cull + deliver a real shoot from the embedded JPEGs, XMP round-trip. 02: same, fast, with `daemon status`. 03: real demosaiced exports; oracle contact sheet. 04: **gold exam**; presets contact sheet. 05: `search`, `embed`, cost estimate. 06: segment/move/markup/flatten locally, stale/delta visible. 07: the full session-B flow with a key.

---

## 5. Risks / fog and proposed spikes

- **03 hides two builds.** Sub-gate inside the slice: (i) Swift helper headless-under-SSH check (`ssh localhost photoctl-ciraw decode fixtures/a7c2.ARW`) — 30-minute spike before writing the wrapper; (ii) LibRaw vendoring: spike `cargo build` of `crates/libraw-sys` on macOS and in the Docker image, `otool -L` shows no `/opt/homebrew` and no libomp. If (ii) slips, 04 proceeds on `ciraw` (Mac) and the oracle test waits.
- **04 taste + Photos-architecture unknowns** (SmartTone local light, vibrance≠CIVibrance): one variable per checkpoint — render the three presets, judge skin/highlights only; defer curve tuning to data edits.
- **05 smoke 2 + TOAST.** Both are probes with a decision recorded in the slice file; the stub keeps the slice keyless-verifiable.
- **06 SAM via ort.** Spike: run the SAM 2.1 encoder ONNX through ort CPU EP in a `cargo test` on the 1616 preview, measure ms; pick size against the ≤4 s gate. ort binary size for the napi package is a packaging risk — note it.
- **07 smoke 1 (mask polarity).** First thing to run with a key; the strict gate makes a wrong polarity show up as `unmasked_bit_exact:false`… no — it would inpaint the complement *inside* the mask; so the smoke asserts the masked region changed and the unmasked did not, on a synthetic half-mask.
- **Node vs Bun timing** in ported tests: re-derive every budget from measured Node spawn time in 01 before porting the starvation test in 05.

---

## 6. Human review checkpoints (all non-blocking, ~5 min, decide on evidence if silent)

01 exported JPEG + `list --human` opened with preview-shots. 03 decoder-oracle contact sheet (variable: colour/tonality agreement only; sharpness differences out of scope). 04 presets contact sheet (variable: skin + held highlights for `people`; blacks for `high-contrast`); run screenshot-critique last. 06 mask overlay PNG + moved-subject export with magenta vacancy (variable: mask edge). 07 first real fill after smoke 1 (variable: seam at mask boundary; compare-screenshots against the pre-fill render).

---

## 7. Scope firewalls

01: no rendering from RAW, no daemon, no gateway, no develop keys, no Rust/Swift. 02: no schema change, no new verbs beyond `daemon *`. 03: no develop ops, no NR, no crop; identity render only. 04: no VLM `auto_enhance`, no layers, no learned NR, no Camera Matching/local HSL. 05: text/keyword + embeddings only; no image editing capability; no OpenRouter (compat seam only). 06: no paid pixels, no fill prompts, no `--refresh`. 07: no local generative inference, no A1111/Comfy subprocess, no MCP, no GUI. Global: never write RAW bytes; never embed XMP; never quarantine a library; never read gateway capability fields.

---

## 8. OPEN items → slices and placeholders

| OPEN | Lands in | Placeholder until resolved |
|---|---|---|
| ARW drive path | `scripts/gold-exam.sh <dir>` (04) | `fixtures/a7c2.ARW` + `make-fixture-set.ts` 10-copy set |
| Gateway key + per-verb model IDs | 05 `provider/models.ts`, `config set model.*` | `PHOTOCTL_GATEWAY=stub`; keyless paths return `provider_unconfigured` |
| Smoke 1 mask polarity | 07 `test:smoke` | stub `edit` adapter with known polarity |
| Smoke 2 multimodal embedding shape | 05 `test:smoke` | stub `embed`; text-only request documented |
| Lossless-L tag (6 vs 7) | 03 decode test parametrized over `fixtures/*.ARW` | uncompressed a7c2 only; LibRaw handles both, rawler not used |
| PGlite TOAST on wide vectors | 05 probe test | delete+insert fallback chosen at slice time |
| Founder checklist (Classic masters + XMP before subscription ends) | outside code; README handoff note | 01's XMP reader is verified on `fixtures/xmp/*.xmp` authored by hand in Classic format |