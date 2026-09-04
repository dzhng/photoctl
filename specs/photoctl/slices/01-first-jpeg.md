# 01 — init → import a7c2.ARW --link → show → export the embedded full-size JPEG

## Contract unlocked
Keyless, no Rust, no Swift, no drive: a library is created, one ARW is linked, its metadata is
readable, and the camera's embedded 7008×4672 JPEG is written to disk. The lock, migrations v1,
identity, locators, timezone rule, cache tiers, render graph (1 node) and coordinate space are all
born here as their end-state owners.

## API seam
- `packages/library/src/open.ts`: `openLibrary(path, {noDaemon, lockBudgetMs}) → LibraryHandle`
  (`query(sql, params)`, `close()`). Direct PGlite under the lock in this slice; 02 adds the socket
  transport behind the same handle. `PGlite.create({dataDir, extensions:{vector}})` with
  `@electric-sql/pglite-pgvector` (exact peer pin); `CREATE EXTENSION IF NOT EXISTS vector` asserted
  **outside** any recovery path. Unreadable dir → `catalog_unreadable` 69 with path + `photoctl restore`
  hint (restore lands in 03); `PG_VERSION` mismatch → `migrate_required` 69. Never quarantine.
- `packages/library/src/lock.ts` — ONE lock: `~/dev/duet-agent/src/file-lock.ts` payload shape
  (`wx` create, `{pid,startedAt}`) + pid liveness (`pglite.ts:886-893`, **EPERM = unknown → age rule**)
  + bounded stale age 10 min + `process.on("exit")` unlink + **SIGINT/SIGTERM** handlers + same-pid steal.
  `pollAcquire(budgetMs)` backoff `[10,20,40,60,80,100]`. Keep `clearStalePostmasterLock`
  (`pglite.ts:848-866`; 0.5.8 writes it) with its 7 cases from `test/memory-pglite.test.ts:45-134`.
  Lock at `<library>/.photoctl-open.lock`. Timeout → `library_locked` 75 with `holder_pid`, `waited_ms`.
- `packages/library/src/migrations/{runner.ts,0001-init.ts}`: runner lifted from duet `migrations.ts`
  shape (`schema_version`, ascending, transactional). v1 tables: `photos(id uuid /*v7*/ pk, content_key
  text unique, size bigint, w int, h int, orientation int, camera jsonb, exposure jsonb, shot_at timestamptz,
  shot_offset_min int, rating int default 0, flag text default 'none', label text, develop jsonb default '{}',
  develop_hash text, created_at)`, `volumes(uuid pk, label, last_mount, last_seen)`, `files(id pk, photo_id,
  volume_uuid, rel_path, mtime, embedded jsonb, unique(volume_uuid, rel_path))`, `tags(photo_id, tag, pk)`,
  `settings(key pk, value jsonb)`.
- `packages/library/src/identity.ts`: `contentKey(path) = "ck_"+sha256(size‖head 1MiB‖tail 1MiB).slice(0,16)`.
- `packages/library/src/locators.ts`: `VolumeResolver` interface; `MacVolumeResolver` (`diskutil info -plist`);
  `EnvVolumeResolver` (`PHOTOCTL_VOLUME_MAP=/tmp/drive=6A1F-0C3B:online`) — the Docker edge.
- `packages/importer/src/exif.ts`: `readExif(path)` via exifr with `reviveValues:false`; **timezone owner**
  `shotInstant(DateTimeOriginal, OffsetTimeOriginal)`; never `new Date(string)`.
- `packages/importer/src/embedded.ts`: `indexEmbeddedJpegs(path) → [{w,h,offset,length}]` via TIFF IFD walk;
  must return the three tuples in `fixtures/a7c2.json`. Pin the 1616×1080 tier to cache eagerly.
- `packages/importer/src/cache.ts`: root `~/Library/Caches/photoctl/<lib-id>` (`PHOTOCTL_CACHE` override); `emb/<id>.jpg`.
- `packages/render/src/graph.ts`: `renderPhoto(photo, {source:"embedded"}) → {bytes,w,h}` — 1-node graph, permanent path.
- `packages/render/src/coordinates.ts`: `show.dims` = oriented, uncropped, top-left; `toBase/fromBase` stubs used by everything later.
- `packages/render/src/export.ts`: `export <id...> --to <dir> --format jpeg` (identity: bytes copied from the
  full-size embedded JPEG when online, else the pinned 1616 with `warnings[{code:"source_offline"}]`).
- Verbs: `init [--path] [--cache-max]`, `import <file|folder> --link` (single file, non-recursive OK),
  `show <id|prefix>`, `export`, `doctor` (node, pglite, vector ext, cache root, lock state).
  `show.data` = session-sample A5 shape. IDs UUIDv7, unambiguous prefix accepted.
- `wb envelope`: renders every success/failure/partial envelope with exit codes side by side.

## Human can run
```
photoctl init --path /tmp/lib && photoctl import fixtures/a7c2.ARW --link
photoctl show <id>      # dims 7008x4672, shot "2023-10-02T18:18:37+02:00"
photoctl export <id> --to /tmp/out && open /tmp/out/a7c2.jpg
```

## Verification (functional, `test:functional`)
- `first-jpeg.test.ts`: exported bytes == bytes at fixture `offset/length`; `show.shot` equals the manifest;
  `show.dims` equals manifest; under `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo` `show.shot` is unchanged.
- `refuse-to-open.test.ts`: junk dataDir → 69 `catalog_unreadable`, message has path + restore command, no
  `.corrupted-*` sibling; fake `PG_VERSION=17` → `migrate_required`.
- `lock.test.ts`: two processes; stale dead-pid lock reclaimed; live foreign pid → 75 after budget; EPERM
  pid treated by age; Ctrl-C (SIGINT) of a holder leaves no lock file. `postmaster.pid` cases ported.
- `identity.test.ts`: content key equals manifest; changing the last 64 bytes changes it.
- Unit: `exif.timezone.test.ts` on the raw tag strings.

## Delegated
UUIDv7 lib; sha256 vs faster hash (16 hex, ≤2.4 s/2000 files); `--human` table renderer.

## Checkpoint (non-blocking)
Open `/tmp/out/a7c2.jpg` + `wb envelope`. Variable judged: envelope/exit-code shape (cheapest moment to change).

## Must stay green: 00. Deps: 00. Firewall: no daemon, no cull verbs, no resize, no XMP, no develop.
