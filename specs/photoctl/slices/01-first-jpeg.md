# 01 — 01a library open + ONE lock + refuse-to-open + `init`/`doctor`; 01b universal image source → show → export

## 01a — contract unlocked
`photoctl init` creates a library; `doctor` reports it; opening is safe under one lock model; a broken or
version-mismatched library is refused with a recovery command, never recreated.

**Implemented:** commit `3c8909f`, with the atomic-lock review correction in the following maintenance
checkpoint. The kernel lock supersedes the stale-PID unlink algorithm below; the JSON payload and
timeout contract remain unchanged.

### Seam
- `packages/library/src/open.ts`: `openLibrary(path,{noDaemon,lockBudgetMs=30000}) → LibraryHandle{query,close}`; direct PGlite
  under the lock (02 adds the daemon transport behind the same handle). `PGlite.create({dataDir, extensions:{vector}})`
  (`@electric-sql/pglite-pgvector`, exact peer pin); `CREATE EXTENSION IF NOT EXISTS vector` asserted **outside** any recovery
  path; `fsync=on`, `synchronous_commit=on` set after open (D6). Unreadable dir → `catalog_unreadable` 69 with path + `photoctl
  restore`; `PG_VERSION` mismatch → `migrate_required` 69 with hint `photoctl restore` (pgDump is the cross-version path; see 03).
  Never quarantine.
