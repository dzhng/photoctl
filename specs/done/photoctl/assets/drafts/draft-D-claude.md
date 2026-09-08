# photoctl v1 — Draft D (feedback-loop / playable-surface bias)

Everything below treats the map's D1–D40 + A′ as givens. Where the session sample and D10 disagree on envelope placement, D10 wins (noted in §3). Measured facts cited from the map are not re-derived; new measurements I took during recon are marked **measured here**.

Recon facts used throughout (file:line):
- `~/dev/duet-agent/src/file-lock.ts:4` `DEFAULT_STALE_LOCK_MS = 10 min`; `:14` injectable `now`; `:67-78` age fallback. `src/memory/pglite.ts:2` imports `@electric-sql/pglite/vector` (doesn't exist in 0.5.x); `:226-234` exit-only cleanup (no SIGINT/SIGTERM); `:406-419` quarantine + start fresh; `:626` `cpSync` "clonefile" assumption; `:766-773` pid-only staleness; `:848-866` `clearStalePostmasterLock` (keep); `:886-893` `isProcessAlive` returns true on EPERM. `src/memory/session.ts:191-195` swallows `MemoryLockTimeoutError`; `:203-213` `openWithPolling` has no try/catch between `pollAcquireOpenLock` and `openPGliteHoldingLock` (lock leak). `src/memory/embedding-worker.ts:44-58` `DEFAULT_INTER_BATCH_YIELD_MS = 250` paired with a poll ceiling it admits it can't guarantee. `src/memory/migrations.ts:319-333` vector(3072) with no HNSW; `:356-360` the TOAST "missing chunk number 0" note. `src/memory/recall.ts:38` `RRF_K = 60`; `:134` `reciprocalRankFusion([keywordHits, vectorHits])`; `:391` signature. Tests: `test/memory-embedding-worker-lock-starvation.test.ts:43` `PEER_LOCK_BUDGET_MS = 4_000`, `:138` `Bun.spawn(["bun", scriptPath…])`, `:165-166` peers import `.ts`; `test/memory-session-concurrent-fresh-open.test.ts:36-78` N children → 1 row, no `.corrupted-*` siblings, lock file gone; `test/memory-pglite.test.ts:45-134` `clearStalePostmasterLock` cases; `test/helpers/docker-only.ts:3-5` `DUET_TEST_IN_DOCKER` gate; `evals/memory-multi-cli-lock.eval.ts:123` spawns the real CLI.
- `~/dev/duet/package.json` (Bun workspaces `apps/*`+`packages/*`, `workspaces.catalog`, `turbo`, `oxlint`/`oxfmt`, `test` = turbo per package); `~/dev/duet/turbo.json` (`test` dependsOn `^build`); `~/dev/duet/.oxlintrc.json`, `bunfig.toml` (`linker = "hoisted"`). `~/dev/game/Cargo.toml` (workspace `crates/*`), `~/dev/game/package.json` (thin aliases: `test` = `test:rust && test:web`, `check` = fmt:check + lint + typecheck + test, `verify` delegates to the web app).
- Spike: `scratchpad/spike/lock.mjs` (already the merged lock: pid liveness + `STALE_MS` age + SIGINT/SIGTERM + `POLL_BACKOFF=[10..100]`, `library_locked` error code), `cli-lock.mjs` (exit 75 on lock timeout), `cli-socket.mjs` (`pg.Client` over a unix socket), `daemon.mjs` (`PGLiteSocketServer{db,path,maxConnections}`), `check.mjs`, `boundary.sh` (8/12/24 clients vs `maxConnections=8`). `scratchpad/lab/t5.mjs` proves `pgDump({pg: db})` from `@electric-sql/pglite-tools/pg_dump` works on 0.5.8 (D37). `lab/t1.mjs`, `t2.mjs` are the halfvec/HNSW probes behind D31.
- Swift: `scratchpad/headless.swift` (no AppKit, CIContext renders), `datainit.swift`/`gotcha.swift` (junk → non-nil filter; `supportedDecoderVersions` is the validity check), `thumb.swift` (`scaleFactor=0.25 + isDraftModeEnabled`, `previewImage` = embedded JPEG), `timing.swift`.
- **measured here** on `scratchpad/a7c2.ARW` (73,400,320 bytes): embedded JPEGs at `offset=44146 len=8217 160x120`, `offset=192674 len=466017 1616x1080`, `offset=659456 len=6730200 7008x4672`. These are the D32 (offset,length) values slice 01 must reproduce.
- Gateway catalog (`scratchpad/vercel-models.json`): `openai/gpt-image-2` type=image modalities input `["text"]` only (wrong — D25's "don't trust the field"); `google/gemini-3.1-flash-image` output `["text","image"]`, per-image $0.067 at 1K; `google/gemini-embedding-2` type=embedding, input `["text"]` only (OPEN smoke test 2), $0.0000002/token; `spacexai/grok-imagine-image-2.0` $0.06/image.

---

## 1. Slice graph

Conventions used in every slice:
- **Binary under test**: `node apps/photoctl/dist/cli.js` (aliased as `photoctl` via the workspace `bin`). Every functional test spawns it; nothing imports internals except the two named pure-logic unit suites (envelope parser, RRF).
- **Test harness**: `packages/fixtures/src/harness.ts` exports `runPhotoctl(args, {lib, env, stdin}) → {code, out (parsed envelope), events (parsed stderr NDJSON)}` and `withLibrary(name)` (temp dir + `photoctl init`). Gate: `PHOTOCTL_TEST_IN_DOCKER=1` (port of `test/helpers/docker-only.ts:3-5`); `testInDocker` is `test.skip` without it, and CI/`bun run test` always sets it (D38).
- **Workbench**: `apps/workbench` is a dev-only CLI `wb` that writes self-contained HTML under `out/wb/`. Each slice adds exactly one `wb` command; the human opens it with `/preview-shots`. It is not a product surface and ships nothing.
- **Playable placeholder library**: `bun run fixtures:drive -- --count N --out /tmp/drive` writes N copies of `fixtures/a7c2.ARW` with distinct 64-byte tail padding (changes the D9 tail hash, leaves TIFF structure readable), into `YYYY-MM-DD_<shoot>/DSC0NNNN.ARW`, plus a Classic-style `.xmp` sidecar for each (ratings 0–5, `dc:subject`, `xmp:Label`). This is "a drive's worth of files" until David's drive arrives (OPEN 1).

### 01-first-jpeg — `init → import --link → show → export` (identity path)
- **Contract unlocked**: a fresh agent can create a library, link one ARW, read its metadata, and get the embedded full-size JPEG out — keyless, no Rust, no Swift. The JSON envelope, exit codes, migrations v1, and the lifted lock are all born here.
- **API seam**:
  - `packages/contract/src/envelope.ts`: `type Envelope<T> = {schema:1, ok:true, data:T, warnings?:Warning[]} | {schema:1, ok:false, code:ErrorCode, data?:unknown, warnings?:Warning[]}`; `ErrorCode` union (`usage|not_found|partial|library_locked|daemon_unavailable|file_offline|provider_unconfigured|…`); `exitCodeFor(code)` → `0|2|65|69|75` (D10). `packages/contract/src/events.ts`: stderr NDJSON `{"event":"progress",phase,done,total,per_sec?,eta_s?}`, `{"event":"daemon",…}`, `{"event":"provider",…}`.
  - `packages/contract/src/verbs/{init,import,show,export,doctor}.ts`: Zod schemas for each verb's `data`. `show.data` is exactly the A5 shape (`dims{w,h,orientation}`, `camera`, `exposure`, `shot`, `locators[]`, `content_key`, `develop`, `develop_hash`, `layers{count,stale}`, `xmp`).
  - `packages/db/src/{open.ts,lock.ts,migrations/index.ts,migrations/0001-init.ts}`: `openLibrary(path, {lockBudgetMs, now}) → Promise<LibraryHandle>`; `LibraryHandle.query(sql, params)` (the one query interface; slice 02 adds a second implementation over the socket, same interface). Lock = `spike/lock.mjs` shape (which is already file-lock.ts + pid liveness + bounded age + signals) with `EPERM → unknown` (fixes `pglite.ts:891`) and try/finally around the open (fixes `session.ts:203-213`). `clearStalePostmasterLock` ported verbatim from `pglite.ts:848-866` with its 7 test cases from `memory-pglite.test.ts:45-134`. Refuse-to-open per D36: unreadable dir → `code:"library_unreadable"`, exit 69, message includes the path and `photoctl restore` (restore itself lands in 03). `CREATE EXTENSION vector` (from `@electric-sql/pglite-pgvector`, exact peer pin 0.0.9) runs in `0001-init` outside any recovery path.
  - Schema v1 (`0001-init.ts`): `schema_version(version int)`, `photos(id uuid pk /*v7*/, content_key text unique, size bigint, w int, h int, orientation int, make text, model text, lens text, shot_at timestamptz, shot_offset_min int, exposure jsonb, rating int default 0, flag text default 'none', label text, develop jsonb default '{}', develop_hash text, created_at timestamptz)`, `volumes(uuid text pk, label text, last_mount text, last_seen timestamptz)`, `files(id uuid pk, photo_id uuid references photos, volume_uuid text references volumes, rel_path text, mtime timestamptz, embedded jsonb /* D32 {tiers:[{w,h,offset,length}]} */, unique(volume_uuid, rel_path))`, `tags(photo_id uuid, tag text, primary key(photo_id, tag))`.
  - `packages/core/src/files/identity.ts`: `contentKey(path) → "ck_"+sha256(size‖head1MB‖tail1MB).slice(0,16)` (D9). `packages/core/src/files/volumes.ts`: `VolumeResolver` interface `{resolve(absPath) → {uuid, mount, relPath}}` with `MacVolumeResolver` (`diskutil info -plist` / `statfs`) and `EnvVolumeResolver` (`PHOTOCTL_VOLUME_MAP=/tmp/drive=6A1F-0C3B` — the Docker-side seam; write-tests says mock at the filesystem edge, not internally).
  - `packages/core/src/exif/read.ts`: `readExif(path)` via `exifr` returning the A5 `camera`/`exposure`/`dims` fields plus `shot_at` + `shot_offset_min` parsed from `DateTimeOriginal` + `OffsetTimeOriginal` (sharp edge: exifr shifted the sample 6 h — parse the raw strings, never `Date`).
  - `packages/core/src/files/embedded.ts`: `scanEmbeddedJpegs(path) → [{w,h,offset,length}]` (must return the three **measured here** tuples for a7c2.ARW).
  - `packages/core/src/render/graph.ts`: `renderForExport(photo, {source:"embedded"}) → {buffer, w, h, icc}`. This is the render graph's single owner from day one — a 1-node graph. Slice 10 adds the develop node, 13 the composite node; the embedded source stays as the offline/fallback path (D23/D28), so nothing here is throwaway.
  - `packages/core/src/cache/tiers.ts`: cache root default `~/Library/Caches/photoctl/<lib-id>` (D30), `PHOTOCTL_CACHE` override; `emb/<id>.jpg` = the 1616×1080 tier extracted eagerly on import (D32).
  - `apps/photoctl/src/cli.ts`: argv → verb → envelope on stdout, events on stderr; `--human` renders tables; `--no-daemon` accepted everywhere (no-op until 02).
- **Human can run**:
  ```
  photoctl init --path /tmp/lib
  photoctl import fixtures/a7c2.ARW --link
  photoctl show <id>            # dims 7008x4672, shot "2023-10-02T18:18:37+02:00"
  photoctl export <id> --to out/ --format jpeg
  open out/a7c2.jpg             # 7008x4672, 6.7 MB, opens in Preview
  photoctl doctor               # node, pglite 0.5.8/pg 18.3, vector ext, cache root, lock state
  wb envelope                   # out/wb/envelope.html: every verb's success/failure/partial envelope from fixtures, exit codes beside them
  ```
- **Verification** (all in `apps/photoctl/test/`, through the binary): `first-jpeg.test.ts` (init→import→show→export; asserts exported bytes == bytes at offset 659456 len 6730200 of the fixture, and `show.data.shot == "2023-10-02T18:18:37+02:00"` — integration case 6, half of it); `envelope.test.ts` (unknown verb → exit 2, `not_found` → 65, unreadable library dir → 69 with restore hint); `identity.test.ts` (content_key of the fixture equals the value in `fixtures/a7c2.json`, and changing the last 64 bytes changes it); `lock.test.ts` (two processes, second waits and succeeds; stale pid file is reclaimed; `EPERM` treated as unknown → age rule). Unit: `packages/contract/test/exit-codes.test.ts`. Rust: none. Docker: `bun run test` passes with the gate ON.
- **Delegated**: arg parser library; table renderer for `--human`; sha256 vs a faster hash (must stay 16 hex chars); how `doctor` formats.
- **Must stay green**: `bun run verify` (which is only TS at this point).
- **Deps**: none.

### 02-daemon-and-race — auto-started daemon, socket client, loud over-capacity
- **Contract unlocked**: D6 in full — every command goes through a daemon unless `--no-daemon`; N real processes never lose a row; over capacity fails loudly with `library_locked`/`daemon_unavailable`, never silently.
- **API seam**: `packages/db/src/daemon/{server.ts,client.ts,socket-path.ts,spawn.ts}`. `socketPath(libraryPath) = $TMPDIR/photoctl-<sha1(libPath+version+schema).slice(0,8)>.sock` (≤104 bytes, never inside the library). `ensureDaemon(lib) → {handle: LibraryHandle, event: "spawned"|"reused"|"unavailable"}`: take the file lock, stat the socket, `kill -0` the pid in `<sock>.pid`, respawn once, else `daemon_unavailable` (exit 69). Server = `PGLiteSocketServer` (spike `daemon.mjs`) + `maxConnections` from `init --daemon-max` (default 8); idle-exit 15 min (data, not code — `daemon.json` in the library); `daemon.registerBackground(name, task)` hook that suppresses idle-exit while a task reports non-empty (slice 12 uses it); unmount watcher (`fs.watch` on the mount root's parent) → graceful stop. Client = `pg.Client` over the socket implementing the same `LibraryHandle.query`. `photoctl daemon start|stop|status`. stderr event `{"event":"daemon","action":"spawned","pid","socket","version","schema"}` (A1).
- **Human can run**: `photoctl daemon status`; `bun run probe:race -- --clients 8 --rows 25` (seeded from `spike/boundary.sh` + `cli-lock.mjs`, but spawning the real `photoctl` with `photoctl rate`/`tag` writes) → `out/wb/race.html`: per-process timeline, rows expected vs found, which processes reported `ok:false` and with what code. `wb race` renders the same from the last run.
- **Verification**: `concurrency-race.test.ts` (integration case 3: N=8 × M=25 `photoctl tag <id> --add p<i>-<j>` → exactly 200 tag rows; N=24 with `maxConnections=8` → every failure is `library_locked` or `daemon_unavailable` exit 75/69, never a silent drop — assert the *values* of the tag rows, not just count); `daemon-lifecycle.test.ts` (stale socket + dead pid → respawn once; live foreign pid → reuse; `--no-daemon` bypass while daemon holds the lock → `library_locked` 75 with `holder_pid`); port of `memory-session-concurrent-fresh-open.test.ts:36-78` as `fresh-open.test.ts` (N children `photoctl init` the same path → one library, no `.corrupted-*`, no lock left). Timing constants injectable (`PHOTOCTL_LOCK_BUDGET_MS`, `PHOTOCTL_POLL_CEILING_MS`), re-derived for Node spawn (measure `node -e ''` cold start in the harness and set budgets as multiples, replacing the Bun-derived `PEER_LOCK_BUDGET_MS = 4_000` at `lock-starvation.test.ts:43`).
- **Delegated**: idle timeout value, whether `doctor` restarts the daemon, log file location.
- **Must stay green**: 01.
- **Deps**: 01.

### 03-library-lifecycle — backups, restore, migrate, cache prune, upgrade-a-fixture test
- **Contract unlocked**: a broken or old library is never quarantined or silently recreated (D36/D37); every future schema change has a proven upgrade path.
- **API seam**: `packages/db/src/backup.ts` `snapshot(handle) → <lib>/backups/<iso>.sql` via `pgDump` (`lab/t5.mjs`), on successful open with a dedupe window and a keep-5 prune (behaviour of `pglite.ts:603-640` minus `cpSync`); `photoctl restore [--from file]`; `photoctl migrate` (forward-only, refuses `PG_VERSION` mismatch with the message from D36); `photoctl cache prune [--max bytes]` LRU by atime over the cache root; `packages/fixtures/libraries/v0001/` = a pgDump of a slice-01 library with the fixture imported.
- **Human can run**: `photoctl restore --from <lib>/backups/<latest>.sql` on a deliberately truncated library; `photoctl migrate` on the fixture library; `wb library` → `out/wb/library.html` (schema version, tables, row counts, backup list, cache size).
- **Verification**: `refuse-to-open.test.ts` (corrupt `base/` → exit 69, path + restore command in message, directory untouched — falsify by deleting the guard); `restore.test.ts` (restore → the fixture photo's `content_key` is readable again); `migrate-upgrade.test.ts` (open `libraries/v0001` with the current migration list → `schema_version == LATEST`, the fixture row survives; this test is what every later schema slice extends by adding `libraries/v000N`); `cache-prune.test.ts`.
- **Delegated**: backup cadence knobs; pgDump compression.
- **Deps**: 01, 02.

### 04-import-at-scale — locators, offline, cull verbs, contact sheet
- **Contract unlocked**: import a drive's worth of files idempotently; cull (rate/flag/label/tag/next/remove) with per-item results; everything works with the drive unplugged except reading originals.
- **API seam**: `packages/core/src/files/locator.ts` (1:N files per photo; `relocate` on rescan when `content_key` matches at a new path; `online` = volume mounted && file stat ok); `packages/core/src/import/{scan.ts,pipeline.ts}` (recursive scan → identity → exif → embedded tiers → rows; progress events `phase:"scan"|"import"`; `--copy` copies into `<lib>/originals/<date>/`); `packages/contract/src/verbs/{list,next,rate,flag,label,tag,remove}.ts` with the multi-id shape `data:{summary:{ok,failed},results:[{id,ok,code?}]}` and `code:"partial"` (D10); range filters `--rating ">=4"`; `--stream` NDJSON rows; UUIDv7 ids with unambiguous-prefix resolution (`packages/core/src/ids.ts`); `remove --from-disk --yes` moves to Trash (D34, Mac only, `EnvVolumeResolver` path in Docker just unlinks into a `.trash` dir — the seam is `packages/core/src/files/trash.ts`). XMP read on import (`packages/core/src/xmp/read.ts`: `xmp:Rating`, `xmp:Label`, `dc:subject`, `lr:hierarchicalSubject`, `photoctl:flag` in our namespace since Classic writes no pick flags; sidecar mtime stored in `xmp_state(photo_id, sidecar_path, read_at, sidecar_mtime)` per D20). Migration `0002-cull-and-xmp.ts`.
- **Human can run**:
  ```
  bun run fixtures:drive -- --count 200 --out /tmp/drive     # or the real drive path when it arrives
  photoctl import /tmp/drive --link --recursive                # progress on stderr, A2 envelope
  photoctl import /tmp/drive --link --recursive                # already_present == 200
  photoctl list --rating ">=4" --flag pick --human
  photoctl next --unflagged ; photoctl rate <id…> --stars 5 ; photoctl flag <id> --pick
  wb sheet /tmp/lib --filter 'rating>=4'                        # out/wb/sheet.html: 1616-tier thumbs, stars/flag/label badges, online dot, click → show JSON
  ```
  Mac-only offline rehearsal: `bun run fixtures:volume -- --count 50` builds a sparse image with `hdiutil`, mounts it at `/Volumes/PHOTOCTL-FIX` (real volume UUID); `hdiutil detach` → `photoctl list` shows `online:false`.
- **Verification**: `reimport-idempotent.test.ts` (integration case 4: import twice → `already_present == N`; `mv` one file within the volume → same id, new `locators[0].path`); `offline.test.ts` (integration case 5 via `EnvVolumeResolver` marking the volume unmounted: `list` reports `online:false`, `rate` works, `export` → `file_offline` 69, `show.preview` resolves to the cache); `timezone.test.ts` (rest of case 6: `{date}` in a template — landed in 05 — plus `show.shot` invariant under `TZ=America/Los_Angeles` and `TZ=UTC`); `cull.test.ts` (partial results with one bad id → exit 65 with `results[2].code == "not_found"`); `xmp-read.test.ts` (fixture sidecar rating 4 + keywords land as rows; a second import doesn't overwrite a PGlite edit — D20 "PGlite wins").
- **Delegated**: scan concurrency; `--human` column widths; XML parser choice for XMP (fast-xml-parser vs hand-rolled) — the owner is fixed.
- **Deps**: 01–03.

### 05-export-deliverable — resize/template/collision/IPTC/presets, warn-never-refuse
- **Contract unlocked**: a photographer can deliver: `export` always writes (D28), names files by template, never clobbers without being told, embeds sRGB2014 ICC + IPTC.
- **API seam**: `packages/core/src/export/{template.ts,collision.ts,iptc.ts,run.ts}`: template grammar `{date} {seq:03} {stem} {id8} {rating}` with `{seq}` scoped to the batch, `{date}` = shot-local date (sharp edge); `--on-collision skip|overwrite|rename`; `--resize N` long edge (Lanczos3 via sharp for now — sharp is the encoder owner until the Rust addon owns encode in 10; that swap is named in 10); `--iptc k=v…` written with `sharp().withIptc` or exiv-free XMP-in-JPEG (delegated); export presets in `<lib>/export-presets/<name>.json`; `exports(photo_id, path, at, develop_hash, bytes)` history row; migration `0003-exports.ts`.
- **Human can run**: the A6 command verbatim against `/tmp/drive`; `wb export out/deliver` → `out/wb/export.html` contact sheet of what was written with size/dims/ICC/IPTC readback.
- **Verification**: `export-template.test.ts` (names match `2023-10-02_001_a7c2.jpg` regardless of `TZ`; `rename` yields `_2`); `export-warns.test.ts` (stale/offline states go in `warnings[]`; only `file_offline` for *every* id in the batch is a failure — D28 as data, not prose); `export-iptc.test.ts` (readback of creator/copyright with exifr); `export-resize.test.ts` (2048 long edge → 2048×1365).
- **Delegated**: IPTC writer implementation; JPEG chroma subsampling default.
- **Deps**: 04.
- **Checkpoint**: this is the keyless gold exam minus develop — run `test/gold-exam.test.ts` (integration case 1 with `--preset people` accepted as a no-op until 09) and hand David the folder.

### 06-xmp-write-sync — explicit sidecar writes, divergence detection
- **Contract unlocked**: ratings/flags/labels/tags round-trip to Classic-compatible sidecars, only when asked (D19); external edits are detectable and pullable (D20).
- **API seam**: `packages/core/src/xmp/{write.ts,sync.ts,diff.ts}`; `photoctl xmp write <id…> [--force]` (refuses source folders unless `init --xmp-writable` or `--force`; never touches RAW bytes — enforced by opening the ARW read-only and by a test that hashes it); `photoctl xmp sync --read <id…>`; `list --xmp-stale`; `doctor` counts stale sidecars.
- **Human can run**: write, edit the sidecar in a text editor, `photoctl list --xmp-stale`, `xmp sync --read`; `wb xmp` → diff table PGlite vs sidecar.
- **Verification**: `xmp-roundtrip.test.ts` (rate 4 + tag → write → wipe DB rows → import again → same values; RAW bytes hash unchanged); `xmp-stale.test.ts` (touch sidecar → stale flag; sync → PGlite updated and `read_at` advanced).
- **Delegated**: how hierarchical keywords map to flat tags (pick one and document).
- **Deps**: 04.

### 07-decoder-ciraw — Swift helper, headless, behind the decoder interface
- **Contract unlocked**: a real RAW render exists (Mac only), through the one decoder interface every later slice uses; verified headless (no window server).
- **API seam**: `packages/img/src/decoder.ts`: `interface Decoder { id:"ciraw"|"libraw"; probe(path) → {supported, compression?, notes[]}; decode(path, {scale:1|0.5|0.25, wb:"asShot"|{temp,tint}}) → LinearImage }` where `LinearImage = {w,h, data:Float32Array /*RGB, linear Rec.2020, no tone curve*/, whiteLevel, blackLevel, camXyz:number[9], asShotWb:[r,g,b]}`. Impl `packages/img/src/decoders/ciraw.ts` spawns `helpers/mac/.build/release/photoctl-mac decode --in --out <tmp>.f32 --scale --hint com.sony.arw-raw-image` (raw float buffer + JSON header on stdout). Validity: `supportedDecoderVersions != ["None"]` (gotcha.swift). `photoctl doctor` reports helper presence/version. No AppKit import (headless.swift precedent).
- **Human can run**: `wb decode --decoder ciraw fixtures/a7c2.ARW` → `out/wb/decode-ciraw.html` (sRGB proof render at 1616 px with a simple TRC, plus histogram + timing); `bun run smoke:headless` → runs the same via `ssh localhost` with `DISPLAY` unset and no GUI session → prints render md5 twice (sharp edge "SSH untested").
- **Verification**: host-only `test:mac` project: `decoder-ciraw.test.ts` (decode returns 7008×4672 at scale 1 and 1752×1168 at 0.25; junk file → `supported:false`, not a crash); Docker suite: `decoder-interface.test.ts` runs against a `FixtureDecoder` that replays `fixtures/a7c2.linear.0.25.f32` so the interface contract is pinned on Linux too.
- **Delegated**: Swift package structure; float vs half transfer format.
- **Deps**: 01 (the interface is new; nothing consumes it yet except `wb`).
- **Fog**: SSH/headless is the unknown → the `smoke:headless` script is the spike and gates acceptance.

### 08-decoder-libraw — vendored LibRaw ≥ 0.22 in a `-sys` crate, oracle report
- **Contract unlocked**: a portable decoder (Linux/Docker too), correct A7C II matrix, cross-checked against CIRAW.
- **Sub-slices** (fog: the build is its own variable):
  - **08a build-spike**: `crates/libraw-sys` (vendored LibRaw 0.22.2 source, CDDL, `build.rs` with `cc`/cmake, `--disable-openmp`, `-stdlib=libc++` dynamic, `MACOSX_DEPLOYMENT_TARGET` from a root constant); `cargo test -p libraw-sys` opens a7c2.ARW and asserts `cam_xyz[0] ≈ 0.7460` (the 0.22 value; 0.21's 0.7374 is the A7C mk1 trap). `otool -L` check that no `/opt/homebrew/…libomp` is linked — as a Rust test on mac, skipped elsewhere.
  - **08b addon + oracle**: `crates/photoctl-img` napi addon (`packages/img` JS side, `@photoctl/img-darwin-arm64` + `-darwin-x64` + `-linux-x64-gnu` + `-linux-arm64-gnu` packages) exposing `decodeLibraw(path, scale) → LinearImage` using LibRaw for unpack + metadata + demosaic only (sharp edge: never `dcraw_process` defaults). `packages/img/src/decoders/libraw.ts`. `wb oracle fixtures/a7c2.ARW` → `out/wb/oracle.html`: both renders through the *same* TRC, side-by-side, absolute-diff heatmap, per-channel mean/p99 ΔE-ish stats, highlight-clip count (LibRaw 16383 vs rawler 15360 edge documented in the report legend).
- **Human can run**: `bun run build:rust && wb oracle …`; `bun run test:rust`.
- **Verification**: integration case 8 `decoder-oracle.test.ts` (host-only: mean abs diff over the 1616-tier render < tolerance T stated in the slice file — the contract, not a measure-and-pin; highlights above 0.98 excluded); Docker: `decoder-libraw.test.ts` (dims, matrix, `probe` reports `compression` tag of the fixture); `cargo test` for the sys crate.
- **Delegated**: cmake vs `cc` crate; demosaic algorithm (AHD default).
- **Deps**: 07 (interface).
- **OPEN 5 (lossless-L tag)** lands here: `probe()` prints the compression tag; add L/M/S frames to `fixtures/` when David shoots them; `wb oracle` accepts a folder.

### 09-develop-dict — one dict, tier table, presets, hash (no pixels yet)
- **Contract unlocked**: `develop --set/--unset/--reset/--preset/--copy-from`, `presets list|show|save`, `filter` (two keys) — as pure data with a stable `develop_hash`, visible in `show`, before any rendering exists.
- **API seam**: `packages/core/src/develop/{dict.ts,keys.ts,tiers.ts,hash.ts,presets.ts}`: `DevelopDict` Zod schema with every key from the spec (light/color/bw/wb/curves/levels/definition/selective_color/noise_reduction/sharpen/vignette/crop/rotate/straighten/aspect_ratio/filter{name,strength}); `TIER: Record<Key,"1"|"2">` exactly the A′ table (Tier-1: exposure, brightness, contrast, saturation, vibrance, black_point, white_balance small deltas; Tier-2: curves, levels, highlights, shadows, brilliance, definition, noise_reduction, selective_color, bw.*); `developHash(dict)` = `h_`+sha256(canonical JSON).slice(0,4) — collisions are cosmetic, it's a cache key prefix; the full hash is stored; three shipped presets as JSON data files `presets/{neutral,people,high-contrast}.json` with the session-sample D2/D3 values; user presets in `<lib>/presets/`. `packages/contract/src/verbs/develop.ts` result `{develop_hash, layers:{delta_applied:[],stale:[]}}` (the layer fields are empty until 13 but part of the shape now, so no later shape change).
- **Human can run**: A5's `develop … --preset people --set exposure=0.3` then `show`; `wb develop <id>` → the dict rendered as a keyed table with tier badges and the hash.
- **Verification**: `develop-dict.test.ts` (preset then `--set` order; `--unset`; `--reset`; `--copy-from` copies the whole dict; unknown key → exit 2; hash changes iff canonical dict changes — assert values); `presets.test.ts` (`presets save` writes JSON that `presets show` returns byte-identical).
- **Delegated**: canonicalization details; preset file naming.
- **Deps**: 04.

### 10-develop-render — linear pipeline, preview pyramid, export from develop
- **Contract unlocked**: the render graph gains its develop node: 32-bit float linear Rec.2020 → display transform → 16-bit display-referred (D22); export uses it; previews are cached by `(id, develop_hash, tier)`.
- **Sub-slices** (one visual variable each, per write-spec §10):
  - **10a tone-and-color core** in `crates/photoctl-img/src/develop/`: black/white levels, WB (as-shot / temp+tint offset), cam_xyz → Rec.2020, exposure, contrast (pivot 0.18), black_point, highlights/shadows (luminance-mask based), brightness, saturation, vibrance (Photos' vibrance = SmartColor-style: skin-protected, low-sat-weighted), curves/levels, sRGB piecewise TRC with negative reflection, embed `sRGB2014.icc`. Base curve: camera-neutral (no auto-bright, sharp edge). Judged by `wb presets` (neutral vs people vs high-contrast on a7c2 + 5 fixture frames, crop insets).
  - **10b local ops**: brilliance (local light map, 31×31-style), definition (local contrast), sharpen, vignette, cheap NR (`noise_reduction.{luminance,color}` = NLM in Rust; CIRAW path may use its own NR — D39), B&W keys, filters as prebuilt dicts. Judged by `wb presets --crop 100%`.
  - **10c geometry**: crop/rotate/straighten/aspect applied last; `auto_straighten` via Vision horizon in `photoctl-mac horizon` (host-only), `crop --auto`; retouch is NOT here (18).
- **API seam**: `packages/core/src/render/graph.ts` gets `source:"develop"` (decoder → develop → display) with `tier: "emb"|"1616"|"full"`; `packages/core/src/cache/tiers.ts` gets `dev/<id>/<develop_hash>.<tier>.tif16`; the Rust addon takes over JPEG/TIFF/PNG encode + ICC (`encode(image16, {format,quality,icc})`) and sharp is removed from `packages/core/src/export` in this slice (named removal of the 05 encoder). `renderForExport` picks `develop` when online, else embedded with `warnings:[{code:"offline_preview"}]` (D28).
- **Human can run**: `photoctl develop <id> --preset people && photoctl export <id> --to out/`; `wb presets /tmp/lib --ids <3 ids>` → `out/wb/presets.html` (grid: preset × image, hover A/B against neutral, per-preset histogram); `wb ab <id> --set exposure=0.5` (before/after slider).
- **Verification**: `develop-render.test.ts` (neutral export of the fixture through the LibRaw path: dims 7008×4672, ICC present, mean luminance within a band of the CIRAW-neutral render — the oracle tolerance; `--set exposure=1` doubles linear mean within 5 %); `render-cache.test.ts` (second export with same hash reads the cache: assert no decoder event on stderr); `gold-exam.test.ts` now runs for real (integration case 1 with people preset); Rust unit tests for each operator on synthetic ramps (`cargo test -p photoctl-img develop::`).
- **Screenshot gate**: `wb presets` output goes through `/screenshot-critique`; `/compare-screenshots` against the 07 CIRAW render as the reference for 10a only (variable: global tone/colour; crops: skin patch, sky, shadow corner). Local ops (10b) compare candidate-vs-neutral, not vs CIRAW.
- **Delegated**: exact curve shapes and constants (data; David's taste corrects them), NLM parameters.
- **Deps**: 08, 09.

### 11-provider-harness — gateway × model adapters with a replayable stub
- **Contract unlocked**: the two-level provider interface (D26) exists with a stub gateway that replays canned responses, so every generative verb is playable before a key exists; `provider_unconfigured` is the keyless behaviour; `doctor` verifies model IDs resolve.
- **API seam**: `packages/providers/src/gateway.ts`: `interface Gateway { id:"vercel"|"stub"; imageEdit(req:ImageEditReq) → ImageResult; imageGenerate(req) → ImageResult; structured<T>(req, schema:ZodType<T>) → T /*generateObject, D29*/; embed(req:EmbedReq) → {vectors:Float32Array[], model, tokens} }`. `packages/providers/src/model.ts`: `interface ImageModelAdapter { id; mask:"native"|"instruction+composite"; buildEdit(op:"remove"|"prompt"|"outpaint"|"reimagine"|"relight", crop:Png, mask:Png|null, prompt, seed) → GatewayReq; normalize(res, sentDims) → {png, resampled:boolean, warnings[]} /*D27*/ }`. `packages/providers/src/table.ts`: hard-coded per-verb defaults (fill/outpaint/reimagine/generate → `openai/gpt-image-2`; grounding/auto_enhance → `google/gemini-3.1-flash`; embeddings → `google/gemini-embedding-2`), overridable from `<lib>/config.json` `providers.models.<verb>`; `--model` per call. `gateways/vercel.ts` (AI SDK `ai@7` + `@ai-sdk/gateway`; key from `AI_GATEWAY_API_KEY`), `gateways/stub.ts` (`PHOTOCTL_GATEWAY=stub`, reads `packages/providers/fixtures/<model>/<op>.json` → returns the PNG at the *sent* dims, or a deliberately mismatched dims fixture to exercise D27). `models/{gpt-image-2,gemini-image,grok-image,gemini-vlm,gemini-embed}.ts`. stderr event `{"event":"provider",gateway,model,op,mask,sent_px,format}` (B3). Cost table (data file) for `cost_usd` in results (D33 needs it in 12).
- **Human can run**: `PHOTOCTL_GATEWAY=stub photoctl generate --prompt "x" --size 1024x1024` (writes a canned PNG, imports it tagged `generated`); `photoctl generate …` with no key → `provider_unconfigured` exit 69; `photoctl doctor` (with key) lists resolved model IDs; `wb providers` → `out/wb/providers.html` (every adapter × every fixture: request the adapter built, mask mode, dims sent/returned/resampled).
- **Verification**: `provider-unconfigured.test.ts` (every generative verb → 69 with the code; gold exam untouched); `provider-stub.test.ts` (generate through the stub writes a file and imports it with tag `generated`; a dims-mismatch fixture → `normalize().resampled == true` observed in the envelope); `model-table.test.ts` (config override wins; `--model` wins over config).
- **Delegated**: AI SDK vs raw fetch for `/v1/images/edits`; retry policy.
- **Deps**: 04 (import for `generate`), 01.
- **OPEN 2 (key + model IDs)** lands here: `doctor` is the check; `config.json` is the placeholder location.

### 12-embed-and-search — worker in the daemon, halfvec(3072), RRF
- **Contract unlocked**: `photoctl search <query>` returns hybrid hits (tsvector + vector, RRF k=60), embeddings run in the daemon after import, cost is stated, keyless libraries still get full-text search.
- **Pre-spike (must precede the worker)**: `bun run spike:toast` — 5 000 rows × 20 UPSERT cycles on `halfvec(3072)` under 0.5.8, checking for `missing chunk number 0` (OPEN 6, `migrations.ts:356-360`). Result recorded in the slice file; if it reproduces, the worker writes with DELETE+INSERT instead of UPSERT and the test pins that.
- **API seam**: migration `0004-embeddings.ts`: `embeddings(photo_id pk, model text, vec halfvec(3072), created_at)` + HNSW cosine (D31); `photos.caption text`, GIN on `to_tsvector('english', coalesce(caption,'')||' '||filename||' '||folder||' '||tags)`. `packages/core/src/embed/worker.ts` (port of `embedding-worker.ts` shape: batch 50, cooldown, injectable sleeps, yield/ceiling derived *together* from the 02 poll constants — the sharp edge at `embedding-worker.ts:52-58`), registered via `daemon.registerBackground("embed", …)`; consent `init --embed auto|manual` (D33), `photoctl embed [--all|<id…>]`, import result `embeddings:{queued, est_usd}`. `packages/core/src/search/{rrf.ts,query.ts}`: `reciprocalRankFusion(lists, k=60)` (lift `recall.ts:391` minus the kind/priority prior), `search(query, {limit, stream})`. Stub embedder = `gateways/stub.ts` returning deterministic vectors from `sha256(text)` so search is playable keyless.
- **Human can run**: `PHOTOCTL_GATEWAY=stub photoctl init --embed auto … import … search "wedding ceremony" --human`; `wb search /tmp/lib "query"` → both rank lists and the fused list side by side with scores; `bun run smoke:embed-shape` (with key) → posts a text+image request and prints the response shape (OPEN 4).
- **Verification**: port of `lock-starvation.test.ts` as `embed-starvation.test.ts` (worker draining 500 rows; a real `photoctl rate` process gets the lock within budget — budgets in Node terms); `search-hybrid.test.ts` (with the stub: a caption-only match and a vector-only match both appear; RRF order asserted by *ids*); `embed-consent.test.ts` (manual mode queues nothing; est_usd computed from the cost table); unit `rrf.test.ts`.
- **Delegated**: caption source (filename+folder+tags now; VLM captions are a later verb); batch size.
- **Deps**: 02, 04, 11.

### 13-layers-and-composite — layer model, transforms, vacancy, flatten (no SAM, no gateway)
- **Contract unlocked**: real layer rows with masks and full editor transforms, composited in display-referred 16-bit above develop; `fill --move` and the magenta vacancy; export flattens; strict-composite primitive exists and is bit-exact.
- **API seam**: migration `0005-layers.ts`: `layers(id, photo_id, z int, name, state 'selected'|'moved'|'filled'|'stale', role 'subject'|'vacancy', of_layer, mask_path, pixels_path, develop_hash, transform jsonb, opacity, blend, created_at)`. `packages/core/src/layers/{model.ts,transform.ts,ops.ts}`: `Transform = {dx,dy,scale,rotate,flip:null|"h"|"v",anchor:"centroid"|[x,y]}`, absolute by default, `--relative`, S→R→T about anchor (D13), coords in the oriented uncropped base (`packages/core/src/geometry/space.ts` owns `toBase/fromBase` for orientation, crop, `--norm`). `crates/photoctl-img/src/{mask.rs,composite.rs}`: `dilate/erode/feather(mask, px)`, `resample(layer, transform, "lanczos3"|"bilinear")` with exact quarter-turns/flips (D12), `overlay(base16, layer16, mask, blend, opacity)`, `lift(base16, mask) → pixels`. Verbs: `segment --brush '[[x,y],…]' | --box x,y,w,h` (polygon/box masks — local geometry, no SAM yet), `layer list|transform|reorder|set|duplicate|remove|clear`, `fill --move --to|--by` (D11: emits vacancy layer with the full silhouette mask, D15; renders magenta placeholder, D16). Render graph gains the composite node; A′ hooks: `develop` computes `delta_applied` (Tier-1: re-apply the key delta to pinned layer pixels in display space) vs `stale` (Tier-2) and `show.layers{count,stale}` becomes real.
- **Human can run**: `segment <id> --box 2210,940,1380,3120 && fill <id> --layer 1 --move --by 1200,0 && layer list <id> --human && export <id> --to out/` (magenta hole visible — the placeholder that proves the mask is asymmetric, per refactor-clean's symmetric-placeholder rule); `wb layers <id>` → `out/wb/layers.html` (base, each mask as overlay, transformed layer outline, composite, and a `|composite − base|` heatmap outside the union of masks that must be all-zero).
- **Verification**: `strict-composite.test.ts` (integration case 7 half: overlay with a stub layer → every pixel outside the mask equals the pre-composite render byte-for-byte, asserted on the 16-bit TIFF export; falsify by feathering the mask); `layer-transform.test.ts` (absolute vs `--relative` idempotence: same command twice → same transform; flip+rotate 90 of a 2×3 fixture yields exact expected pixels); `vacancy.test.ts` (move emits layer 2 role vacancy with `mask_px` equal to layer 1's; export writes with `warnings:[{code:"vacancy_unfilled"}]` — D28 supersedes the sample's B2/B4 refusals); `tier-delta.test.ts` (`--set exposure=0.5` → `delta_applied:[1,2]`; `--set shadows=40` → `stale:[1,2]`).
- **Delegated**: mask storage format (PNG8 vs raw), pixel pin format (TIFF16 in cache).
- **Deps**: 10.

### 14-segment-sam2 — SAM 2.1 via ort on CPU, `--at`, `--text` through Gemini structured output
- **Sub-slices** (fog: model sourcing + ONNX I/O is one variable, the verb is another):
  - **14a model spike**: `crates/photoctl-img/src/sam2.rs` loads `sam2.1_hiera_small` encoder/decoder ONNX (Apache-2.0 weights; opt-in download by `photoctl doctor --fetch-models` with license shown; cached under the cache root `models/`), preprocessing per the darktable-ai reference (`scratchpad/ai_tasks.md:40-96`: longest side 1024, pad, ImageNet norm, CHW; decoder inputs `point_coords [1,N+1,2]`, `point_labels`, `mask_input [1,1,256,256]`, `has_mask_input`; pick highest `iou_predictions`, crop pad, resize, sigmoid). `cargo run --example sam2 -- fixtures/a7c2.1616.jpg 900,600` → `out/wb/sam2-mask.png`. CPU EP only (D40).
  - **14b verb**: `segment <id> --at x,y [--at …] [--box] [--dry-run]` → layers (D8); `--text "…"` → `gateway.structured()` with Zod `{instances:[{box_2d:[ymin,xmin,ymax,xmax], label}]}` (0–1000 normalized, origin top-left; converted in `models/gemini-vlm.ts`, never leaked) → SAM box prompt per instance, one layer each; stub fixture for `--text` so it's playable keyless. Encoder embedding cached per `(id, tier)` in the daemon (D40: daemon owns the compiled-model cache).
- **Human can run**: `photoctl segment <id> --at 2900,2500 --dry-run` (B1 shape), then without `--dry-run`; `wb masks <id>` (mask overlays + IoU per candidate, click-to-refine points listed).
- **Verification**: `segment-at.test.ts` (on the 1616-tier fixture, a click on the subject yields a mask whose bbox contains the click and whose area is within a band stated in the slice file — a distribution over 3 click points, not one sample); `segment-text-stub.test.ts` (canned Gemini boxes → N layers, `bbox` in base coords, `--dry-run` creates zero rows — assert row values); `cargo test -p photoctl-img sam2::` (preprocess shapes; decoder output shapes).
- **Delegated**: hiera size (small vs base+), embedding cache eviction.
- **Deps**: 11, 13.

### 15-fill-pipeline — `--fit strict|expand|free`, `--full-res --pad`, `--remove|--prompt|--outpaint|--refresh`
- **Contract unlocked**: the one fill pipeline (mask → crop → provider → composite) above the adapters, with strict bit-exactness asserted by the composite, never by the model (D27); playable end-to-end against the stub before a key.
- **Pre-gate**: `bun run smoke:mask-polarity` (OPEN 3, first thing run with a key): sends a two-tone 512² PNG + a left-half mask through each image model adapter and reports which half changed; the answer is written into each adapter's `maskPolarity` constant and a canned fixture is added to the stub so the test suite pins it.
- **API seam**: `packages/core/src/fill/{pipeline.ts,fit.ts,crop.ts,prompts.ts}`: `fit.ts` builds the diffusion mask (`strict` = hard, `expand=N` dilate N default 24, `free` = feathered); `crop.ts` computes the `--full-res` crop + `--pad` ring in base coords; `prompts.ts` holds C1 (remove) / C2 (outpaint) as data; `pipeline.ts`: mask → crop → `adapter.buildEdit` → `gateway.imageEdit` → `adapter.normalize` (D27: under `strict`, `resampled:true` → `provider_dims_mismatch` exit 65 with the B3 hint; under expand/free → Lanczos3 resample) → `composite.overlay` → pins pixels + `develop_hash`; provider `warnings[]` containing "whole image" → hard failure under strict (landmine card). `--init original|fill|noise|empty`, `--strength` (= feather + guidance; documented not-A1111-denoise), `--seed`. `fill --refresh --layer L` regenerates stale layers (A′). `--outpaint --aspect|--px` pads locally and masks the pad (C2). Results carry `composite:{unmasked_bit_exact, returned_px, resampled}` and `provider:{gateway, model, seed, warnings, cost_usd, ms}`.
- **Human can run**: `PHOTOCTL_GATEWAY=stub` B3/B4 commands verbatim; `wb fill <id> --layer 2` → `out/wb/fill.html` (what was sent: crop, mask, prompt; what came back; composite; the outside-mask diff heatmap that must be black). With a key: the same commands for real, then `/screenshot-critique` on the composite.
- **Verification**: `fill-strict.test.ts` (integration case 7 in full, over the stub with three adapter fixtures incl. the dims-mismatch one: every pixel outside the mask equals the pre-fill render bit-for-bit — read both 16-bit TIFF exports and compare buffers; falsify by switching to `--fit free`); `fill-remove-vs-prompt-defaults.test.ts` (remove → strict, replace → expand=24 — assert the `fit` field); `fill-refresh.test.ts` (stale after Tier-2 → refresh → state filled, `develop_hash` updated); `person-move.test.ts` (integration case 2 end-to-end over the stub, export succeeds with `warnings[]`).
- **Delegated**: feather kernel; crop rounding to model-friendly multiples (must be reported in `sent_px`).
- **Deps**: 13, 14 (for `--text` in the flow test; `--box` suffices otherwise), 11.

### 16-generative-extras — `reimagine`, `relight`, `auto_enhance`, `generate --ref`
- **Contract unlocked**: the remaining two-bucket generation verbs as prompt templates over the same pipeline/adapters; `auto_enhance` proposes develop keys via structured output (C4) and is inspectable/undoable.
- **API seam**: `packages/core/src/fill/prompts.ts` gains C3 (relight) and the reimagine template; `reimagine`/`relight` run through `pipeline.ts` with `scope:"full-frame"` (no mask) and result `drift:"full-frame"`; `develop --auto-enhance` → `gateway.structured()` with the C4 Zod schema over the 1024 preview + measured stats (`packages/core/src/develop/stats.ts`: p02/p50/p98/clipped/mean_sat/est_wb_k) → ordinary develop keys; `generate --ref <path> --strength`.
- **Human can run**: all four over the stub; `wb enhance <id>` (stats + proposed keys + before/after).
- **Verification**: `reimagine-full-frame.test.ts` (result carries `drift:"full-frame"` and a new layer? no — reimagine replaces the base pixel pin: assert it lands as a `role:"reimagine"` layer covering the frame so `develop --reset` still recovers the original); `auto-enhance.test.ts` (stub structured output → keys land in the dict; out-of-range values are clamped — assert values); `relight-template.test.ts` (placeholders filled exactly).
- **Delegated**: whether reimagine is a full-frame layer or a base swap — no: resolved above as a layer (keeps "never overwrite" invariant); the delegated bit is naming.
- **Deps**: 15.

### 17-markup — vector overlay JSON, flatten on export
- **API seam**: migration `0006-markup.ts` `markup(photo_id, items jsonb)`; `packages/core/src/markup/{model.ts,flatten.ts}` (primitives text/arrow/line/rect/ellipse/path/highlight in base coords; flatten = rasterize via the Rust addon's `draw` into the composite node before encode); verbs `markup list|add|update|remove|clear`.
- **Human can run**: add an arrow + text, export, `wb markup <id>`.
- **Verification**: `markup-flatten.test.ts` (an opaque red rect at known coords → exported pixels there are red; nothing else changed vs the no-markup export — assert both).
- **Deps**: 13.

### 18-retouch — non-generative heal brush
- **API seam**: `retouch <id> --at x,y [--radius n]` → `crates/photoctl-img/src/heal.rs` (PatchMatch/Telea-style inpaint from surrounding pixels, local bucket) producing a `role:"retouch"` layer with a circular mask so it composes with everything else and stays non-destructive.
- **Human can run**: retouch a dust spot on the fixture; `wb layers` shows it.
- **Verification**: `retouch.test.ts` (outside the radius bit-exact; inside differs from the original; a second identical call is idempotent — one layer, not two).
- **Deps**: 13.

### 19-mcp (optional, post-gold-exam)
- `apps/photoctl-mcp` exposing the same verbs by calling the same `packages/core` functions; no new behaviour. Firewalled until 01–16 ship.

---

## 2. Package/app/crate boundaries, layout, root scripts, Docker seam

**Choice — Bun as package manager + task runner, Node 24 as the only runtime.** Justification: the `duet` precedent gives us `workspaces.catalog`, `bunfig linker=hoisted`, turbo, oxlint/oxfmt for free; but PGlite's Node fs backend, napi loading, `process.kill(pid,0)` semantics, and spawn timing are what production sees, so every `bin`, every test, and every spawned worker runs under `node` (vitest's shebang is node; harness spawns `node apps/photoctl/dist/cli.js`). `bun` never executes project code. This also satisfies D38's "spawned workers target built JS".

```
photoctl/
  package.json            # bun workspaces apps/* packages/*, catalog, root scripts (below)
  bunfig.toml             # [install] linker = "hoisted"
  turbo.json              # build/check-types/lint/test (test dependsOn ^build), as duet
  .oxlintrc.json .oxfmtrc.json  # lifted from ~/dev/duet
  Cargo.toml              # [workspace] members = ["crates/libraw-sys", "crates/photoctl-img"]
  Dockerfile.test         # node:24-bookworm + rustup stable + cmake + clang + bun (install only)
  scripts/test-in-docker.sh  scripts/setup-docker.sh
  fixtures/a7c2.ARW (gitignored) + fixtures/a7c2.json (measured facts: content_key, embedded tiers, shot)
  specs/photoctl/…
  apps/
    photoctl/             # bin "photoctl": argv → verbs → envelope. No domain logic.
    workbench/            # bin "wb" (dev-only, private): HTML reports into out/wb/
    photoctl-mcp/         # slice 19 only
  packages/
    contract/             # envelope, codes, exit codes, stderr events, per-verb Zod data shapes
    db/                   # openLibrary, lock, migrations/NNNN-*.ts, daemon/{server,client,socket-path,spawn}, backup (pgDump)
    core/                 # files/{identity,locator,volumes,embedded,trash}, exif, xmp, import, export, cache, geometry/space, develop, render/graph, layers, fill, search, embed, markup, ids
    providers/            # gateway.ts, model.ts, table.ts, gateways/{vercel,stub}, models/*, fixtures/<model>/<op>.json
    img/                  # decoder.ts interface; decoders/{ciraw,libraw,fixture}; napi loader; npm/ per-platform packages
    fixtures/             # harness.ts, make-drive.mjs, make-volume.sh, libraries/v000N/*.sql, canned linear renders
  crates/
    libraw-sys/           # vendored LibRaw 0.22.2 (CDDL), build.rs (--disable-openmp)
    photoctl-img/         # napi-rs addon: decode, develop ops, mask, composite, resample, encode+ICC, sam2 (ort), heal, draw
  helpers/mac/            # Swift package "photoctl-mac": decode (CIRAWFilter), horizon (Vision). No AppKit.
```

Root `package.json` scripts:
```
"setup":        "bun install && cargo fetch && bash scripts/setup-docker.sh",
"build":        "turbo build",                       # tsc per package + napi build (packages/img) + swift build (helpers/mac, mac only)
"build:ts":     "turbo build --filter='!@photoctl/img'",
"build:rust":   "bun run --cwd packages/img build",  # napi build --release --platform
"build:mac":    "swift build -c release --package-path helpers/mac",
"typecheck":    "turbo check-types",
"lint":         "turbo lint && cargo clippy --workspace -- -D warnings",
"fmt":          "oxfmt --write --no-error-on-unmatched-pattern && cargo fmt --all",
"fmt:check":    "oxfmt --check --no-error-on-unmatched-pattern && cargo fmt --all -- --check",
"test":         "bash scripts/test-in-docker.sh",    # THE gate: PHOTOCTL_TEST_IN_DOCKER=1, vitest, workers spawn node dist/
"test:host":    "PHOTOCTL_TEST_IN_DOCKER=1 vitest run",   # same tests on the host, for the loop; not a substitute for `test`
"test:one":     "PHOTOCTL_TEST_IN_DOCKER=1 vitest run",   # + args: the narrowest runner (write-tests)
"test:rust":    "cargo test --workspace",
"test:mac":     "PHOTOCTL_TEST_MAC=1 vitest run --project mac",  # CIRAW helper + oracle + hdiutil volume; host only
"verify":       "bun run fmt:check && bun run lint && bun run typecheck && bun run test:rust && bun run test && bun run test:mac",
"wb":           "node apps/workbench/dist/cli.js",
"fixtures:drive": "node packages/fixtures/make-drive.mjs",
"fixtures:volume": "bash packages/fixtures/make-volume.sh",
"probe:race":   "node packages/fixtures/probe-race.mjs",
"spike:toast":  "node packages/fixtures/spike-toast.mjs",
"smoke:headless": "bash helpers/mac/smoke-headless.sh",
"smoke:mask-polarity": "node packages/providers/smoke/mask-polarity.mjs",
"smoke:embed-shape":   "node packages/providers/smoke/embed-shape.mjs"
```

Docker seam (`scripts/test-in-docker.sh`, shape of `duet-agent/package.json` `test`): `docker build -f Dockerfile.test -t photoctl-test . && docker run --rm -v "$PWD:/src:ro" -w /work -e HOME=/tmp/home -e PHOTOCTL_TEST_IN_DOCKER=1 -e AI_GATEWAY_API_KEY photoctl-test sh -lc 'cp -R /src/. /work && bun install --frozen-lockfile && bun run build:ts && bun run build:rust && vitest run'`. Real dataDirs under `/tmp/home`; the fixture ARW rides in via the read-only mount. Vitest workspace has two projects: `docker` (default, gated by `PHOTOCTL_TEST_IN_DOCKER`) and `mac` (gated by `PHOTOCTL_TEST_MAC`, never run in Docker). CI: `verify` on a macOS runner (both projects) and `test` on Linux.

---

## 3. API seams with exactly one owner

| Concept | Owner (file) | Introduced | Later slices only *extend* |
|---|---|---|---|
| JSON envelope, codes, exit codes, stderr events | `packages/contract/src/{envelope,events}.ts` | 01 | every verb adds a `verbs/*.ts` data schema; nobody re-declares `ok/code` |
| Verb I/O shapes | `packages/contract/src/verbs/*.ts` | 01 | — |
| Library handle (`query`), lock, migrations, daemon protocol, backups | `packages/db` | 01 (open/lock/migrations), 02 (daemon), 03 (backup) | same `LibraryHandle` over direct PGlite and over the socket — one interface, two transports |
| Identity + locator + volume + online state | `packages/core/src/files/*` | 01 | 04 adds relocation/offline; no second "path" concept anywhere (IDs are UUIDs, paths live only in `files`) |
| Coordinate space (oriented, uncropped base; `--norm`; crop last) | `packages/core/src/geometry/space.ts` | 01 (`show.dims`) | 13 transforms, 14 box→base, 17 markup all call it; adapters convert *into* it (Gemini `box_2d`, Vision lower-left) and never leak their frames |
| Preview cache tiers + prune | `packages/core/src/cache/tiers.ts` | 01 | 03 prune, 10 dev tiers, 14 model cache |
| Render graph | `packages/core/src/render/graph.ts` | 01 (embedded node) | 10 develop node, 13 composite node, 17 draw node. The embedded source is a permanent fallback (D23/D28), not scaffolding |
| Decoder interface | `packages/img/src/decoder.ts` | 07 | 08 adds `libraw`; the fixture decoder is the Docker seam, permanent |
| Develop dict + tier table + presets + hash | `packages/core/src/develop/*` | 09 | 10 renders it; 16 `auto_enhance` writes into it; XMP never carries it |
| Provider interface (gateway × model), model table | `packages/providers` | 11 | 12 embed, 14 VLM grounding, 15/16 image ops. Strict composite lives *above* it in `core/fill` — adapters never composite |
| Layer model + transforms + vacancy | `packages/core/src/layers/*` | 13 | 14 creates layers, 15 fills them, 16 reimagine/18 retouch are layers with roles; `segment` creates nothing but layers (D8) |
| Fill pipeline + prompts | `packages/core/src/fill/*` | 15 | 16 adds templates only |
| Search (RRF) + embed worker | `packages/core/src/{search,embed}` | 12 | — |
| XMP read/write/sync | `packages/core/src/xmp/*` | 04 (read) | 06 (write/sync) |
| Pixel hot path (masks, composite, resample, encode, SAM, heal, draw) | `crates/photoctl-img` via `packages/img` | 08 | 10, 13, 14, 17, 18 add modules, never a second encoder |

Transitional scaffolding, each with its removal slice:
1. **sharp as the export encoder** (05) → replaced by the addon's `encode` in **10**; `sharp` leaves `packages/core` dependencies in 10.
2. **`--preset` accepted as a no-op** in 05's gold-exam run → becomes real in **09/10**; the test's expectation flips in 10.
3. **Empty `layers:{delta_applied:[],stale:[]}`** in 09's develop result → filled in **13** (shape never changes, so this is not really scaffolding — listed for honesty).
Nothing else is temporary: the stub gateway, `EnvVolumeResolver`, and `FixtureDecoder` are the permanent edge mocks write-tests asks for.

Envelope resolution stated once: the session sample shows `summary`/`results` and error details at the top level; D10 fixes the four-key envelope, so v1 nests them: `{schema:1, ok:false, code:"partial", data:{summary:{ok:2,failed:1}, results:[…]}}` and `{schema:1, ok:false, code:"library_locked", data:{holder_pid, waited_ms}}`, with `warnings?:[]` as the single D28 addition. `wb envelope` renders this so the human reacts to it in slice 01, when it's cheapest to change.

---

## 4. Playable deliverables per slice

| Slice | Runnable after it lands |
|---|---|
| 01 | `photoctl init/import/show/export/doctor`; `out/a7c2.jpg`; `wb envelope` |
| 02 | `photoctl daemon status`; `bun run probe:race`; `wb race` |
| 03 | `photoctl restore/migrate/cache prune`; `wb library`; upgrade of `libraries/v0001` |
| 04 | `fixtures:drive` + `fixtures:volume`; `list/next/rate/flag/label/tag/remove --stream/--human`; `wb sheet` (the contact sheet becomes the standing asset workbench: drop files in, re-import, re-render) |
| 05 | A6 export with template/IPTC/resize; `wb export`; keyless gold-exam dry run |
| 06 | `xmp write/sync`, `list --xmp-stale`; `wb xmp` |
| 07 | `photoctl-mac decode`; `wb decode --decoder ciraw`; `smoke:headless` |
| 08 | `cargo test -p libraw-sys` matrix check; `wb oracle` diff report |
| 09 | `develop --set/--preset/--copy-from`, `presets`, `filter`; `wb develop` |
| 10 | real develop export; `wb presets`, `wb ab`; gold exam for real |
| 11 | `generate` over the stub; `provider_unconfigured` keyless; `doctor` model IDs; `wb providers` |
| 12 | `search` (stub or real embeddings); `wb search`; `spike:toast`; `smoke:embed-shape` |
| 13 | `segment --box/--brush`, `layer *`, `fill --move`, magenta vacancy in export; `wb layers` |
| 14 | `segment --at/--text/--dry-run`; `cargo run --example sam2`; `wb masks` |
| 15 | B3/B4 flows over stub then key; `smoke:mask-polarity`; `wb fill` |
| 16 | `reimagine/relight/auto-enhance/generate --ref`; `wb enhance` |
| 17 | `markup *` + flattened export; `wb markup` |
| 18 | `retouch`; `wb layers` shows the heal layer |

---

## 5. Risks / fog → sub-slices and spikes

1. **LibRaw vendoring build (08)** — three variables (cmake/cc, OpenMP/libc++ linking, matrix correctness). Split as 08a (build-only spike with the `cam_xyz ≈ 0.7460` test and an `otool -L` guard) before 08b. Docker adds a fourth (Linux build) — 08a must pass in `Dockerfile.test` too.
2. **Swift helper headless under SSH (07)** — unknown per the map. `smoke:headless` is the spike; if the software renderer is needed and is a no-op on Apple Silicon (sharp edge), the fallback is documented: CIRAW becomes "oracle only, GUI session" and LibRaw is the runtime decoder. Decide on the spike's evidence.
3. **PGlite TOAST on halfvec (12)** — `spike:toast` precedes the worker; outcome fixes the write strategy in the slice file.
4. **Smoke test 1 mask polarity (15)** and **smoke test 2 embedding shape (12)** — scripted, one-command, with-key; each writes its finding into an adapter constant *and* a stub fixture so the suite pins it afterwards.
5. **SAM 2.1 sourcing + ONNX I/O (14)** — 14a `cargo run --example sam2` before any verb; the darktable-ai tensor table is the reference; CoreML EP explicitly off (D40: SAM 2 can't partition).
6. **Develop colour math (10)** — three visual variables → 10a/10b/10c with one judged variable each; CIRAW render is the compare-screenshots reference for 10a only. Photos' Vibrance/Brilliance are architectures, not curves (sharp edge) — expect a second pass on constants after David's taste feedback; they are data files.
7. **Tier-1 delta-apply on pinned layers (13/15)** — the map calls the table a proposal. The `tier-delta.test.ts` pins behaviour, not the table; moving a key between tiers is a one-line data change.
8. **Daemon lifecycle (02)** — idle-exit, unmount, respawn-once: each has its own test; the socket-path length limit is asserted with a 200-char library path.
9. **Node vs Bun timing (02/12)** — every lock/poll/yield constant is injectable via env; the harness measures Node cold-start once per run and derives budgets, so the suite doesn't inherit `PEER_LOCK_BUDGET_MS = 4_000`.
10. **Gateway output re-encode/dims (15)** — request `png`, assert dims in `normalize()`, treat provider "whole image" warnings as strict failures; a canned mismatch fixture keeps this path exercised keyless.

---

## 6. Human review checkpoints (all non-blocking: open evidence with `/preview-shots`, ~5 min, decide on evidence if silent, record the call in the slice file, close windows)

| After | Evidence opened | Question for David |
|---|---|---|
| 01 | `out/a7c2.jpg`, `wb envelope` | Is the envelope/exit-code shape what agents want? (cheapest moment to change) |
| 02 | `wb race` | Is 8 the right daemon capacity default; loud-refusal wording OK? |
| 04 | `wb sheet` on `/tmp/drive` (or the real drive) + `list --human` | Column set, badges, `next` semantics |
| 05 | Delivered folder + `wb export` | Template default `{date}_{seq:03}_{stem}`, IPTC field set |
| 08 | `wb oracle` | Accept the oracle tolerance and which decoder is the runtime default |
| 10 | `wb presets` (+ screenshot-critique, compare-screenshots vs CIRAW) | Taste: people / high-contrast constants |
| 13 | `wb layers` with the magenta vacancy | Placeholder legibility, transform defaults |
| 15 | `wb fill` after the with-key smoke test | Strict/expand defaults, per-model quality |
| 16 | reimagine/relight outputs | Is "drift: full-frame" clear enough in the envelope? |

---

## 7. Scope firewalls (per slice: what v1 does not touch there)

- 01: no daemon, no XMP, no develop, no Rust, no Swift, no resize; single-file/non-recursive import is fine.
- 02: no background work besides the socket; no MCP; no auto-restart from `doctor`.
- 03: no directory clones (D37); no auto-quarantine; no compat with older schema shapes (hard cutover).
- 04: no XMP *write*; no develop; no Lightroom catalog (.lrcat) parsing — sidecars only; no Photos.app library.
- 05: no develop render (identity path only); no watermarking; no cloud delivery.
- 06: no embedded-XMP writes; no develop history in XMP (D19, spec non-goal).
- 07: Mac-only helper; no AppKit; no lens correction, no Apple NR here (D39 decides in 10).
- 08: no rawler/rawloader/darktable/ART code (LGPL/GPL wall); no dcraw_process defaults; no learned NR.
- 09: no pixels; no Camera Matching, no local HSL (spec non-goals).
- 10: no CoreML/ONNX for develop; NAFNet stays deferred (D39); no `unblur` (D35).
- 11: Vercel only (D25); no OpenRouter adapter (the compat layer is the interface, not a second gateway); no capability-field reads; no photoctl.cloud.
- 12: gemini-embedding-2 only; embeddings never in XMP; no free-tier fallbacks (sharp edge).
- 13: no SAM, no gateway; no Best Take/Add Me; no blend modes beyond normal/multiply/screen (declared in display space, D22).
- 14: no SAM 3 (license), no macOS 27 Vision API; CPU EP only.
- 15: no A1111/Comfy calls; `--strength` is feather+guidance, not denoise; no feature-specific inpaint models.
- 16: no local generative runners; relight is a prompt template with documented drift.
- 17/18: no red-eye, no portrait fakes.
- 19: MCP adds no verb the CLI lacks.

---

## 8. Where the OPEN items land

| OPEN | Consumed by | Placeholder until resolved |
|---|---|---|
| ARW drive path | 04 (import at scale); gold-exam rerun in 05 and 10 | `fixtures:drive` (N padded copies of a7c2.ARW + synthetic sidecars) and `fixtures:volume` (hdiutil image with a real UUID for the offline case); Docker uses `EnvVolumeResolver` |
| Gateway key + per-verb model IDs | 11 (`doctor`, `config.json` `providers.models`, `AI_GATEWAY_API_KEY`) | `PHOTOCTL_GATEWAY=stub` replaying `packages/providers/fixtures/`; the proposed defaults are the hard-coded table |
| Smoke test 1 (mask polarity) | 15 pre-gate `smoke:mask-polarity` | adapters ship with `maskPolarity:"unknown"` → strict fill refuses with `provider_unverified` until the smoke result is committed; stub fixture is polarity-agnostic |
| Smoke test 2 (multimodal embedding shape) | 12 `smoke:embed-shape` | stub embedder (deterministic vectors from text); real adapter starts text-only (filename+folder+tags+caption) and gains the image part when the shape is known |
| Lossless-L compression tag | 08 (`probe()` reports the tag; `wb oracle` over a folder) | a7c2.ARW (uncompressed) only; add L/M/S frames to `fixtures/` when shot; M/S WB-pre-applied edge is a `probe()` note |
| PGlite TOAST repro | 12 `spike:toast` before the worker | none needed; the spike decides UPSERT vs DELETE+INSERT |
| Founder checklist timing | not a slice; 04/06 read whatever sidecars arrive | README "Next Agent Prompt" carries the reminder; nothing in code depends on it |