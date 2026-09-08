# photoctl v1 — slice plan (drafter B, risk-first)

Givens I am not re-deciding: map D1–D40 + A′. Node 24 runtime. Forward-only numbered migrations, no back-compat. Interview: slice 1 ends with `init → import a7c2.ARW --link → show → export` producing a JPEG a human opens, keyless, no Rust, no Swift, no drive.

Risk-first ordering principle: every assumption that can kill the architecture gets a **gate slice** with a pass/fail artifact *before* anything is built on it. Gates are cheap (hours), produce a checked-in probe + a one-line verdict file under `specs/photoctl/assets/gates/`, and later slices cite the verdict. Six assumptions are gated: (G1) PGlite lock+daemon under real N-process concurrency, (G2) LibRaw ≥0.22 vendored build on macOS as a `.node`, (G3) CIRAWFilter headless under SSH / no window server, (G4) gateway mask polarity through `/v1/images/edits`, (G5) halfvec(3072) HNSW at 2k–20k rows + the TOAST bug repro, (G6) strict composite bit-exactness through a *real* adapter. Slice 1 itself is the seventh gate: the end-to-end skeleton (JSON envelope, PGlite open, locator, embedded-JPEG extract) proven on one real file.

---

## 1. Slice graph

Numbering is execution order. `→` = depends on. Every slice leaves `photoctl` runnable and a test green through the Docker seam (D38).