- `packages/library/src/lock.ts` — ONE lock, lifted from `~/dev/duet-agent/src/file-lock.ts` (external): `wx` create of
  `<lib>/.photoctl-open.lock` with payload `{pid, socket:null|path, startedAt}`; pid liveness with **EPERM = unknown → age rule**;
  stale after 10 min; same-pid steal; `process.on("exit")` + SIGINT/SIGTERM unlink; `pollAcquire` backoff `[10,20,40,60,80,100]` ms.
  Invariant: the lock is released on every open/throw path (duet's `session.ts:203-213` leaks it — do not). Timeout →
  `library_locked` 75 with `holder_pid`, `waited_ms`. Unclean-shutdown invariant: open must succeed after `kill -9` of a holder
  (test); keep a `postmaster.pid` janitor only if that test needs it (0.5.8 writes the file).
- `packages/library/src/migrations/{runner.ts,0001-init.ts}` (runner shape from duet `migrations.ts`, external): `schema_version`,
  `settings(key pk, value jsonb)` with `library_id` (uuidv7 at init), `cache_max_bytes` (default 20 GiB), `daemon_idle_ms`.
  v1 photo tables land in 01b (columns exist only when written).
- Verbs: `init [--path ~/Pictures/photoctl] [--cache-max 20GiB]` (existing library → `usage` 2; result = session A1 shape),
  `doctor` (node, pglite, vector ext, cache root, lock holder, library id).

### Verification
`refuse-to-open.test.ts` (junk dataDir → 69 + restore hint, no sibling dirs; fake `PG_VERSION=17` → `migrate_required`);
`lock.test.ts` (with `hold-lock.js`: second process waits then succeeds; stale dead-pid reclaimed; live foreign pid → 75 after
budget; EPERM → age rule; SIGINT of a holder leaves no file; `kill -9` a holder → next open succeeds); `init.test.ts`.

## 01b — contract unlocked
Keyless, no Rust/Swift/drive: any decodable single-frame still image can be linked, shown, previewed offline, and exported.
The A7C II fixture proves the embedded-container path and its camera JPEG exact-copy optimization.

**Implemented:** commits `238c9b3`, `b511389`, `c4be85e`, and `46bce3e`, followed by the review
checkpoint that closes source-integrity, cache-repair, error-contract, and workbench gaps. For this
slice, `import` accepts exactly one file; folder traversal and its batch semantics remain owned by
slice 04, as permitted by the non-recursive scope below.
Every successfully imported decodable still image also becomes independently viewable after its source disappears.

### Seam
- Migration (next number) adds `photos(id uuid /*v7*/ pk, content_key text unique, size bigint, w int, h int /*oriented*/,
  orientation int, camera jsonb, exposure jsonb, shot_at timestamptz, shot_offset_min int, created_at)`, `volumes(uuid pk, label,
  last_mount, last_seen)`, `files(id pk, photo_id, volume_uuid, rel_path, mtime, embedded jsonb, unique(volume_uuid, rel_path))`.
- `packages/importer/src/formats.ts` owns a content-based `probeImage(path) → ImageProbe` registry. `ImageProbe` identifies the
  media type, stored dimensions, frame count, and a preview producer (`embedded-jpeg` with byte ranges or `decoded-file`), without
  trusting the extension. Every decodable single-frame still image is accepted by `import --link` and `import --copy`; unknown or
  incorrect extensions remain valid when bytes probe successfully. Corrupt bytes, animated/multipage media, or a format with no
  registered full-frame preview producer → `skipped_unsupported` on import / `unsupported_file` 65 when addressed directly, and
  create no `photos` row. This registry—not an extension allowlist—is the sole format/capability owner for all slices; slice 07
  adds full-resolution source adapters behind it without changing which verbs a photo supports.
- `packages/library/src/identity.ts`: `contentKey = "ck_" + hex(sha256(size as u64 LE ‖ head 1 MiB ‖ tail 1 MiB)).slice(0,16)`;
  files < 2 MiB hash the whole file once. Fixed; not delegated.
- `packages/library/src/locators.ts`: `VolumeResolver` (`MacVolumeResolver` via `diskutil info -plist`; `EnvVolumeResolver` via
  `PHOTOCTL_VOLUME_MAP=/dir=UUID:online|offline`).
- `packages/importer/src/exif.ts`: exifr `reviveValues:false`; **timezone owner** `shotInstant(DateTimeOriginal, OffsetTimeOriginal)`
  → `shot_at` + `shot_offset_min`; `show.shot` serializes with the offset (`2023-10-02T18:18:37+02:00`); `exposure.shutter` =
  `1/N` when < 1 s else `Ns`.
- `packages/importer/src/embedded.ts`: `indexEmbeddedJpegs(path)` (TIFF IFD walk) must equal the manifest's three tuples.
  `packages/importer/src/cache.ts` owns the universal offline-preview invariant: every successful import pins a JPEG representing
  the full image at the 1616 tier under `emb/<id>.jpg` and upserts its `cache_index(path, bytes, last_used, pinned=true)` row.
  For a container source, use a suitable full-frame embedded JPEG when available (the fixture's 1616×1080 tier).
  For any whole-file image, derive the tier through its registered preview producer, with longest edge at most 1616 px and no
  upscaling. This derived cache artifact does **not** enter
  `files.embedded`, which remains a list of genuine container byte ranges. Cache root is
  `~/Library/Caches/photoctl/<library_id>` (`PHOTOCTL_CACHE` overrides only the base directory).
- Import reports an item as successful only after both the pinned preview bytes and cache-index row exist. Re-import byte-validates
  and repairs a missing/corrupt preview and independently repairs a missing index row before returning `already_present`.
- `packages/render/src/coordinates.ts`: `toBase/fromBase` implemented for EXIF orientation (crop-last arrives in 08c3);
  `bbox=[x,y,w,h]`. `photos.w/h` are oriented dims.
- `packages/render/src/decoder.ts` defines the permanent resolved-source seam:
  `ImageSource = {kind:"online-file",path,mediaType}|{kind:"online-jpeg-range",path,offset,length}|{kind:"pinned-preview",path}`.
  Library/importer resolves catalog and volume state into this value; render never opens PGlite or discovers mounts.
- `packages/render/src/graph.ts`: `renderPhoto(photo,{source:ImageSource}) → Image16`; both whole-file and JPEG-range sources enter
  the same oriented display pipeline. `packages/render/src/export/run.ts` may copy bytes exactly only when the resolved online
  source is itself a full-frame, orientation-1 JPEG; every other format uses the same decode/render/encode path. If an online
  source cannot be read, it uses `pinned-preview` with a `source_offline` warning.
- `packages/render/src/preview.ts` initially establishes `renderStateHash(photo) → "r_"+sha256(canonical pixel-affecting state).slice(0,12)`
  and `ViewSpec{region:null|bbox,longEdge:number|"native"}`. `viewHash(ViewSpec)` canonicalizes base-pixel coordinates and output
  size separately from edit state, so changing zoom never changes `render_hash` and changing edits never reuses stale view pixels.
  It also reserves the full-frame native `ViewSpec` as the display master for a render state; later slices make region and smaller
  view materialization select that master or another resolution-sufficient full-frame cache entry rather than reevaluating edits.
  In 01b the state is source `content_key` plus orientation; later slices extend the same canonical input with develop, geometry,
  layers, and markup. `show` returns this non-null `render_hash`; while state is visually identical to the pinned source preview,
  `data.preview` may point directly at that immutable file without creating a duplicate derived artifact.
  **Superseded at the 08a boundary:** the 12-hex identity and flat pixel-affecting state are unshipped scaffolding;
  Slice 08 hard-cuts canonical render/view identities to full SHA-256 and derives render identity from the immutable
  DAG output root. No short-hash compatibility alias survives outside `--human` presentation.
- Verbs: `import <file|folder> --link` (single file, non-recursive OK; result = A2 shape with `xmp_read` and `embeddings` zeroed),
  `show <id|prefix>` (A5 shape from day one: `preview` is a readable absolute JPEG path;
  `preview_info:{render_hash,view_hash,requested,actual,source_tier,source_dimensions,pixel_scale,resolution_limited,cache_source,
  color_space:"srgb",icc:"sRGB2014",base_to_view,view_to_base,visible_base_polygon}`;
  `develop:{}`, `develop_hash:null`, `render_hash:"r_…"`, `layers:{count:0,stale:0}`, `xmp:null`, `crop:null`),
  `export <id...> --to <dir> --format jpeg`. IDs UUIDv7, unambiguous prefix accepted.
- `wb envelope`.

### Human can run
`photoctl init --path /tmp/lib && photoctl import fixtures/a7c2.ARW --link && photoctl show <id> && photoctl export <id> --to /tmp/out && open /tmp/out/a7c2.jpg`

### Verification
`first-jpeg.test.ts` (exported bytes == fixture bytes at manifest offset/length; `show.shot`, `dims`, `content_key` equal the
manifest; unchanged under `TZ=America/Los_Angeles` and `Asia/Tokyo`); `offline-preview.test.ts` imports a fixture matrix covering
embedded-container and whole-file preview producers (including JPEG, PNG, TIFF, and at least one valid image with an unknown or
incorrect extension), marks every source locator offline, and proves `show.preview` resolves identically for every returned id
from a pinned ≤1616 px JPEG; it also
deletes/corrupts preview bytes and deletes the index row in separate cases, then proves re-import repairs each before returning
`already_present`; `identity.test.ts` (last 64 bytes changed → key changes); `formats.test.ts` proves content wins over extension,
single-frame decodable bytes are accepted, and corrupt/animated/multipage/undecodable bytes are skipped; unit
`exif.timezone.test.ts`, `coordinates.orientation.test.ts`.

## Delegated: UUIDv7 lib; `--human` table renderer; JSON key order.
## Checkpoint (01b)

- Export: `/tmp/photoctl-01b-checkpoint.SB0j4J/out/a7c2.jpg`, 7008×4672, 6,730,200 bytes,
  SHA-256 `6bc3c13c9183f6ad2ed5761525abf65ec838cd2f49ad7bf85c81883f168a7fc6`. The unprimed visual
  review accepted its orientation, framing, and lack of visible artifacts.
- Envelope: `wb envelope` rendered the typed success, locked, and partial states and the unprimed
  review accepted the contract presentation. Non-blocking notes for a later styling pass: exits 65
  and 75 currently share amber, and the partial example begins below the initial viewport.

## Must stay green: 00. Deps: 00 (01b needs 01a). Firewall: no daemon, no cull verbs, no resize, no XMP, no develop.