### 00-repo — monorepo skeleton, Docker seam, empty CLI
- **Contract unlocked**: `npm run verify` is a real gate from commit 1; `photoctl --version` prints the envelope; a Docker-gated test spawns the built CLI.
- **API seam**: `packages/cli` (bin `photoctl`), `packages/core` (empty), `packages/test-harness` (`spawnPhotoctl(args, {dataDir, env})` → `{stdout, stderr, code, json()}` and `withLibrary(fn)` that runs `photoctl init` into a temp dir). `test-harness` is the *only* way tests reach photoctl (write-tests: outermost entry point). Harness spawns `packages/cli/dist/bin.js` never `.ts` (D38 port card).
- **Human can run**: `npm run build && ./packages/cli/dist/bin.js --version` → `{"schema":1,"ok":true,"data":{"version":"0.1.0"}}`; `npm test` runs in Docker and prints ≥1 assertion executed (guard against duet's silent green: the harness fails if `PHOTOCTL_TEST_IN_DOCKER=1` and zero tests ran).
- **Verification**: `test/cli-version.test.ts` (asserts envelope shape via real spawn); `npm run verify` = fmt:check + lint + typecheck + test + test:rust (empty workspace ok).
- **Delegated**: oxlint rule set, tsconfig base (copy `~/dev/duet/packages/typescript-config/base.json`), Docker base image tag.
- **Stays green**: itself.
- **Deps**: none.

### 01-first-jpeg — init → import --link → show → export embedded JPEG (the interview's first playable)
- **Contract unlocked**: a keyless, Rust-less, Swift-less, drive-less end-to-end path on the real fixture. Proves: PGlite 0.5.8 + pglite-pgvector open (CREATE EXTENSION asserted outside any recovery path, map port card 2), lockfile open, schema v1 skeleton, JSON envelope D10, locator D1/D9, embedded-JPEG tiers D32, timezone edge, export identity path.
- **API seam** (all in `packages/core`, one owner each — see §3):
  - `envelope.ts`: `ok(data)`, `fail(code, extra)`, `partial(results)`, `exitCodeFor(code)`: 0 / 2 usage / 65 data / 69 unavailable / 75 temp. `code` strings are a closed union: `usage, not_found, partial, library_locked, file_offline, provider_unconfigured, provider_dims_mismatch, layers_stale, daemon_unavailable, catalog_unreadable, migrate_required, unsupported_file`.
  - `library/open.ts`: `openLibrary(path, {noDaemon}) → LibraryHandle` (this slice: direct PGlite + lock only; daemon arrives in 02). Refuse-to-open D36: unreadable dir → `catalog_unreadable` exit 69 with path + `photoctl restore` hint; `PG_VERSION` mismatch → `migrate_required`.
  - `library/schema/0001_init.sql` + `migrate.ts` (forward-only, `schema_migrations(version, applied_at)`). Tables this slice: `photos(id uuidv7, content_key, size, w, h, orientation, shot_at timestamptz, shot_offset_min, camera jsonb, exposure jsonb, rating int default 0, flag text, label text, created_at)`, `locators(photo_id, volume_uuid, rel_path, online bool, seen_at)`, `tags`, `photo_tags`, `develop(photo_id, dict jsonb, hash text)`, `xmp_state`. Vector/HNSW columns are *not* in 0001 — they land in the migration slice 06 gates.
  - `identity.ts`: `contentKey(path) = size + xxh3(head 1MB ‖ tail 1MB)` → `ck_<16hex>`; `fullHash` only on collision (D9).
  - `locator.ts`: `resolveVolume(path) → {uuid, mount}` via `diskutil info -plist` on Mac (isolated in `packages/core/src/platform/darwin/`); `rel_path` mount-relative; `online` = mount present now.
  - `raw/embedded.ts`: pure-TS ARW/TIFF IFD walk → `[{w,h,offset,length}]` for the 3 embedded JPEGs (160×120 / 1616×1080 / 7008×4672 measured on the map); pins 1616×1080 into cache `~/Library/Caches/photoctl/<lib-id>/emb/<id>.jpg` (D30/D32); records full-size `(offset,length)` in `photos.embedded_full`.
  - `exif.ts`: `exifr` for the fields `show` needs; **timezone owner**: `shotInstant(DateTimeOriginal, OffsetTimeOriginal) → {instant, offsetMin}`; never machine zone (edge card: exifr shifted the sample 6 h).
  - `export.ts` v0: identity path only — reads the full-size embedded JPEG (offset,length) from the ARW when online, else the pinned 1616 with a warning (D28), writes `<to>/<stem>.jpg`. `--resize/--template/--iptc` arrive in 03.
- **Human can run** (exact):
  ```
  photoctl init --path /tmp/lib
  photoctl import scratchpad/a7c2.ARW --link
  photoctl show <id>            # dims 7008x4672, shot 2023-10-02T18:18:37+02:00, locators[0].online true
  photoctl export <id> --to /tmp/out --format jpeg
  open /tmp/out/a7c2.jpg        # human opens the 7008x4672 JPEG
  ```
- **Verification** (through `photoctl`): `test/gold-skeleton.test.ts` — init/import/show/export on `a7c2.ARW`; asserts `show.data.dims == {w:7008,h:4672}`, `shot == "2023-10-02T18:18:37+02:00"` (integration case 6), export file exists with JPEG SOI and dims 7008×4672 (parsed from the output, not trusted). `test/import-idempotent.test.ts` — import twice → `already_present:1`; move the file within the temp "volume" → same id, new locator (case 4, volume stubbed via `PHOTOCTL_VOLUME_ROOT` env so the seam is mocked, not diskutil). `test/refuse-to-open.test.ts` — junk dataDir → exit 69 `catalog_unreadable`, no `.corrupted-*` sibling created.
- **Delegated**: uuidv7 lib, xxh3 vs sha256 for content key (must stay ~2.4 s/2000 files per D9), cache dir layout below `emb/`.
- **Stays green**: 00.
- **Deps**: 00.

### 02-gate-concurrency — lock + daemon under real N processes (G1)
- **Contract unlocked**: D6 proven on Node 24, not Bun. N real `photoctl` processes × M inserts → exactly N×M rows; over-capacity refuses loudly; zero silent loss. This is the slice that dies fast if PGlite+pglite-socket+lock does not hold.
- **API seam** (`packages/core/src/library/`):
  - `lock.ts` — port of `~/dev/duet-agent/src/file-lock.ts:29-51` shape (single try, `wx` open, JSON payload) **plus** pid liveness from `pglite.ts:886-893` with **EPERM = unknown (falls to age)**, bounded age (`STALE_MS` 10 min from `file-lock.ts:4`), `heldLockPaths` + `process.on("exit")` from `pglite.ts:220-234` **plus** SIGINT/SIGTERM handlers (missing in duet — map port card). One lock model only; duet's second one (`pglite.ts:751-800`) is not ported. Poll ceiling ~100 ms (`spike/lock.mjs:5` `POLL_BACKOFF=[10,20,40,60,80,100]`), not duet's 1000 (`pglite.ts:212`).
  - `session.ts` — port of `MemorySession` (`session.ts:1-60`) with `withDb` returning `{ok:true, value} | {ok:false, code:"library_locked", holderPid, waitedMs}` — **never** the `undefined`+warn swallow at `session.ts:191-195`; fix the `openWithPolling` lock leak (`session.ts:203-213`: `openPGliteHoldingLock` throwing leaves the polled lock held) with try/catch → release.
  - `daemon.ts` — `PGLiteSocketServer` (`spike/daemon.mjs`) on `$TMPDIR/photoctl-<sha1(libpath+version+schema)[:8]>.sock` (≤104 bytes edge), `maxConnections` 8, idle-exit 15 min (tweakable per map), suppressed while embed queue non-empty (hook only; queue arrives in 06), shutdown on volume unmount (hook only; 03 wires it). Spawn guarded by the lock; stale socket → check pid → respawn once → else `daemon_unavailable`. `clearStalePostmasterLock` kept (`pglite.ts:848-868`, 0.5.8 writes `postmaster.pid`).
  - `openLibrary` now: try socket (`pg` client) → else lock+spawn → else direct-with-lock when `--no-daemon`. Every command gets `--no-daemon`.
  - `photoctl daemon start|stop|status`.
- **Human can run**: `photoctl daemon status` → `{pid, socket, uptime_s, clients}`; `scripts/race.sh 8 25` (ported from `spike/boundary.sh`) prints `rows=200 expected=200 failures=0`.
- **Verification**: `test/concurrency-race.test.ts` (integration case 3): spawns N=8 real `photoctl tag <id> --add p$i` ×25 processes, then `photoctl list --tag` count == 200 *and* the set of tag values equals expected (write-tests: value, not count). Over-capacity: N=24 with `maxConnections` 8 → every failure is `library_locked`/`daemon_unavailable` with exit 75, `rows == 25 × successes` exactly. Port of `memory-session-concurrent-fresh-open.test.ts:25-60` → `test/fresh-open-race.test.ts`: 8 processes `init`ing the same fresh dir run migrations exactly once (`schema_migrations` rows), no sibling dirs. Timing constants injectable via env (`PHOTOCTL_LOCK_BUDGET_MS`), re-derived for Node spawn (~60 ms, not duet's assumed ~1 s at `lock-starvation.test.ts:43`).
- **Pass/fail artifact**: `specs/photoctl/assets/gates/G1-concurrency.txt` — the race script's output at N=8/12/24. FAIL ⇒ fall back to lock-only (no daemon) for every verb; D6's "auto-start day one" is amended and logged as a deviation. Nothing above depends on the daemon existing, only on `openLibrary`.
- **Delegated**: socket wire (pg vs pglite client), backoff shape between 10 and 100 ms, log file location.
- **Stays green**: 01 tests (now through the daemon by default and `--no-daemon` both — harness runs the suite twice via env).
- **Deps**: 01.

### 03-cull-and-deliver — list/next/rate/flag/label/tag/remove, XMP read, export delivery flags, offline state
- **Contract unlocked**: the professional cull loop (D17/D18) and a real deliverable export, still from the embedded JPEG. The gold exam minus develop is now runnable.
- **API seam**: `packages/core/src/cull.ts` (rate/flag/label/tag, multi-id per-item results → `partial`), `query.ts` (range grammar `">=4"`, `--flag`, `--label`, `--folder`, `next --unflagged` cursor, `--stream` NDJSON), `xmp/read.ts` (stars/keywords/label/pick from Classic sidecars; store sidecar mtime; `--xmp-stale` on doctor/list, D20), `export.ts` gains `--resize N --template "{date}_{seq:03}_{stem}" --on-collision skip|overwrite|rename --iptc k=v... --preset`, sRGB2014.icc embedded, `sharp` for resize/encode (no ARW involvement). `remove [--from-disk --yes]` → macOS Trash (D34). `volume.ts` owner of online/offline: `locators.online` refreshed on every open; `export` → `file_offline` exit 69 when the source volume is gone and no full-size cache; `develop`/`show`/`list` work offline (D1).
- **Human can run**: session-sample A3/A4/A6 verbatim — `list --rating ">=4" --flag pick --stream`, `next --unflagged`, `rate a b ZZZZ --stars 5` → `partial` exit 65, export with template/IPTC, unmount → `file_offline` exit 69 with hint.
- **Verification**: `test/cull-loop.test.ts`, `test/xmp-read.test.ts` (fixture sidecar written by the test, Classic field names `xmp:Rating`, `dc:subject`, `xmp:Label`, `photomechanic:Pick`? — no: **Classic pick has no standard XMP field; v1 reads stars/keywords/label only; flag is library-only** — resolved here), `test/export-delivery.test.ts` (template renders shot-local date `2023-10-02`, seq scoped to batch, `rename` produces `_1` suffix; IPTC read back with `sharp().metadata()`), `test/offline-drive.test.ts` (integration case 5; volume root stubbed via env; export exits 69; list shows `online:false`).
- **Delegated**: `--human` table widths; Trash implementation (`osascript` vs `trash` crate later).
- **Stays green**: 01, 02.
- **Deps**: 02.

### 04-gate-decoders — LibRaw ≥0.22 vendored `.node` on macOS (G2) + CIRAWFilter headless under SSH (G3) + oracle
- **Contract unlocked**: the `Decoder` interface with two real implementations and a checked-in oracle verdict. If neither decoder can be built/run headless, develop (05) is blocked — so it is gated **before** develop, with the embedded-JPEG path as the fallback that keeps the gold exam alive.
- **Sub-slices (each its own verdict; run in parallel)**:
  - **04a LibRaw build spike**: `crates/libraw-sys` vendoring LibRaw 0.22.2 source under CDDL, `cc`-built, `--disable-openmp` equivalent (no `-fopenmp`), libc++ dynamic, `MACOSX_DEPLOYMENT_TARGET` pinned; `crates/photoctl-img` napi module exporting `decodeRaw(path) → {w, h, cfa, black, white, camXyz[9], wbCoeffs[4], data: Uint16Array}` (unpack + metadata + demosaic only — pipeline math is ours, edge card). Verdict: `otool -L photoctl-img.darwin-arm64.node` contains no `/opt/homebrew/*libomp*`; `camXyz[0]` on a7c2.ARW equals `0.7460…` (0.22.2), not `0.7374…` (0.21.x mk1 matrix, map landmine). **FAIL** ⇒ v1 ships CIRAWFilter-only on Mac and the core-portability claim is logged as a deviation; the `Decoder` seam is unchanged.
  - **04b CIRAWFilter headless**: `apps/photoctl-ci` Swift helper (no AppKit; `scratchpad/headless.swift`, `rawtest.swift`, `gotcha.swift` are the seeds), stdin/stdout framed protocol: `{op:"decode", path, scale, wb, nr}` → 16-bit linear Rec.2020 RGB blob. Validity = `supportedDecoderVersions != ["None"]` + identifierHint (edge card). Verdict: run the helper via `ssh localhost photoctl-ci decode a7c2.ARW` from a session with no window server (`launchctl asuser` variant too) and record whether Metal CIContext renders; if it fails, record whether `useSoftwareRenderer` is really a no-op on Apple Silicon (edge card says so). **FAIL** ⇒ CIRAWFilter is marked `requires_window_server` in `doctor`, LibRaw becomes the default decoder, and the oracle test runs only where the helper works.
  - **04c oracle**: `test/decoder-oracle.test.ts` (integration case 8): both decoders render a7c2.ARW at 1/8 scale through the *same* TS-owned WB + TRC (`packages/core/src/render/pipeline.ts`, introduced here as the single owner of black/white level, WB, cam_xyz→Rec.2020, sRGB piecewise TRC with negative reflection); mean ΔE over the frame < tolerance T (delegated: implementer measures on the sample, files it as the contract, and the white-level disagreement 16383 vs 15360 is tolerated by clipping both at the lower value before comparison — edge card).
- **API seam**: `packages/core/src/decoder/index.ts`: `interface Decoder { id: "libraw"|"ciraw"; probe(path): Promise<DecoderProbe>; decode(path, opts: {scale: 1|2|4|8, wb: WbCoeffs|"as_shot"}): Promise<LinearFrame> }` where `LinearFrame = {w,h,space:"rec2020-linear",bits:16,data:Uint16Array}`. `decoder/libraw.ts` (napi), `decoder/ciraw.ts` (helper process). `photoctl doctor` lists both with status. `photoctl decode <id> --with libraw|ciraw --scale 8 --to out.tif` is the probe verb (kept; agents use it).
- **Human can run**: `photoctl decode <id> --with libraw --scale 8 --to /tmp/lr.tif`; same `--with ciraw`; `open` both; `photoctl doctor` shows decoder rows.
- **Verification**: 04a/04b verdict files; `test/decode-probe.test.ts` (dims 876×584 at scale 8, 16-bit TIFF). Rust unit tests in `crates/photoctl-img` for demosaic dims and matrix passthrough only (`cargo test --workspace`).
- **Delegated**: napi vs subprocess for the Rust side (napi per spec, but the seam allows a `photoctl-img` binary), demosaic algorithm (AHD default), helper framing (length-prefixed).
- **Stays green**: 01–03 (no decoder needed by them).
- **Deps**: 00 (Rust workspace), 01 (fixture/import).

### 05-develop — develop dict + tiering table + presets + full-res render + XMP write/sync
- **Contract unlocked**: gold exam complete: `develop --preset people` on real RAW pixels, exported through the render graph. D21/D22/A′ tiering is data, checked in.
- **API seam**: `packages/core/src/develop/dict.ts` (one dict per photo, `--set` absolute merge, `--unset`, `--reset`, `--copy-from`, `develop_hash = sha1(canonical json)`), `develop/keys.ts` = **the tiering table** (`{key, tier: 1|2, range, default}` — single owner; consumers: CLI validation, XMP writer, A′ stale marking in 07), `develop/presets/{neutral,people,high-contrast}.json` (session-sample D1–D3 values verbatim), `render/graph.ts` = **the render graph owner**: `render(photo, {scale}) → DisplayFrame16` = decode → pipeline (04) → grading ops in 32-bit float linear Rec.2020 (exposure, brilliance/SmartTone-style local light map, contrast, highlights/shadows, black_point, saturation/vibrance, WB offset, curves, levels, definition, selective_color, B&W, cheap NR luminance/color via decoder raw-domain or NLM, sharpen, vignette, filters as two keys) → display transform → crop/straighten last (D13). `xmp/write.ts` (`photoctl xmp write <id...>`, explicit only D19; `xmp sync --read`). `export` switches from identity path to `render` when a develop dict is non-identity **and** the volume is online; identity + cached embedded otherwise with `warnings:["rendered from embedded preview"]`.
- **Human can run**: the gold exam end to end: `import --link` (a7c2 or the drive) → `rate` → `develop --preset people --set exposure=0.3` → `export`; `photoctl presets show people`; `photoctl develop <id> --set contrast=30 && photoctl export … ` and eyeball. HTML contact sheet `specs/photoctl/visualizations/presets.html` generated by `scripts/preset-sheet.mjs` (neutral / people / high-contrast crops side by side) — reviewed with screenshot-critique per write-spec.
- **Verification**: `test/gold-exam.test.ts` (integration case 1, keyless: harness sets `AI_GATEWAY_API_KEY=` empty; asserts export dims, ICC tag `sRGB2014`, `warnings==[]` when online); `test/develop-dict.test.ts` (preset then `--set` order; `--reset`; `--copy-from`; hash changes iff dict changes); `test/xmp-roundtrip.test.ts` (write → wipe rating in DB → `xmp sync --read` → rating back; mtime stale flag); `test/render-determinism.test.ts` (same dict twice → byte-identical 16-bit output; this is the pre-req for strict composite in 07).
- **Delegated**: OpenColorIO vs hand-written grading ops (map amendment says OCIO grading transforms; implementer may start hand-written in Rust and swap; the seam is `render/graph.ts`), exact SmartTone lightMap radius, NR algorithm choice within "cheap live key" (D39).
- **Stays green**: 01–04.
- **Deps**: 04 (at least one decoder green).

### 06-gate-vectors + embed + search — halfvec HNSW at scale (G5), TOAST repro, worker, RRF
- **Contract unlocked**: `photoctl search "<query>"` returns hybrid hits; first schema change ⇒ first migration `0002_embeddings.sql` + upgrade-a-fixture-library test.
- **Gate first (06a)**: `scripts/gate-halfvec.mjs` on PGlite 0.5.8 + pglite-pgvector 0.0.9: create `halfvec(3072)` + HNSW cosine, insert 20 000 random rows, UPSERT each 5× (the duet TOAST pattern, `migrations.ts:356` comment "missing chunk number 0 for toast value"), then `SELECT … ORDER BY embedding <=> $1 LIMIT 20` and a full `pg_dump`-style read of every row. Verdict file `G5-halfvec.txt`: build time, query p50/p99, row count, and whether the TOAST error reproduces. **FAIL (TOAST)** ⇒ embeddings table is append-only (`INSERT … ON CONFLICT DO NOTHING` + delete-then-insert on re-embed, never UPDATE of the vector column) and `photoctl embed --rebuild` drops/recreates (duet's precedent `migrations.ts:326-333`); the `search` seam is unchanged. **FAIL (HNSW)** ⇒ no index, brute-force (fine at 20k per duet's note `migrations.ts:320-324`).
- **Smoke test 2 (needs a key)**: `scripts/smoke-embed.mjs` — one multimodal `gemini-embedding-2` request via the Gateway with the pinned 1616 JPEG; records the request shape that works. Until then `ProviderStub` returns deterministic vectors from `xxh3(id)` seeded PRNG.
- **API seam**: migration `0002` (`embeddings(photo_id, model text, vec halfvec(3072), created_at)`, `photos.caption`, `tsvector` generated column over tags/filename/caption/folder with GIN), `embed/worker.ts` (port of `EmbeddingBackfillWorker` `embedding-worker.ts:44-90`: batch 50, relinquish between batches, kick(), cooldown; **yield vs poll ceiling re-derived together** per edge card — yield must exceed the 100 ms ceiling, so 150 ms), runs *inside the daemon* (idle-exit suppressed while queue non-empty, D6), `search/rrf.ts` (cosine top-K ∪ tsvector top-K fused RRF k=60, delegated), `init --embed auto|manual`, import prints `embeddings.est_usd` (D33: ~$0.90/2000), `photoctl embed [--rebuild]`.
- **Human can run**: `photoctl search "wedding ceremony"`; `photoctl doctor` shows `embeddings: 1/1 queued 0`; with a key, `photoctl embed` and re-search.
- **Verification**: `test/migrate-upgrade.test.ts` — fixture library at schema 1 (checked in as pgDump SQL, D37, `specs/photoctl/assets/fixtures/lib-v1.sql`) → `photoctl migrate` → schema 2, rows intact; `test/search-hybrid.test.ts` with stub provider (query hits by tag via tsvector, by vector via seeded stub; RRF order asserted on values); port of `lock-starvation.test.ts` → `test/embed-worker-yield.test.ts` (peer `photoctl rate` completes within budget while worker drains 30 batches); `test/embed-consent.test.ts` (no key → `embed` returns `provider_unconfigured`, import still succeeds with `embeddings.queued:0, note`).
- **Delegated**: RRF k, tsvector config, whether captions come from Gemini (bonus, off by default).
- **Stays green**: 01–05.
- **Deps**: 02 (daemon), 03 (tags/list), stub provider from 07a if built first (else local stub).

### 07-gate-gateway — provider abstraction, stub adapter, mask polarity smoke (G4), strict composite bit-exact (G6)
- **Contract unlocked**: the two-level provider interface exists with a stub model adapter that returns canned pixels, and the strict composite is proven bit-exact against *that* adapter *and* against a deliberately misbehaving one (returns wrong dims, returns whole-frame edit). Real gateway calls need a key and are exercised by smoke scripts, never by the suite.
- **API seam** (`packages/providers`): `Gateway` interface (`vercel.ts` only; `openrouter` is a future file, not a shim), `ModelAdapter` interface `{ id; caps: {nativeMask: bool}; edit(req: EditRequest): Promise<EditResult> }` where `EditRequest = {image: PngBytes, mask: MaskPng|null, prompt, seed, sentPx:{w,h}, format:"png"}` and `EditResult = {image, returnedPx, resampled: bool, warnings: string[], costUsd, ms}` — D27 normalization happens **inside the adapter** (resample to `sentPx`, flag `resampled`); the strict check lives **above** in `packages/core/src/composite.ts`: `strictComposite(original16, gen16, mask) → {frame, unmaskedBitExact: true}` asserted by re-reading, and `provider_dims_mismatch` when `fit=strict && resampled`. Model table `packages/providers/src/models.ts` hard-coded (D25): fill/outpaint/reimagine/generate → `openai/gpt-image-2`; grounding/auto_enhance → `google/gemini-3.1-flash`; embeddings → `google/gemini-embedding-2`; overridable via `~/.config/photoctl/config.json`. `provider_unconfigured` when no `AI_GATEWAY_API_KEY`. `PHOTOCTL_PROVIDER=stub` selects `stub.ts` (canned pixels: masked region filled with a checker; optional `STUB_MODE=wrongdims|wholeframe`).
- **Smoke test 1** (`scripts/smoke-mask-polarity.mjs`, needs key): send the 1616 JPEG with a mask covering the top-left quadrant and the prompt "fill with solid red"; measure red-fraction inside vs outside the mask; verdict file `G4-mask-polarity.txt` records which polarity gpt-image-2 honored (OpenAI: transparent = edit). The `MaskPng` builder takes polarity from the adapter's `caps.maskPolarity: "transparent-edits"|"white-edits"`, set from this verdict. Until run: adapter default is OpenAI-documented (`transparent-edits`) and `doctor` prints `mask_polarity: unverified`.
- **Human can run**: `PHOTOCTL_PROVIDER=stub photoctl fill <id> --layer 1 --remove --fit strict` (after 08 for layers; here: `photoctl provider test --model stub` prints an EditResult); with a key: the smoke script.
- **Verification**: `test/strict-composite.test.ts` (integration case 7): stub adapter → every pixel outside the mask equals pre-fill render bit-for-bit (compares Uint16Arrays, not a count); `STUB_MODE=wrongdims` + strict → `provider_dims_mismatch` exit 65; `+ expand=24` → ok with `resampled:true`; `STUB_MODE=wholeframe` + strict → hard failure (landmine card). `test/provider-unconfigured.test.ts` — no key → exit 69 `provider_unconfigured` for fill/reimagine/generate/segment --text.
- **Delegated**: how canned pixels look, retry policy on 429 (bounded, exit 75), AI SDK version.
- **Stays green**: 01–06.
- **Deps**: 05 (render determinism), 06 optional.

### 08-segment-and-layers — SAM 2.1 via ort, layer rows, transforms, vacancy, A′ delta/stale
- **Contract unlocked**: `segment --at/--box/--brush/--text --dry-run`, `layer list|transform|reorder|set|duplicate|remove|clear`, `fill --move --by/--to` (pure geometry, emits vacancy layer, magenta placeholder D16), Tier-1 delta-apply vs Tier-2 stale on `develop --set`, export warns on stale/unfilled (D28 — session-sample B2/B4 "refuses" is superseded).
- **API seam**: migration `0003_layers.sql` (`layers(id, photo_id, z, role subject|vacancy, state selected|moved|filled, name, mask_path, pixels_path, develop_hash, transform jsonb, of_layer, stale bool)`), `packages/core/src/layers/model.ts` = **the layer model owner** (transform `{dx,dy,scale,rotate,flip,anchor}`, absolute default, `--relative`, S→R→T about anchor, coords in oriented uncropped base D12/D13), `render/graph.ts` extended with the composite stage (display-referred 16-bit, blend modes, Lanczos3 one resample; exact flips/quarter-turns), `crates/photoctl-img` gains `sam2Segment(embedding, prompts) → mask`, `maskDilate/Blur`, `lanczos3Resample`, `overlay`; `segment --text` → Gemini structured output (`generateObject` + Zod, D29; `box_2d` `[ymin,xmin,ymax,xmax]`/1000 converted in the adapter, edge card) → SAM box prompt; with `PHOTOCTL_PROVIDER=stub` grounding returns a canned box.
- **Human can run**: session-sample B1/B2 on a7c2.ARW with `--at`, `layer list --human`, `fill --move --by 1200,0`, `export` → magenta hole + `warnings:["layer 2 vacancy unfilled"]`; `specs/photoctl/visualizations/layers.html` contact sheet (moved subject, vacancy, after Tier-1 nudge, after Tier-2 stale) — screenshot-critique gate.
- **Verification**: `test/segment-local.test.ts` (`--at` on a7c2 → mask_px within a band across seeds? no — SAM is deterministic on CPU: exact mask_px pinned to the first measured value is a measure-and-pin smell; assert instead that the mask contains the clicked pixel and bbox ⊂ frame), `test/layer-transforms.test.ts` (absolute vs `--relative` idempotent retry; `flip` twice = identity byte-exact; 90° four times = identity), `test/tiering.test.ts` (Tier-1 key → `delta_applied` all, Tier-2 → `stale` all, driven by `develop/keys.ts` not a copied list), `test/export-warns.test.ts` (stale/unfilled → exit 0 with warnings, file written).
- **Delegated**: SAM 2.1 checkpoint variant (tiny vs small; CPU EP, D40), mask storage format (PNG 8-bit), placeholder magenta value.
- **Stays green**: 01–07.
- **Deps**: 05, 07 (stub grounding), 04a (Rust crate exists).

### 09-fill — fill --remove/--prompt/--outpaint with --fit/--full-res/--pad/--strength/--init/--refresh, prompts C1/C2
- **Contract unlocked**: the person-move flow end to end with the stub provider; with a key, real fills.
- **API seam**: `packages/core/src/fill/pipeline.ts`: build diffusion mask (strict hard / expand N dilate / free soft) → optional full-res crop + `--pad` ring → `ModelAdapter.edit` → `strictComposite`/soft overlay → layer `state:filled`, pixels pinned with `develop_hash`; `--refresh` regenerates stale layers; `--outpaint` pads canvas locally and masks the pad (C2). Prompts in `packages/providers/src/prompts/{remove,outpaint}.txt` (C1/C2 verbatim; data).
- **Human can run**: session-sample B3/B4 with `PHOTOCTL_PROVIDER=stub`; with key: real `--remove` on the a7c2 vacancy.
- **Verification**: `test/person-move-flow.test.ts` (integration case 2, stub provider, all the way to `export` with warnings); `test/fill-fit-modes.test.ts` (strict vs expand=24 vs free mask geometry asserted by mask_px monotonicity *and* the dilate radius reading back from the stored mask edge).
- **Delegated**: `--strength` = feather + guidance mapping; `--init` semantics for models that lack it (documented as no-op with warning).
- **Stays green**: 01–08.
- **Deps**: 07, 08.

### 10-bonus-verbs — reimagine, relight (prompt template), generate, auto_enhance, markup, crop --auto
- **Contract unlocked**: everything else in the spec's step 8, each a thin consumer of existing seams.
- **API seam**: `reimagine` = full-frame edit through the same adapter (`drift:"full-frame"`); `relight` = C3 template through reimagine; `generate` writes file + imports tagged `generated`; `auto_enhance` = C4 via `generateObject` → develop keys (D24); `markup` = migration `0004_markup.sql`, vector JSON, flattened on JPEG export via `render/graph.ts`; `auto_straighten` local horizon detection (Swift helper or Rust Hough; delegated); `restore` reserved capability name only (D35).
- **Human can run**: each verb once with stub; `markup add <id> --rect …` then export and see it.
- **Verification**: one functional test per verb with stub; `test/markup-flatten.test.ts` (pixel at rect edge differs from pre-markup export, JSON round-trips through `markup list`).
- **Delegated**: markup rendering lib, relight drift wording.
- **Stays green**: all.
- **Deps**: 09.

### 11-ops — backup/restore (pgDump), cache prune, doctor completeness, migrate, MCP (optional)
- **Contract**: `photoctl backup|restore` (D37), `cache prune` LRU to `--cache-max`, `doctor` checks decoders, daemon, gateway key + model IDs resolve (D25), xmp-stale count; MCP server exposing the same verbs (optional, last).
- **Verification**: `test/backup-restore.test.ts` (restore into a fresh dir → identical `list` output), `test/cache-prune.test.ts`.
- **Deps**: 06 (migrate exists), 02.

---

## 2. Package / app / crate boundaries, layout, root scripts

Package manager: **npm workspaces** (not Bun). Justification: the runtime is Node 24 (map port card), duet's Bun-derived spawn timings are exactly what D38 says to re-derive, and a second runtime in the toolchain is a second thing to keep honest; `~/dev/game` shows the "root package.json is a thin task runner over cargo + web scripts" shape (`~/dev/game/package.json` description), which is what photoctl needs. Turbo is not adopted (three TS packages, one bin — `npm run -ws` suffices); oxlint/oxfmt are lifted from duet (`~/dev/duet/.oxlintrc.json`).

```
photoctl/
  package.json            # workspaces: packages/*; root scripts below
  Cargo.toml              # [workspace] members = crates/*
  tsconfig.base.json      # from ~/dev/duet/packages/typescript-config/base.json
  .oxlintrc.json .oxfmtrc.json
  Dockerfile.test         # node:24-bookworm + rustup + cmake; the D38 seam
  packages/
    cli/                  # bin photoctl; verbs → core; envelope + exit codes; --human tables
    core/                 # library (open/lock/session/daemon/migrate), identity, locator,
                          # raw/embedded, exif, develop, render, layers, fill, composite,
                          # export, xmp, search, embed worker, platform/darwin/*
    providers/            # gateway adapter × model adapters, models.ts, prompts/, stub.ts
    img/                  # napi wrapper package for crates/photoctl-img (loads .node per arch)
    test-harness/         # spawnPhotoctl, withLibrary, docker gate, fixtures loader
  crates/
    libraw-sys/           # vendored LibRaw 0.22.2 (CDDL), cc build, no OpenMP
    photoctl-img/         # napi: decodeRaw, sam2Segment, mask ops, lanczos3, overlay, encode
  apps/
    photoctl-ci/          # Swift helper: CIRAWFilter decode + horizon; Package.swift; no AppKit
  specs/photoctl/         # README + slices/NN-*.md + visualizations/ + assets/{gates,fixtures}
  scripts/                # race.sh, gate-halfvec.mjs, smoke-mask-polarity.mjs, smoke-embed.mjs, preset-sheet.mjs
  test/                   # functional tests (spawn built CLI) — one file per slice contract
```

Root `package.json` scripts:
```
"build":        "npm run build:rust && npm run build:swift && npm run -ws build"
"build:rust":   "napi build --release --manifest-path crates/photoctl-img/Cargo.toml --platform -o packages/img/native"
"build:swift":  "swift build -c release --package-path apps/photoctl-ci"
"test":         "docker build -q -f Dockerfile.test -t photoctl-test . && docker run --rm -e PHOTOCTL_TEST_IN_DOCKER=1 -e AI_GATEWAY_API_KEY= -v $PWD/scratchpad-fixtures:/fixtures:ro photoctl-test npm run test:inner"
"test:inner":   "npm run build && node --test --test-concurrency=1 test/*.test.ts"   (Node 24 runner; tsx loader)
"test:rust":    "cargo test --workspace"
"test:mac":     "PHOTOCTL_TEST_IN_DOCKER=1 PHOTOCTL_TEST_MAC=1 npm run test:inner"   (CIRAWFilter/oracle/Trash cases; skip-marked in Docker by capability, not by env-gating assertions)
"lint":         "oxlint packages test scripts"
"fmt:check":    "oxfmt --check . && cargo fmt --all -- --check && swift-format lint -r apps"
"typecheck":    "npm run -ws typecheck"
"verify":       "npm run fmt:check && npm run lint && npm run typecheck && npm run test:rust && npm test"
"gate:G1":      "scripts/race.sh 8 25 && scripts/race.sh 24 25"
"gate:G5":      "node scripts/gate-halfvec.mjs"
"smoke:mask":   "node scripts/smoke-mask-polarity.mjs"
"smoke:embed":  "node scripts/smoke-embed.mjs"
```

Docker seam wiring: `packages/test-harness/src/docker.ts` exports `inDocker = process.env.PHOTOCTL_TEST_IN_DOCKER === "1"` and `testIfDocker` (shape of `~/dev/duet-agent/test/helpers/docker-only.ts:1-5`) **plus** an end-of-run assertion that `>0` docker tests executed when `inDocker` (closes duet's "CI green with zero assertions" landmine). CI runs with the gate ON. Mac-only capabilities (CIRAWFilter, Trash, diskutil) are detected by `doctor` and tests declare `requires: ["ciraw"]`; a missing capability *skips with a visible count*, never a silent pass. The fixture `a7c2.ARW` (70 MB) is mounted read-only, not copied into the image; tests that need a "volume" use `PHOTOCTL_VOLUME_ROOT` so `locator.ts` treats a temp dir as a mounted volume with a fake UUID — the seam is mocked, not `diskutil`.

---

## 3. API seams with exactly one owner

| Concept | Owner (file) | Introduced | Confirmed no parallel later |
|---|---|---|---|
| JSON envelope + exit codes + `code` union | `packages/core/src/envelope.ts` | 01 | CLI verbs only call `ok/fail/partial`; `--human` renders from the same object |
| Library open / lock / session / daemon | `packages/core/src/library/{open,lock,session,daemon}.ts` | 01 (open+lock), 02 (session+daemon) | One lock model (duet's second one at `pglite.ts:751` is not ported); `withDb` result type is the only degrade path |
| Migrations | `packages/core/src/library/migrate.ts` + `schema/NNNN_*.sql` | 01 | forward-only; 06/08/10 add files, never alter the runner |
| Identity (content key) | `identity.ts` | 01 | |
| Locator / volume / online | `locator.ts` + `platform/darwin/volume.ts` | 01 (locator), 03 (online refresh, unmount hook) | export/develop consult `locators.online`, never re-stat |
| Timezone | `exif.ts:shotInstant` | 01 | `{date}` template in 03 reads `shot_at`+offset from here |
| Embedded JPEG tiers | `raw/embedded.ts` | 01 | 05's export fallback reuses it |
| Decoder interface | `decoder/index.ts` | 04 | `render/graph.ts` is its only consumer |
| Raw pipeline math (levels, WB, matrix, TRC) | `render/pipeline.ts` | 04c | both decoders feed it; oracle consumes the owner's output (refactor-clean: no re-derivation in tests) |
| Render graph (develop → display → composite → crop) | `render/graph.ts` | 05 (develop), 08 (composite stage), 10 (markup flatten) | export never renders on its own |
| Develop dict + tiering table | `develop/dict.ts`, `develop/keys.ts` | 05 | 08's stale logic reads `keys.ts`; XMP writer reads it; presets are overlays on it |
| Coordinate space (oriented, uncropped base) | `layers/model.ts` (`toBase/fromBase`, `--norm`) | 08 | segment, fill, markup, crop all convert through it; Gemini/Vision conversions live in the provider adapter only |
| Layer model + transforms | `layers/model.ts` | 08 | fill --move is a transform write, nothing else |
| Provider interface (gateway × model) | `packages/providers/src/{gateway,model,models}.ts` | 07 | embed (06) consumes the same `Gateway`; stub is a `ModelAdapter`, not a branch |
| Strict composite | `packages/core/src/composite.ts` | 07 | above adapters; fill (09) calls it |
| Mask polarity | `ModelAdapter.caps.maskPolarity` | 07 | set from G4 verdict |

Transitional scaffolding and its removal: (a) 01's `export` identity path is **not** scaffolding — it stays as the offline/no-develop fallback per D28. (b) 06's local vector stub inside `core` exists only if 07 lands after 06; **removed in 07** when `providers/stub.ts` becomes the one stub (slice 07 file names this deletion). (c) `daemon` hooks in 02 for embed-queue and unmount are no-ops until 06/03 fill them — they are the real seam, not a wrapper. No compat wrappers anywhere; schema changes are hard cutovers via migrations.

---

## 4. Playable deliverables per slice

- 00: `photoctl --version`; `npm run verify` green in Docker.
- 01: init/import/show/export on a7c2.ARW → 7008×4672 JPEG opened by a human.
- 02: `photoctl daemon status`; `scripts/race.sh 8 25` prints exact-row verdict; G1 file.
- 03: cull loop + delivery export with template/IPTC; unplug → `file_offline` 69.
- 04: `photoctl decode <id> --with libraw|ciraw --scale 8 --to x.tif`; `doctor` decoder rows; G2/G3 verdict files; oracle test.
- 05: gold exam; `presets.html` contact sheet; `xmp write` produces a sidecar Classic can read.
- 06: `photoctl search`; migrate v1→v2 on a fixture library; G5 file; (with key) smoke:embed.
- 07: `photoctl provider test --model stub`; strict-composite test; (with key) smoke:mask + G4 file.
- 08: segment/layer/move on a7c2 with magenta vacancy in the export; `layers.html`.
- 09: person-move flow end to end (stub), real fills with a key.
- 10: every bonus verb once; markup visible in export.
- 11: backup/restore, cache prune, doctor complete, MCP.

---

## 5. Risks / fog and the spikes that retire them

| Risk | Where it dies fast | Pass/fail artifact | Fallback if FAIL |
|---|---|---|---|
| PGlite + pglite-socket daemon under real concurrency on Node (spike numbers were a 25-row script, not photoctl) | 02 | `G1-concurrency.txt` at N=8/12/24 | lock-only mode; D6 deviation logged |
| LibRaw 0.22 vendored build (no cmake/pkg-config/libraw on the machine; OpenMP/libc++ edges) | 04a | `otool -L` + `camXyz[0]==0.7460…` | CIRAWFilter-only v1 |
| CIRAWFilter headless under SSH ("untested" per edge card) | 04b | ssh-run log + rendered TIFF checksum | LibRaw default; ciraw flagged in doctor |
| Gateway mask polarity (inpaints the complement if wrong) | 07 smoke 1 | `G4-mask-polarity.txt` red-fraction in/out | adapter cap stays "unverified"; fill refuses real provider with `provider_unverified_mask` until run |
| Strict composite bit-exact across a re-encoding gateway | 07 | `strict-composite.test.ts` with stub `wrongdims`/`wholeframe` | none needed — the check is above the adapter by design |
| halfvec(3072) HNSW at scale + TOAST bug | 06a | `G5-halfvec.txt` | append-only embeddings + brute force |
| Multimodal embedding request shape | 06 smoke 2 | request/response JSON captured | text-only embeddings of caption+tags until known |
| Render determinism (needed for strict) | 05 | `render-determinism.test.ts` | pin single-threaded path for layer pixels |
| Sony lossless-L tag 6 vs 7 (OPEN) | 04a probe on drive frames | decode result per mode | LibRaw handles both; only matters for rawler, which is not used |
| Two decoders' white level disagreement | 04c | tolerance T recorded in the test as the contract | clip both to min white before comparing |

Sub-slicing already applied: 04 → 04a/04b/04c, 06 → 06a gate then worker, 07 → stub-first then smoke. Slice 08 is the widest (SAM + layers + tiering); if the choices ledger fills, split into 08a-segment-local, 08b-layers-transforms, 08c-tiering.

---

## 6. Human review checkpoints (non-blocking; open evidence, ~5 min, decide on evidence if silent)

- 01: open the exported 7008×4672 JPEG (preview-shots). Question: "is this the file you expect from `export` with no develop?"
- 02: show `G1-concurrency.txt`. Question: keep daemon auto-start (D6) or lock-only? Silent ⇒ keep if PASS.
- 04: open `lr.tif` vs `ciraw.tif` side by side (compare-screenshots). Question: which is the default decoder on Mac? Silent ⇒ LibRaw if 04a PASS (portability), else ciraw.
- 05: `presets.html` contact sheet (screenshot-critique, then human). Question: preset taste (Q3 "people" values). Silent ⇒ ship sample values.
- 07: `G4-mask-polarity.txt` (needs David to run with his key). This one is a *real* input — until run, real-provider fill stays disabled; the plan does not stall because stub covers 08/09.
- 08: `layers.html` (moved / vacancy / nudge / stale). Question: Tier-1/Tier-2 placement of `white_balance` and `vibrance` (map says expect to move them).
- 03: export template default `{date}_{seq:03}_{stem}` — show three filenames.

---

## 7. Scope firewalls (v1 does not touch)

Global: no GUI; no A1111/Comfy/darktable subprocess; no local generative weights (SAM 2.1 is geometry, D7); no OpenRouter adapter file (compat *shape* only); no cloud; no Lightroom develop-history import; no Best Take/Live Photo/red-eye; no learned NR (D39); no `unblur` (D35); no CoreML EP unless the D40 rule is met per model (v1: none); no writing into RAW bytes or source folders except explicit `xmp write` (D19).

Per slice: 00 no app code. 01 no daemon, no cull verbs, no resize. 02 no embed queue contents (hook only). 03 no RAW decoding. 04 no grading ops, no develop dict. 05 no layers, no providers, no vectors. 06 no image generation, no captions by default. 07 no layers, no real network in tests. 08 no gateway pixels (stub grounding only). 09 no reimagine/relight. 10 no MCP. 11 no multi-machine sync.

---

## 8. Where the OPEN items land

| OPEN | Consumed by | Placeholder until resolved |
|---|---|---|
| ARW drive path | 03 (offline test with the real volume), 04a (lossless-L frames), 05 gold exam on the real folder | `scratchpad/a7c2.ARW` as the only fixture; `PHOTOCTL_VOLUME_ROOT` fake volume for locator/offline tests |
| Gateway key + per-verb model IDs | 07 (`models.ts` defaults as proposed on the map), 06 (embed) | `PHOTOCTL_PROVIDER=stub` canned pixels/vectors; `provider_unconfigured` exit 69 on real verbs |
| Smoke 1 mask polarity | 07 (`caps.maskPolarity`) | adapter cap `unverified`; real fills disabled; stub-driven 08/09 proceed |
| Smoke 2 multimodal embedding shape | 06 | seeded stub vectors; text-only embedding of tags/caption as the interim real path |
| Lossless-L tag 6 vs 7 | 04a | uncompressed a7c2 only; LibRaw reads both, so no code branch is written until a frame exists |
| PGlite TOAST bug | 06a gate | append-only embeddings if it reproduces |
| Founder checklist (Classic masters + XMP before subscription ends) | 03 (`xmp read` fixture from real Classic sidecars) | test-authored sidecars with Classic field names; David's real sidecars added to `specs/photoctl/assets/fixtures/xmp/` when the drive arrives |