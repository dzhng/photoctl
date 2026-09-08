## 1. Slice graph

Global implementation rule for every slice: invoke `write-tests` first; add one observable functional assertion through a real built `photoctl` process, confirm red for the expected reason, implement, confirm green, then add the next case. Pure unit tests are reserved for deterministic parsers, coordinate math, transforms, and color math. Run the narrow owning-package test while iterating, `bun test --changed` after a multi-file pass, and the root `bun run test` exactly once in `22-v1-release-gate`.

### 01-keyless-jpeg-tracer

- **Contract unlocked:** On Node 24, without gateway credentials, Rust, Swift, or a mounted photo drive:

  ```sh
  photoctl init --path "$TMPDIR/demo-library"
  photoctl import fixtures/a7c2.ARW --link
  photoctl show <id>
  photoctl export <id> --to "$TMPDIR/demo-output" --format jpeg
  ```

  produces a human-openable 7008×4672 JPEG by copying the ARW’s full-size embedded JPEG.
- **API seam:** Introduce the end-state owners, initially with the smallest useful implementation:
  - `@photoctl/protocol`: `CommandRequest`, `Envelope<T>`, `BatchResult<T>`, `ProgressEvent`, exit-code mapping.
  - `@photoctl/library`: `openLibrary()`, forward-only migration runner, `PhotoId`, `ContentKey`, `FileLocator`.
  - `@photoctl/importer`: `importSources(request): AsyncIterable<ImportEvent>`.
  - `@photoctl/render`: `renderPhoto(request): Promise<RenderArtifact>`.
  - `apps/cli`: argument parsing and stdout/stderr serialization only.
  - `apps/daemon`: the sole long-lived library process; CLI sends typed requests over its Unix socket. `--no-daemon` dispatches the same `CommandRequest` in-process while holding the same library lock.
  - Canonical response shapes:

    ```ts
    type Envelope<T> =
      | { schema: 1; ok: true; data: T; warnings?: Warning[] }
      | { schema: 1; ok: false; code: ErrorCode; data?: unknown; warnings?: Warning[] };

    type BatchResult<T> = {
      schema: 1;
      ok: boolean;
      code?: "partial" | ErrorCode;
      summary: { ok: number; failed: number };
      results: Array<{ id: string; ok: true; data?: T } | { id: string; ok: false; code: ErrorCode }>;
      warnings?: Warning[];
    };
    ```

    JSON is default; `--human` is the only opt-out. Exit codes are `0`, `2`, `65`, `69`, and `75` per D10. Progress and daemon events are NDJSON on stderr.
  - `RenderRequest` is final rather than a disposable identity-export shortcut:

    ```ts
    type RenderRequest = {
      photoId: PhotoId;
      purpose: "preview" | "export";
      source: "best_available";
      output: { format: "jpeg" | "png" | "tiff"; quality?: number; resizeLongEdge?: number };
    };

    type RenderArtifact = {
      path: string;
      width: number;
      height: number;
      source: "embedded_full" | "ciraw" | "libraw";
      icc: string | null;
      warnings: Warning[];
    };
    ```

    Slice 01 resolves `best_available` to `embedded_full`; later slices extend this owner rather than create another exporter.
- **Human-runnable:** The four commands above, followed by `open "$TMPDIR/demo-output/a7c2.jpg"`.
- **Verification:** `bun test packages/test-harness/src/keyless-jpeg.test.ts -t 'imports and exports the embedded full-size JPEG'`. Assert exit codes, parse stdout, verify `show.data.dims` is `{w:7008,h:4672,orientation:1}`, confirm JPEG dimensions and magic bytes, and assert stderr contains only JSON events. Run once with the gateway environment removed. The visual evidence is the exported JPEG; run `screenshot-critique`, and compare it against direct extraction with `compare-screenshots`.
- **Delegated decisions:** CLI parser library, UUIDv7 package, internal file naming, and temporary-directory helper. The public command names, envelope, IDs, dimensions, daemon behavior, and cache semantics are fixed.
- **Must stay green:** Keyless export, no RAW writes, JSON/stdout discipline, `--human`, exit-code mapping.
- **Dependencies:** None. This is the required first playable checkpoint.

### 02-library-lifecycle-and-contention

- **Contract unlocked:** One library has one writer, mutations are never silently dropped, daemon auto-start is race-safe, unreadable libraries are preserved, and schema upgrades are testable.
- **API seam:** `@photoctl/library/session` exclusively owns:
  - `withLibrary<T>(fn): Promise<{ok:true;value:T}|{ok:false;code:"library_locked";holderPid:number;waitedMs:number}>`; no `undefined` failure.
  - `LibraryLock { pid, startedAt, libraryPathHash, daemonVersion, schema }`.
  - socket path `$TMPDIR/photoctl-<hash>.sock`, hash input `realLibraryPath + daemonVersion + schema`; total path stays below 104 bytes.
  - O_EXCL acquisition, PID liveness, bounded age, `EPERM => "unknown"` rather than definitely alive, cleanup on process exit/SIGINT/SIGTERM, and release if open fails.
  - PGlite `fsync=on`, a roughly 100 ms polling ceiling, one respawn after a stale socket, then `daemon_unavailable`/69.
  - `backupLibrary()` using `pgDump` SQL and `migrateLibrary()` using numbered, forward-only migrations.
- **Lift with deliberate corrections:** Use the lock shape from [`src/file-lock.ts:29`](/Users/david/dev/duet-agent/src/file-lock.ts:29) and age fallback from [`src/file-lock.ts:67`](/Users/david/dev/duet-agent/src/file-lock.ts:67). Do not inherit `withDb` silently returning `undefined` on contention ([`session.ts:85`](/Users/david/dev/duet-agent/src/memory/session.ts:85), [`session.ts:190`](/Users/david/dev/duet-agent/src/memory/session.ts:190)); do not inherit the lock leak around a failed open ([`session.ts:203`](/Users/david/dev/duet-agent/src/memory/session.ts:203)); do not copy directory snapshots ([`pglite.ts:624`](/Users/david/dev/duet-agent/src/memory/pglite.ts:624)); and delete quarantine/start-empty behavior instead of porting it ([`pglite.ts:406`](/Users/david/dev/duet-agent/src/memory/pglite.ts:406)).
- **Human-runnable:**

  ```sh
  photoctl daemon status
  photoctl daemon stop
  photoctl show <id>                 # silently auto-starts again
  photoctl --no-daemon show <id>
  photoctl doctor
  photoctl migrate
  ```

- **Verification:** Port the separate-process topology from [`memory-session-concurrent-fresh-open.test.ts:10`](/Users/david/dev/duet-agent/test/memory-session-concurrent-fresh-open.test.ts:10), but spawn built Node JS instead of Bun source—the source test currently does the latter at [`memory-session-concurrent-fresh-open.test.ts:92`](/Users/david/dev/duet-agent/test/memory-session-concurrent-fresh-open.test.ts:92). Functional cases:
  - eight real CLI processes insert `8×25` distinct tags and exactly 200 values survive;
  - over-capacity returns visible `library_locked`/75, never success with a missing row;
  - simultaneous first opens apply each migration exactly once;
  - a killed daemon leaves a reclaimable lock/socket;
  - unreadable DB returns path plus `photoctl restore <dump>` and exit 69 without moving or replacing it;
  - a fixture library made at schema 1 upgrades through the first `0002-*` migration and preserves its known photo.
- **Delegated decisions:** Exact idle timeout, proposed 15 minutes; socket framing details; connection cap, proposed eight. Timing constants must be injectable and measured under Node 24.
- **Must stay green:** Slice 01 and all durability cases.
- **Dependencies:** 01.

### 03-import-identity-cull-and-offline

- **Contract unlocked:** A shoot can be imported idempotently, culled offline, relocated on the same volume, and removed safely.
- **API seam:** `@photoctl/library/identity` is the only owner of `ContentKey = size + hash(head 1 MiB + tail 1 MiB)` with full hash only on a collision. `photos` own logical identity; `files` is the only 1:N locator table:

  ```ts
  type FileLocator = {
    volumeUuid: string;
    relativePath: string;
    observedMount: string;
    online: boolean;
  };

  type Cull = {
    rating: 0 | 1 | 2 | 3 | 4 | 5;
    flag: "pick" | "reject" | "none";
    label: "red" | "yellow" | "green" | "blue" | "purple" | null;
    tags: string[];
  };
  ```

  `ShotTime` stores UTC instant, the original numeric offset, and local calendar components. `{date}` later reads the stored shot-local date.
- **Commands:** `import [--copy|--link] [--recursive]`, `list` with rating ranges/tag/folder/flag/label/online filters, `show`, `next`, `rate`, `flag`, `label`, `tag`, and `remove [--from-disk --yes]`. Every mutating verb accepts `<id...>` and returns per-item results.
- **Human-runnable:** Import the same ARW twice, move it within a mounted fixture volume, re-import, unplug/unmount the fixture volume, and continue using `list`, `next`, and `show`.
- **Verification:** Functional CLI tests assert:
  - second import reports the actual same `id` and `already_present`;
  - a moved file adds/updates a locator rather than a photo;
  - sample shot-local date is `2023-10-02`, offset `+02:00`, under two different `TZ` values;
  - the 1616×1080 embedded JPEG is eagerly pinned, while `(offset,length)` for the 7008×4672 JPEG is recorded;
  - offline `list/show/next/develop-metadata` work, cached preview remains available, source-dependent export/fill returns `file_offline`/69;
  - `remove --from-disk` requires `--yes`, refuses a multi-ID destructive request without it, and uses macOS Trash.
- **Delegated decisions:** EXIF library and listing sort tie-break after UUIDv7.
- **Must stay green:** 01–02, especially exact-value idempotency rather than a count-only assertion.
- **Dependencies:** 02.

### 04-xmp-portability

- **Contract unlocked:** Lightroom culling metadata round-trips without implicit writes to source folders.
- **API seam:** `@photoctl/library/xmp` alone owns:

  ```ts
  readSidecar(locator): Promise<XmpReadResult>;
  writeSidecar(photoId, fields): Promise<XmpWriteResult>;
  syncSidecar(photoId, direction: "read"): Promise<XmpSyncResult>;

  type XmpState = {
    relativePath: string | null;
    readAt: string | null;
    observedMtimeMs: number | null;
    stale: boolean;
  };
  ```

  Import reads ratings, keywords, flags, and five labels. PGlite wins after first import. Only `xmp write` writes sidecars; `xmp sync --read` pulls external changes. Embedded XMP is never modified.
- **Human-runnable:** `photoctl xmp write <id>`, externally modify the deterministic XMP fixture, then run `photoctl list --xmp-stale`, `photoctl doctor`, and `photoctl xmp sync <id> --read`.
- **Verification:** Real CLI processes against a fixture `.xmp`; compare semantic fields after write/read, retain unrelated namespaces, and assert the ARW hash is unchanged. Test stale mtime detection and PGlite conflict precedence.
- **Delegated decisions:** XML serializer and whitespace ordering; tests compare parsed meaning, not formatting.
- **Must stay green:** 01–03.
- **Dependencies:** 03.

### 05-delivery-export

- **Contract unlocked:** A professional can produce deterministic delivery batches from the identity render.
- **API seam:** Extend the existing `@photoctl/render` output owner; add one `ExportSpec`:

  ```ts
  type ExportSpec = {
    format: "jpeg" | "tiff" | "png";
    quality?: number;
    resizeLongEdge?: number;
    template: string;
    collision: "skip" | "overwrite" | "rename";
    iptc: Record<string, string>;
    preset?: string;
  };
  ```

  Template v1 supports `{date}`, `{seq}`, `{seq:NN}`, and `{stem}`; sequence is scoped to the submitted batch. `export_history` records the resolved spec and output.
- **Human-runnable:**

  ```sh
  photoctl export <id...> --to ./deliver --format jpeg --quality 88 \
    --resize 2048 --template '{date}_{seq:03}_{stem}' \
    --on-collision rename --iptc creator='David Z'
  ```

- **Verification:** Functional CLI cases for resize, template, batch sequence, all three collision modes, embedded IPTC/ICC, retry behavior, and partial batches. Export warns but writes for soft states such as stale layers or unfinished vacancy. A genuinely unavailable source with no sufficient cached render remains the D1 hard failure `file_offline`/69.
- **Delegated decisions:** JPEG encoder settings below the public quality value and the initial export-preset names.
- **Must stay green:** 01–04.
- **Dependencies:** 03; XMP is not required to export, so 04 may run in parallel.

### 06-ciraw-decoder-adapter

- **Contract unlocked:** macOS can decode an ARW through a small headless Swift executable behind the common decoder contract.
- **API seam:** Introduce the final decoder interface in `@photoctl/render`:

  ```ts
  type DecodeRequest = {
    locator: FileLocator;
    output: "linear-rgb-f32" | "display-rgb-u16";
    maxLongEdge?: number;
  };

  type DecodeResult = {
    pixelsPath: string;
    width: number;
    height: number;
    orientation: number;
    color: ColorProvenance;
    decoder: { id: "ciraw" | "libraw"; version: string };
  };

  interface RawDecoder {
    probe(locator: FileLocator): Promise<DecoderProbe>;
    decode(request: DecodeRequest): Promise<DecodeResult>;
  }
  ```

  `native/ciraw-helper` implements only this external adapter. Validity requires `supportedDecoderVersions != ["None"]` and an `identifierHint`.
- **Human-runnable:** `photoctl doctor --decoder ciraw` and `photoctl export <id> --decoder ciraw --to ./ciraw`.
- **Verification:** Host-macOS functional test invokes the real built CLI/helper with `fixtures/a7c2.ARW`; add a headless SSH/no-window-server probe before accepting. Produce an identity-render JPEG, run `screenshot-critique`, and compare against embedded JPEG with `compare-screenshots`, judging orientation/framing separately from color.
- **Delegated decisions:** Swift process transport, proposed length-prefixed JSON plus temporary pixel files; helper executable name.
- **Must stay green:** 01–05; Linux/Docker reports CIRAW unavailable rather than pretending to decode.
- **Dependencies:** 01.

### 07-libraw-decoder-adapter

- **Contract unlocked:** The portable core decodes A7C II RAW through vendored LibRaw 0.22.2 or newer.
- **API seam:** `crates/libraw-sys` exclusively owns the vendored C/C++ build under CDDL; `crates/photoctl-image` implements the existing `RawDecoder` ABI through napi-rs. LibRaw performs unpack, metadata, and demosaic only. It does not own tone, output TRC, or the render graph.
- **Build invariants:** `--disable-openmp`; dynamic libc++; separate `darwin-arm64` and `darwin-x64` npm packages; no binding pinned to LibRaw ≤0.21.3.
- **Human-runnable:** `photoctl doctor --decoder libraw`, then export the sample with `--decoder libraw`.
- **Verification:** Rust tests for error mapping and metadata, plus a real CLI functional decode. Confirm A7C II does not use the 0.21.x A7C matrix. Add build-artifact inspection proving no `/opt/homebrew/libomp` linkage. Produce a JPEG and apply the same visual gates as slice 06.
- **Delegated decisions:** bindgen versus hand-written minimal FFI, build-script organization, and temporary pixel container.
- **Must stay green:** 01–06.
- **Dependencies:** 06 for the already-fixed decoder interface, not for Swift code.

### 08-render-color-core

- **Contract unlocked:** Both decoders feed one deterministic, color-managed render graph.
- **API seam:** `@photoctl/render/graph` is the only graph owner:

  ```text
  decode/unpack
    → black/white normalization
    → as-shot WB unless as_shot_wb_applied
    → camera matrix into linear Rec.2020 f32
    → develop operations
    → display transform/TRC
    → display-referred RGB u16 layers
    → crop/straighten
    → resize/encode with sRGB2014.icc
  ```

  It exports stage provenance and computed coordinate transforms; no test or consumer re-derives them. The coordinate owner is `OrientedBaseSpace {width,height,origin:"top-left"}`. CLI `--norm` is converted once at this boundary.
- **Human-runnable:** Generate an HTML decoder-oracle report containing embedded, CIRAW, and LibRaw renders plus numeric deltas and provenance.
- **Verification:** Decoder oracle through `photoctl export`: CIRAWFilter and LibRaw agree within an explicitly recorded tolerance after each path’s WB/TRC; highlight tolerance accounts for white-level disagreement 16383 versus 15360. Exact unit tests cover sRGB piecewise TRC including negative reflection, WB suppression when `as_shot_wb_applied`, orientation, and normalized-coordinate conversion. Run both visual skills on the report.
- **Delegated decisions:** Measured numeric oracle tolerance and chart layout; record the measurement and rationale in the spec before locking it.
- **Must stay green:** 01–07.
- **Dependencies:** 06–07.

### 09-develop-dictionary-and-presets

- **Contract unlocked:** One inspectable develop representation powers presets, manual edits, filters, copying, and render invalidation.
- **API seam:** `@photoctl/render/develop` owns `DevelopSettings`, validation, canonical hashing, preset overlays, and tier classification. `develop --set` merges absolute values; `--unset` removes named keys; `--reset` returns to identity; preset overlay applies before `--set`; copying is `develop --copy-from`.
  - Tier 1: exposure, brightness, contrast, saturation, vibrance, black_point, and small WB changes.
  - Tier 2: curves, levels, highlights, shadows, brilliance, definition, noise reduction, selective color, and B&W.
  - Store exactly one dictionary and one canonical `develop_hash` per photo.
  - `filter` writes the same dictionary as `{filter:{name,strength}}`; it is not a second adjustment system.
- **Shipped presets:**
  - `neutral = {}`
  - `people = {"highlights":-20,"shadows":15,"contrast":-8,"vibrance":10,"saturation":-5,"white_balance":{"temp_offset_k":150},"noise_reduction":{"luminance":15,"color":25},"sharpen":20,"definition":-5,"vignette":-8}`
  - `high-contrast = {"contrast":30,"black_point":12,"highlights":-15,"shadows":-10,"definition":20,"saturation":8,"sharpen":35}`
- **Human-runnable:** `photoctl presets list|show`, `photoctl develop <id...> --preset people --set exposure=0.3`, `photoctl show <id>`, and before/after exports.
- **Verification:** CLI tests assert exact stored dictionary, overlay order, stable hash, idempotent retries, batch partials, and output changes. Build a three-preset contact sheet; run `compare-screenshots` against neutral and an unprimed `screenshot-critique`.
- **Delegated decisions:** Reversible tuning of preset numeric values after checkpoint evidence; hashing implementation, provided canonical equal dictionaries hash identically.
- **Must stay green:** 01–08.
- **Dependencies:** 08.

### 10-local-restoration-and-crop

- **Contract unlocked:** Crop, rotate, straighten, Apple-style develop controls, and non-generative retouch remain local geometry/restoration.
- **API seam:** Extend the single render graph with:
  - local OpenColorIO grading operators;
  - cheap `noise_reduction.{luminance,color}` only: CIRAWFilter raw-domain where available, otherwise local NLM;
  - `Crop {rect, rotate, straightenDeg, aspectRatio}` applied after layer composite;
  - local horizon estimator for `--auto`;
  - deterministic heal-brush operation for `retouch --at`.
- **Commands:** Full documented develop-key vocabulary; `crop --aspect [--straighten] [--auto]`; `retouch --at [--radius]`.
- **Human-runnable:** Export one contact sheet showing neutral, people, crop-auto, and retouch.
- **Verification:** Functional CLI tests ensure crop does not mutate layer/base coordinates, `crop --auto` equals horizon result plus minimal trim, retrying absolute crop/retouch is idempotent, and offline develop metadata succeeds. Visual variable checkpoints are separate: first crop framing, then retouch seam visibility.
- **Delegated decisions:** Exact local algorithms and Apple-inspired curve tuning, but not their storage shape, order, or local-only classification.
- **Must stay green:** 01–09.
- **Dependencies:** 09.

### 11-embedding-toast-and-request-spikes

- **Contract unlocked:** The two unresolved risks are answered before an embedding worker or search schema can ship.
- **API seam:** No production abstraction yet. Add reproducible probes owned by `packages/test-harness/spikes`:
  1. On PGlite 0.5.8 plus `pglite-pgvector` 0.0.9, create `halfvec(3072)`, heavily UPSERT deterministic vectors, then copy/rebuild/read them to reproduce or clear the TOAST failure.
  2. With a supplied key, send one image through Vercel Gateway to `google/gemini-embedding-2` and capture the accepted multimodal request/response shape with content redacted.
- **Evidence:** The TOAST concern comes from the failed wide-vector table rewrite at [`migrations.ts:356`](/Users/david/dev/duet-agent/src/memory/migrations.ts:356). Extension registration must use `@electric-sql/pglite-pgvector`; do not repeat the invalid import seen at [`pglite.ts:2`](/Users/david/dev/duet-agent/src/memory/pglite.ts:2). `CREATE EXTENSION vector` is probed before the catalog-recovery try block so a missing extension cannot masquerade as corruption.
- **Human-runnable:** `bun run spike:toast` without credentials; `bun run spike:embedding-shape` only when a key is available. Each writes a small redacted Markdown/JSON report.
- **Verification:** Deterministic seed, fixed UPSERT count, row-by-row vector checksums, and nonzero assertions. A skipped keyed probe is reported as unresolved, never green.
- **Delegated decisions:** UPSERT volume large enough to reproduce within a bounded runtime and redaction layout.
- **Must stay green:** 01–10.
- **Dependencies:** 02.

### 12-embedding-worker-and-hybrid-search

- **Contract unlocked:** Imports can queue consent-aware image embeddings and search can fuse semantic and textual results.
- **API seam:** `@photoctl/library/search` owns:
  - `halfvec(3072)` and HNSW cosine;
  - stored embedding `model_id`;
  - tsvector over tags, filename, caption, and folder with GIN;
  - one RRF implementation for semantic plus textual rankings.
  
  `@photoctl/providers/embedding` is the sole image-embedding edge and accepts only `google/gemini-embedding-2`. `EmbeddingWorker` is event-driven, drains bounded batches, releases the library between batches, and returns explicit states `drained | cooling | library_locked | provider_unconfigured`.
- **Lift carefully:** Preserve event-driven shutdown and per-batch relinquish from [`embedding-worker.ts:7`](/Users/david/dev/duet-agent/src/memory/embedding-worker.ts:7) and [`embedding-worker.ts:226`](/Users/david/dev/duet-agent/src/memory/embedding-worker.ts:226). Re-derive the admitted yield/backoff coupling rather than copying 250/1000 ms assumptions ([`embedding-worker.ts:47`](/Users/david/dev/duet-agent/src/memory/embedding-worker.ts:47)); the existing starvation test itself embeds Bun-specific timing assumptions ([`memory-embedding-worker-lock-starvation.test.ts:28`](/Users/david/dev/duet-agent/test/memory-embedding-worker-lock-starvation.test.ts:28).
- **Commands:** `init --embed auto|manual`, `embed <id...>|--pending`, and `search <query> [--stream]`. Import reports:

  ```json
  {
    "embeddings": {
      "mode": "auto",
      "queued": 2131,
      "model": "google/gemini-embedding-2",
      "est_usd": 0.90
    }
  }
  ```

- **Human-runnable:** With no key, manual imports complete and `embed` returns `provider_unconfigured`/69. With a configured fake gateway, `embed` drains and `search "ceremony portrait"` returns deterministic ranked IDs.
- **Verification:** Docker functional tests use a fake HTTP gateway at the network edge while keeping the real CLI, daemon, PGlite, queue, and RRF path. Test worker starvation with a separate Node process, restart/resume, model-ID replacement, structured costs, text-only fallback, `--stream`, and no idle tick. If slice 11 reproduces TOAST corruption, sub-slice 12A selects a safe schema/write strategy before 12B implements the worker.
- **Delegated decisions:** RRF constant after a deterministic relevance fixture, queue batch size, and measured Node timing constants.
- **Must stay green:** 01–11.
- **Dependencies:** 11 and 03.

### 13-layer-model-and-render-ownership

- **Contract unlocked:** A layer is the sole persisted noun for selections, generated pixels, vacancies, and markup ordering.
- **API seam:** `@photoctl/render/layers` owns:

  ```ts
  type LayerState = "selected" | "filled" | "moved";
  type LayerRole = "subject" | "vacancy" | "markup";
  type LayerTransform = {
    dx: number;
    dy: number;
    scale: number;
    rotate: number;
    flip: "x" | "y" | "xy" | null;
    anchor: { x: number; y: number } | "centroid";
  };
  type PixelLayer = {
    id: number;
    photoId: PhotoId;
    state: LayerState;
    role: LayerRole;
    pixels16Path: string | null;
    maskPath: string;
    developHash: string;
    transform: LayerTransform;
    opacity: number;
    blendMode: BlendMode;
    stale: boolean;
    order: number;
  };
  ```

  Coordinates are always oriented, uncropped base pixels. Scale→rotate→translate about the anchor; absolute by default, `--relative` only for nudges. Quarter turns and flips are exact. Composite is display-referred 16-bit; previews use bilinear and final render uses a single Lanczos3 resample.
- **Commands:** `layer list|transform|reorder|set|duplicate|remove|clear`.
- **Human-runnable:** Create deterministic asymmetric fixture layers, transform/reorder them, and export an HTML/contact-sheet report.
- **Verification:** Pure coordinate tests plus functional CLI exports. Use asymmetric masks to expose orientation mistakes. Assert absolute retries are idempotent, relative calls accumulate, ordering is stable, crop remains last, and all consumers use the owner-provided transform matrix.
- **Delegated decisions:** Initial blend-mode subset and report aesthetics; blend space is fixed.
- **Must stay green:** 01–12.
- **Dependencies:** 08–10.

### 14-sam-runtime-spike

- **Contract unlocked:** SAM 2.1 ONNX can be packaged and invoked locally on CPU within an explicit resource envelope.
- **API seam:** `crates/photoctl-image/segment` owns one geometry interface:

  ```rust
  SegmentRequest {
      image: PixelBufferRef,
      prompts: Vec<PointOrBoxOrBrush>,
  }
  SegmentResult {
      masks: Vec<MaskRef>,
      scores: Vec<f32>,
      provenance: ExecutionProvenance,
  }
  ```

  Default execution provider is CPU. CoreML may be enabled only if static shapes, output equivalence, and ≥2× measured speed satisfy D40; daemon owns compiled-model caches.
- **Human-runnable:** `photoctl doctor --segmenter` and a standalone benchmark/report over a deterministic asymmetric image.
- **Verification:** Compare CPU outputs by mask checksum/IoU across repeated runs, record peak RSS and latency, prove model provenance, and verify absence produces an actionable install error. If packaging, memory, or latency misses the declared budget, split 14A model acquisition/license, 14B inference ABI, and 14C packaging before exposing the CLI.
- **Delegated decisions:** Exact SAM 2.1 checkpoint and bounded performance budget after measurement; no substitution with SAM 3 or a gateway model.
- **Must stay green:** 01–13.
- **Dependencies:** 07 for native packaging, 13 for mask ownership.

### 15-segmentation-cli

- **Contract unlocked:** Point, box, brush, and text prompts create layers without inventing a parallel mask entity.
- **API seam:** `@photoctl/render/segment` converts public `OrientedBaseSpace` coordinates to the native geometry seam. `--text` alone uses AI SDK structured output:

  ```ts
  type GeminiBox = {
    box_2d: [ymin: number, xmin: number, ymax: number, xmax: number]; // 0..1000
    confidence: number;
    label: string;
  };
  ```

  The adapter converts this once to top-left pixel `[x,y,w,h]`, then SAM refines it. All instances become one selected layer each. `--at` can disambiguate. `--dry-run` returns candidates and creates nothing.
- **Human-runnable:** `segment --at`, `--box`, `--brush`, and deterministic stubbed `--text --dry-run`; inspect masks and layer list.
- **Verification:** Functional CLI tests assert zero gateway calls for local prompts, no row for dry-run, every text instance becomes one layer, coordinate conversion is correct, and offline local segmentation works when cached pixels suffice. Visual report gets unprimed critique.
- **Delegated decisions:** Confidence display precision and selected-layer names.
- **Must stay green:** 01–14.
- **Dependencies:** 13–14 and the generic structured-provider seam introduced in 16 for live `--text`; local modes may land first as 15A.

### 16-provider-contract-and-keyed-smokes

- **Contract unlocked:** Generation callers depend on a future-proof two-level boundary, not directly on Vercel or model quirks.
- **API seam:** `@photoctl/providers` owns:

  ```ts
  interface GatewayAdapter {
    invoke(request: GatewayRequest): Promise<GatewayResponse>;
    resolveModel(modelId: string): Promise<{ exists: boolean }>;
  }

  interface ImageModelAdapter {
    buildEdit(request: NormalizedImageEdit): GatewayRequest;
    normalize(response: GatewayResponse, sent: { width: number; height: number }): Promise<ModelPixels>;
  }

  type NormalizedImageEdit = {
    operation: "fill" | "outpaint" | "reimagine" | "generate" | "relight";
    image?: PixelInput;
    mask?: MaskInput;
    prompt: string;
    width: number;
    height: number;
    seed?: number;
  };

  type ModelPixels = {
    pixelsPath: string;
    width: number;
    height: number;
    resampled: boolean;
    warnings: ProviderWarning[];
    costUsd?: number;
    elapsedMs: number;
  };
  ```

  `VercelGatewayAdapter` is the only v1 gateway. Model adapters are separate for native-mask `openai/gpt-image-2` and instruction-plus-composite Nano Banana/Grok. No runtime capability discovery; `ModelTable` is hard-coded and config-overridable. `doctor` checks configured IDs resolve. The strict composite remains above both abstractions.
- **Human-runnable:** Without a key, each generative command emits `provider_unconfigured`/69. With a key, run:
  1. mask-polarity smoke through `POST /v1/images/edits`;
  2. the embedding request-shape smoke if still unresolved.
- **Verification:** Fake-gateway functional tests exercise Vercel request serialization, structured outputs through Zod, warnings, PNG output request, dimension normalization, and model-table overrides. The live smokes are separately named and never silently skipped.
- **Delegated decisions:** Which of the measured Nano Banana/Grok IDs join the default table; Vercel authentication plumbing.
- **Must stay green:** 01–15.
- **Dependencies:** 11 and 13.

### 17-fill-and-strict-composite

- **Contract unlocked:** Selected layers can be removed or replaced while every pixel outside the effective mask remains bit-exact.
- **API seam:** `@photoctl/render/fill` owns request planning; `crates/photoctl-image/composite` owns dilation, feathering, resampling, and overlay. Effective-mask modes are:
  - `strict`: hard mask;
  - `expand=N`: dilated mask, default 24 for replacement;
  - `free`: soft mask.
  
  Provider output is always normalized to sent crop dimensions; if necessary, resample and return `resampled:true`. D27 supersedes the sample’s strict dimension failure. A provider warning that indicates whole-image editing is a hard provider failure under `strict`, but geometry mismatch itself is normalized.
- **Commands:** `fill <id> --layer L --remove|--prompt ... [--ref] [--fit] [--full-res] [--pad] [--strength] [--init] [--refresh]`.
- **Human-runnable:** First run with a deterministic fake provider returning canned asymmetric pixels; then optionally run gpt-image-2 after mask polarity is known.
- **Verification:** For every model adapter, functional CLI tests compare every output pixel outside the owner-provided effective mask byte-for-byte with the pre-fill render. Also assert returned/sent dimensions, `resampled`, provider warning behavior, default fits, `provider_unconfigured`, and persisted 16-bit pixels/mask/develop hash.
- **Delegated decisions:** Temporary-file format and feather kernel; semantics of strict/expand/free are fixed.
- **Must stay green:** 01–16.
- **Dependencies:** 13 and 16.

### 18-move-vacancy-outpaint-and-refresh

- **Contract unlocked:** The complete person-move flow works without duplicating masks or regenerating paid pixels unnecessarily.
- **API seam:** Extend the single layer and render-graph owners:
  - `fill --move --to|--by` is pure geometry and makes the subject `moved`;
  - it creates one `role:"vacancy"` layer using the original full silhouette captured once;
  - unfilled vacancy renders magenta;
  - outpaint pads locally to requested aspect/pixels and marks only padding as editable;
  - Tier-1 develop changes delta-apply to pinned layers;
  - Tier-2 changes set `stale:true`;
  - `fill --refresh` replaces pixels and develop hash through the same layer row.
- **Human-runnable:** Full flow: segment, move, inspect magenta vacancy, strict remove, prompted replacement, Tier-1 nudge, Tier-2 stale transition, warning-bearing export.
- **Verification:** Functional person-move integration case from the map. Assert `gateway_calls:0` for move, stored vacancy mask checksum survives later nudges, transforms are free/idempotent, Layer 1/2 relationships persist, and export writes with `warnings[]` for stale or unfilled layers per D28. D28 supersedes the sample’s refusal in B4.
- **Delegated decisions:** Warning message prose and magenta checker/solid presentation; warning codes and non-refusal are fixed.
- **Must stay green:** 01–17.
- **Dependencies:** 09, 13, 15, 17.

### 19-full-frame-generation-and-auto-tools

- **Contract unlocked:** Remaining gateway features are thin, explicit clients of the same provider and render contracts.
- **API seam:**
  - `reimagine` and `relight` use the same full-frame regeneration path and return `"drift":"full-frame"`;
  - `generate` writes a file, imports it, and tags it `generated`;
  - `auto_enhance` uses structured VLM output constrained to ordinary develop keys;
  - `restore` is a reserved provider operation with no v1 implementation;
  - prebuilt prompts C1–C4 are versioned data in `@photoctl/providers/prompts`, not embedded independently in commands.
- **Human-runnable:** Stub-provider versions of `reimagine`, `relight`, `generate`, and `auto_enhance`; optionally live models when configured.
- **Verification:** Functional tests confirm shared provider routing, output import identity, full-frame drift field, structured-output rejection of unknown develop keys, conservative bounds, and no runtime capability lookup. Visual live outputs use screenshot critique; comparisons judge only the verb’s named variable.
- **Delegated decisions:** Reversible prompt wording and default image size/model after live evidence.
- **Must stay green:** 01–18.
- **Dependencies:** 09 and 16–18.

### 20-vector-markup

- **Contract unlocked:** Vector markup persists non-destructively and flattens through the same final render.
- **API seam:** `@photoctl/render/markup` owns:

  ```ts
  type Markup =
    | TextMarkup
    | ArrowMarkup
    | LineMarkup
    | RectMarkup
    | EllipseMarkup
    | PathMarkup
    | HighlightMarkup;
  ```

  Coordinates use `OrientedBaseSpace`; markup is represented as `role:"markup"` layers and therefore uses existing ordering, opacity, transforms, and final flattening.
- **Human-runnable:** `markup list|add|update|remove|clear`, `layer reorder`, and JPEG export.
- **Verification:** Functional round-trip and export tests for every primitive, idempotent update/remove/clear, crop-last behavior, and ordering with pixel layers. Produce one fixture page and run visual critique.
- **Delegated decisions:** Default fonts, stroke widths, and colors.
- **Must stay green:** 01–19.
- **Dependencies:** 13 and 08.

### 21-founder-library-and-gold-exam

- **Contract unlocked:** The sample library is replaced by David’s real removable-drive shoot and Classic metadata without changing any interfaces.
- **API seam:** No new production seam. This consumes the locator, XMP, decoder, develop, and export contracts.
- **Human-runnable:** On David’s Mac:

  ```sh
  photoctl import <ARW-drive-folder> --link --recursive
  photoctl list
  photoctl rate <10 ids> --stars 5
  photoctl develop <3 ids> --preset people
  photoctl export <3 ids> --to ./gold --format jpeg
  ```

- **Verification:** Run the exact gold exam with no gateway key. Add a real-drive evidence report: import totals, content-key/locator results, offline behavior, XMP counts, decoder provenance, and three exported JPEGs. Open those outputs, wait about five minutes for feedback, then proceed on evidence if silent.
- **Delegated decisions:** Which ten/three real photos comprise the acceptance sample and the final export quality.
- **Must stay green:** All previous tests.
- **Dependencies:** 01–20; gateway-only features are not gold-exam blockers.

### 22-v1-release-gate

- **Contract unlocked:** Reproducible Node 24 CLI installation, native artifacts, migrations, licensing notices, and one complete closeout verdict.
- **API seam:** Packaging only; no new domain abstraction. Publish `photoctl` plus platform packages, Swift helper, model acquisition metadata, schema migrations, and license notices.
- **Human-runnable:** Install the packed artifact into a clean directory, put `photoctl` on `PATH`, run `photoctl doctor`, the keyless tracer, and the gold exam.
- **Verification:** Run exactly once:

  ```sh
  bun run verify
  ```

  This includes format, lint, typecheck, build, TS/Rust/Swift tests, Docker functional suite, host-macOS decoder suite, package smoke, migration-fixture upgrades, the eight map integration cases, license inspection, and native linkage inspection. Run `codex review`, then the repository `review` closeout sequence before declaring v1 complete.
- **Delegated decisions:** npm package publication names and release automation provider.
- **Must stay green:** Entire suite.
- **Dependencies:** 21.

### 23-optional-mcp-facade

- **Contract unlocked:** If selected after v1, MCP exposes exactly the CLI verbs and response schemas.
- **API seam:** `apps/mcp` translates MCP calls into the same `CommandRequest`; it does not call PGlite, renderers, or providers directly.
- **Human-runnable:** Invoke the gold-exam verbs through MCP and compare envelopes with CLI output.
- **Verification:** Contract-equivalence tests dispatch identical requests through CLI and MCP and compare normalized envelopes.
- **Delegated decisions:** MCP transport and tool descriptions.
- **Must stay green:** 01–22.
- **Dependencies:** 22. Optional and not part of the v1 gold gate.

## 2. Monorepo layout, root scripts, and Docker seam

Use Bun 1.3.x as package manager, workspace resolver, test runner, and Turbo launcher because the duet precedent already establishes workspaces, a dependency catalog, Turbo, oxlint, and oxfmt ([`duet/package.json:4`](/Users/david/dev/duet/package.json:4), [`duet/package.json:33`](/Users/david/dev/duet/package.json:33)). Production CLI and daemon processes must run on Node 24; no Bun runtime APIs may appear in production modules. Follow the game precedent of root aliases spanning TS and Cargo rather than hiding Rust behind a JS package ([`game/package.json:5`](/Users/david/dev/game/package.json:5), [`game/Cargo.toml:1`](/Users/david/dev/game/Cargo.toml:1)).

```text
photoctl/
├── apps/
│   ├── cli/                    # argument parsing, process IO, thin composition
│   ├── daemon/                 # Unix-socket CommandRequest server and worker lifetime
│   └── mcp/                    # optional slice 23 facade
├── packages/
│   ├── protocol/               # one owner: command/request/event/envelope schemas
│   ├── library/                # PGlite schema, migrations, session, repositories, XMP
│   ├── importer/               # discovery, EXIF/XMP ingestion, embedded-preview extraction
│   ├── render/                 # render graph, develop, coordinates, layers, export planning
│   ├── providers/              # gateway adapter × model adapter, embeddings, prompts
│   ├── config/                 # library config and fixed model table
│   ├── test-harness/           # real-process functional driver and fake external services
│   └── typescript-config/
├── crates/
│   ├── libraw-sys/             # vendored LibRaw >=0.22, CDDL boundary
│   └── photoctl-image/         # napi ABI: decode, mask, transform, composite, encode, SAM
├── native/
│   └── ciraw-helper/           # standalone SwiftPM package, Core Image adapter only
├── fixtures/
│   ├── a7c2.ARW
│   ├── xmp/
│   ├── layers/
│   ├── providers/
│   └── libraries/
│       └── schema-v1.pgsql     # pgDump fixture, upgraded by every later schema
├── test/
│   ├── Dockerfile
│   ├── compose.yaml
│   └── gateway-fixture/
├── Cargo.toml
├── package.json
├── turbo.json
└── bun.lock
```

Every new app/package/native folder gets a short README naming its ownership boundary. The root README is the documentation hub and does not duplicate those details.

Root scripts:

```json
{
  "engines": { "node": "24.x" },
  "packageManager": "bun@1.3.14",
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "catalog": {
      "@electric-sql/pglite": "0.5.8",
      "@electric-sql/pglite-pgvector": "0.0.9",
      "typescript": "<single pinned version>"
    }
  },
  "scripts": {
    "build": "bun run build:ts && bun run build:rust && bun run build:swift",
    "build:ts": "turbo run build",
    "build:rust": "cargo build --workspace",
    "build:swift": "swift build --package-path native/ciraw-helper",
    "format": "oxfmt --write --no-error-on-unmatched-pattern && cargo fmt --all && swift format -i -r native/ciraw-helper",
    "format:check": "oxfmt --check --no-error-on-unmatched-pattern && cargo fmt --all -- --check && swift format lint -r native/ciraw-helper",
    "lint": "turbo run lint && cargo clippy --workspace --all-targets -- -D warnings",
    "typecheck": "turbo run typecheck",
    "test": "bun run test:ts && bun run test:rust && bun run test:swift && bun run test:functional && bun run test:macos",
    "test:ts": "turbo run test --continue --concurrency=1",
    "test:rust": "cargo test --workspace",
    "test:swift": "swift test --package-path native/ciraw-helper",
    "test:functional": "docker compose -f test/compose.yaml run --rm functional",
    "test:macos": "bun run --cwd packages/test-harness test:macos",
    "test:package": "bun run --cwd packages/test-harness test:package",
    "verify": "bun run format:check && bun run lint && bun run typecheck && bun run build && bun run test && bun run test:package"
  }
}
```

`turbo.json` makes `test` depend on `^build`, matching the precedent at [`duet/turbo.json:6`](/Users/david/dev/duet/turbo.json:6), because functional workers must import built JS.

Docker seam:

- Build a Linux Node 24 image; install Bun only as the test runner/package manager.
- Build JS and the Linux LibRaw/native addon before running tests.
- Mount `fixtures/` read-only. Give each test an isolated real PGlite data directory and output directory on a Docker volume.
- Start a deterministic HTTP gateway fixture as a separate service. It accepts the real Vercel-shaped HTTP requests and serves fixed asymmetric pixels, structured boxes, and fixed 3072-dimensional vectors.
- The test harness always spawns `node apps/cli/dist/bin.js`; never `bun src/cli.ts`. Duet’s current tests use Bun source workers ([`memory-session-concurrent-fresh-open.test.ts:107`](/Users/david/dev/duet-agent/test/memory-session-concurrent-fresh-open.test.ts:107)), which D38 explicitly rejects for this port.
- Do not use `testIfDocker` or an environment-conditioned skip inside the suite. Running `test:functional` is the gate. If Docker or required assets are missing, the command fails visibly.
- Portable tests exercise real PGlite, daemon sockets, locks, migrations, LibRaw, render, and CLI processes. Only true external edges are substituted: the HTTP gateway and mounted-volume events.
- CIRAWFilter runs in the host-macOS functional job through the real CLI and Swift helper. Docker asserts the typed `decoder_unavailable` behavior for that adapter.
- Concurrency cases model different OS PIDs, following the reasoned topology in [`memory-session-concurrent-fresh-open.test.ts:15`](/Users/david/dev/duet-agent/test/memory-session-concurrent-fresh-open.test.ts:15) and the real outer CLI path used by the multi-CLI evaluation ([`memory-multi-cli-lock.eval.ts:17`](/Users/david/dev/duet-agent/evals/memory-multi-cli-lock.eval.ts:17)).

## 3. Single-owner seams

| Concept | Sole owner | Introduced | Invariant |
|---|---|---:|---|
| JSON envelope, batch partials, stderr events, exit codes | `packages/protocol` | 01 | CLI, daemon, tests, and optional MCP import the same schemas. |
| Command dispatch and daemon socket frames | `packages/protocol` + thin daemon transport | 01 | `--no-daemon` invokes the same dispatcher; no second command API. |
| Library lifetime, lock, fsync, recovery, backup | `packages/library/session` | 01/02 | One lock implementation only; imported duet lock variants are consolidated, not retained beside each other. |
| Schema and forward migrations | `packages/library/migrations` | 01 | Every schema change is numbered and upgrades the oldest fixture; no down migrations or compatibility reads. |
| Photo identity | `packages/library/identity` | 01 | Only this module computes the partial/full hash; tests consume its stored key rather than re-derive it. |
| Locator and online/offline state | `packages/library/locators` | 01/03 | Only `files` maps photo identity to volume-relative locations. No canonical absolute path column. |
| XMP authority/conflict state | `packages/library/xmp` | 03/04 | PGlite is canonical; explicit sidecar writer only. |
| Cache policy | `packages/importer/cache` | 01/03 | Independent cache root, pinned 1616×1080 preview, on-demand full embedded JPEG, one LRU/prune policy. |
| RAW decoder interface | `packages/render/decoder` | 06 | CIRAW and LibRaw implement the same interface; embedded extraction is a source/cache operation, not a competing RAW decoder. |
| Color/render graph | `packages/render/graph` | 01, completed 08 | Export, preview, fill inputs, layers, and markup all call `renderPhoto`; no dedicated “AI render” or “export render.” |
| Coordinate space | `packages/render/coordinates` | 08 | Oriented uncropped top-left pixel space; crop last; external coordinate systems convert once at their adapter. |
| Develop dictionary and hash | `packages/render/develop` | 09 | Presets, filters, copy, auto-enhance, XMP, tiering, and `show` share one dictionary. |
| Tiering table | `packages/render/develop/tiers` | 09 | A′ is data from one owner; layer code queries it and never copies key lists. |
| Export naming/spec/history | `packages/render/export` | 01/05 | One exporter consumes render artifacts; identity and developed exports are modes of the same pipeline. |
| Search fusion | `packages/library/search` | 12 | One RRF owner; worker and CLI do not implement ranking. |
| Provider gateway adapter | `packages/providers/gateways/vercel` | 16 | Vercel-specific auth and wire format do not leak into command handlers. |
| Per-model edit behavior | `packages/providers/models/*` | 16 | Mask polarity, prompt hints, warnings, and dimension normalization are model-adapter concerns. |
| Fixed model table | `packages/config/models` | 16 | No capability discovery or duplicated defaults. |
| Layer persistence/state | `packages/render/layers` | 13 | Selection, filled pixels, vacancy, and markup use one layer noun/table. |
| Layer transforms | `packages/render/transforms` | 13 | Scale→rotate→translate matrix is computed once and exported to renderer/tests. |
| Effective masks and strict composite | `crates/photoctl-image/composite` | 17 | Strictness is enforced above provider adapters; no adapter claims bit-exactness. |
| Segmentation geometry | `crates/photoctl-image/segment` | 14 | SAM owns mask prediction; Gemini supplies only coarse boxes. |
| Prompt templates | `packages/providers/prompts` | 17/19 | Commands reference versioned prompt IDs; no copied prompt strings. |
| Test oracle/fixture facts | `packages/test-harness` and `fixtures/README.md` | 01 | Tests read fixture metadata/provenance from one manifest. |

There are no compatibility wrappers. Hard cutovers are made within the introducing slice. The only transitional scaffolding is the slice-01 `best_available → embedded_full` implementation inside the final `renderPhoto` owner; slice 08 expands that implementation in place. The deterministic fake HTTP gateway is test infrastructure at an external boundary and remains useful; it is not a production provider abstraction.

## 4. Playable deliverables per slice

| Slice | Playable evidence |
|---|---|
| 01 | Keyless init/import/show/export; open a 7008×4672 JPEG. |
| 02 | Daemon status/stop/autostart, `--no-daemon`, contention probe, migration/restore report. |
| 03 | Re-import, cull loop, offline preview/list/show, moved-file identity demonstration. |
| 04 | XMP write/stale/sync round-trip against a visible sidecar. |
| 05 | Named 2048px delivery batch with IPTC, ICC, template, and collision behavior. |
| 06 | CIRAWFilter JPEG and decoder provenance report. |
| 07 | LibRaw JPEG, linkage report, and camera-matrix evidence. |
| 08 | Three-way embedded/CIRAW/LibRaw decoder-oracle HTML report. |
| 09 | Neutral/people/high-contrast contact sheet and inspectable develop JSON. |
| 10 | Crop and retouch contact sheets, each judging one visual variable. |
| 11 | TOAST reproduction report; optional redacted embedding-request report. |
| 12 | Background embed progress and deterministic hybrid-search results. |
| 13 | Layer transform/reorder fixture page with asymmetric masks. |
| 14 | SAM CPU benchmark and deterministic mask report. |
| 15 | Local point/box/brush selection and structured text-to-layer dry run. |
| 16 | Provider doctor output, canned-model request report, optional keyed smoke results. |
| 17 | Strict composite report proving unmasked-pixel equality. |
| 18 | Complete person-move flow, including visible magenta vacancy and warning-bearing export. |
| 19 | Stubbed and optional live reimagine/relight/generate/auto-enhance artifacts. |
| 20 | Markup fixture page and flattened JPEG. |
| 21 | Real-drive gold-exam JPEGs and evidence report. |
| 22 | Clean packed installation executing the same gold exam. |
| 23 | Optional CLI/MCP contract-equivalence demonstration. |

Every produced image/contact sheet/report is opened with `preview-shots`. Before acceptance, an unprimed `screenshot-critique` is mandatory. Where a prior/reference render exists, `compare-screenshots` records telemetry and the less-wrong verdict.

## 5. Risks and fog

| Risk | Owning slice | Required spike or sub-slicing |
|---|---:|---|
| Slice 01 contains several seams because the first checkpoint must end in a JPEG. | 01 | Implement as four red/green tracer bullets—init, import, show, export—without landing intermediate public APIs. If it exceeds one reviewable pass, use 01A protocol/library boot and 01B importer/render, but merge only when the four-command artifact works. |
| PGlite silently loses concurrent writes. The measured no-lock result was 51/201 surviving rows, while the daemon path was 111 ms versus 1756 ms at eight clients. | 02 | Re-run the parent `spike/` topology under Node 24, then pin actual rows and values. Never infer safety from successful client exit codes. |
| Duet has two divergent lock notions and treats `EPERM` as alive ([`pglite.ts:886`](/Users/david/dev/duet-agent/src/memory/pglite.ts:886)). | 02 | Implement one file-lock owner first, falsify stale/live/unknown PID tests, then add daemon spawn. |
| A first schema upgrade may accidentally test only a fresh database. | 02/03 | Commit `schema-v1.pgsql` before `0002`; every later migration test restores that dump and checks actual photo/locator values. |
| Full embedded JPEG offset parsing might be camera-specific. | 01/03 | Keep extraction behind importer-owned `EmbeddedPreviewIndex`; add fixtures for each new format before generalizing. Do not call it a RAW decoder. |
| CIRAWFilter may initialize with junk, requires identifier hints, and has not been proven under SSH. | 06 | Separate 06A protocol/build, 06B validity probe, 06C SSH/headless functional gate. Failure leaves LibRaw as portable decoder but does not permit a fake-success CIRAW adapter. |
| Vendored LibRaw build and redistribution are unfamiliar. | 07 | Separate 07A CDDL source/vendor manifest, 07B minimal FFI decode, 07C napi platform packages/linkage audit. Kill the slice if it links Homebrew libomp or a ≤0.21 binding. |
| Decoder renders differ by design; a zero-difference oracle would be dishonest. | 08 | Measure per-channel error, highlight-tail error, and orientation separately on `a7c2.ARW`; record a tolerance from known white-level differences rather than tuning until green. |
| Apple-like brilliance/vibrance practice is uncertain. | 10 | Sub-slice by visual variable: tone/local-light architecture first, vibrance/skin protection second. Never approve the entire look from one contact sheet. |
| Wide-vector PGlite TOAST corruption under UPSERT is unresolved. | 11 | Mandatory deterministic 0.5.8 reproduction before slice 12. If reproduced, choose a safe write/rebuild design in a separate 12A; do not copy the drop/rebuild workaround blindly. |
| Multimodal Gateway embedding request shape is undocumented. | 11 | With-key smoke test 2 records an accepted request. Until then, embeddings use the fake external gateway; production remains manual/unconfigured. |
| Worker fairness depends on two timing systems. | 12 | Measure poll ceiling and inter-batch yield together under Node 24. The existing code admits the 250 ms yield cannot guarantee a 1000 ms polling window ([`embedding-worker.ts:52`](/Users/david/dev/duet-agent/src/memory/embedding-worker.ts:52)). |
| SAM 2.1 model size, packaging, and CPU latency are not bounded. | 14 | 14A acquisition/license, 14B deterministic CPU inference, 14C packaging/resource gate. CoreML is a later measured optimization only if D40 passes. |
| Mask polarity differs between model families. | 16 | With-key smoke test 1 precedes any live fill. Until recorded, every test uses a model adapter whose fixture declares polarity explicitly. |
| Provider models may resize or edit the whole image. | 16/17 | Adapters always request PNG and normalize dimensions. Strict composite is independently checked above the model. Whole-image warnings under strict are hard provider failures. |
| Full person-move combines local geometry, two paid calls, stale transitions, and export. | 18 | Keep 18A move/vacancy local, 18B outpaint/fill, 18C A′ tiering/export warning. The final integration test composes already-proven seams. |
| Stochastic live generation cannot have a single-image golden assertion. | 17–19 | Exact tests use canned pixels. Live quality checks use fixed prompts/seeds where supported and human evidence; invariants remain exact, aesthetics remain reviewable rather than snapshot-equal. |
| Real removable-volume behavior and Classic metadata are absent now. | 21 | Keep `a7c2.ARW` plus deterministic XMP/mount fixtures until the drive arrives. Real-drive acceptance adds evidence; it does not rewrite identity or XMP APIs. |
| Native package cross-architecture support may hide deployment-target issues. | 22 | Build/test darwin-arm64 first, then a separate darwin-x64 packaging sub-slice; inspect linked libraries and deployment target before publishing. |

## 6. Non-blocking human checkpoints

Each checkpoint follows the same rule: open the named evidence with `preview-shots`, tell David the one variable being judged, allow roughly five minutes for feedback, then—if silent—decide from test results plus visual telemetry, record the verdict/rationale in the spec, close Preview, and continue.

| After | Evidence and decision |
|---|---|
| 01 | Embedded full-size JPEG. Decide only whether it opens, is correctly oriented, and is not visibly corrupt. |
| 05 | Delivery batch. Decide filename grammar, collision behavior presentation, and whether the 2048px/quality defaults are sensible. |
| 06 | CIRAW versus embedded. Decide framing/orientation only; defer color judgment. |
| 08 | Decoder-oracle report. Decide whether measured color/highlight tolerance represents “not broken.” |
| 09 | Three-preset contact sheet. Decide reversible preset values; storage and tier semantics do not reopen. |
| 10A | Crop contact sheet. Decide horizon/framing behavior only. |
| 10B | Retouch crops at 100%. Decide seam visibility only. |
| 13 | Layer fixture report. Decide transform ergonomics and initial blend-mode subset. |
| 14 | SAM report. Decide acceptable local latency/RSS after correctness is established. |
| 17 | Strict composite zoom/crop. Decide mask-edge quality; bit-exact outside-mask behavior is automatic. |
| 18 | Person-move sequence. Decide vacancy presentation and whether stale/unfilled warnings are sufficiently visible. |
| 19 | One artifact per generative verb. Decide prompt/default-model taste independently for each. |
| 20 | Markup fixture. Decide cosmetic defaults only. |
| 21 | Three real gold-exam JPEGs. Decide professional “not broken” acceptance and whether `people` needs a final data-only retune. |

Credential, drive, and Classic-export checkpoints are opportunities to replace placeholders, not blockers. If absent, the implementing agent records which live evidence remains pending and continues all deterministic work.

## 7. Scope firewalls

| Slice(s) | Explicit firewall |
|---|---|
| 01–05 | No GUI, MCP, cloud sync, multi-user server, Photos library access, or gateway call. No RAW-byte modification. |
| 01–03 | Do not generalize locator storage into sync or multi-machine replication. Scope is this Mac plus one removable volume. |
| 02 | No automatic quarantine, empty-library recovery, directory clones, backward-compatible schema reads, down migrations, or silent lock degradation. |
| 03 | No Live Photos, Portrait-mode reconstruction, face recognition, maps, or books. |
| 04 | Ratings, keywords, flags, labels, and supported develop metadata only; no Lightroom catalog parser or Adobe history migration. |
| 05 | JPEG/TIFF/PNG delivery only; no print pipeline, gallery hosting, cloud upload, or video export. |
| 06–08 | No AppKit dependency in core. CIRAW is isolated. LibRaw is the only vendored RAW library. No darktable, ART, RawTherapee, digiKam, A1111, Forge, or Comfy subprocess/runtime. |
| 07 | No GPL-linked code, rawler as production decoder, bundled Adobe DCP, AgX asset without a license, or Homebrew runtime dependency. |
| 08–10 | No Camera Matching, local HSL, proprietary Apple curve cloning, or second render graph. Implement the fixed architecture, not reverse-engineered constants. |
| 10 | No learned denoise, unblur, local generative retouch, Metal/ONNX/CoreML generative inference, or NAFNet shipment. The measured NAFNet assets remain deferred under D39. |
| 11–12 | Embeddings are only `google/gemini-embedding-2`; no free-tier processing of private libraries, text-model fallback, or surprise auto-enabling without `init --embed`. |
| 13–18 | No separate mask table/domain noun, coordinate convention, transform system, or provider-owned composite. |
| 14–15 | SAM 2.1 is geometry, CPU by default. No SAM 3, macOS 27-only Vision API, gateway segmentation, or local text-grounding model. |
| 16–19 | Vercel Gateway only in v1. OpenRouter is enabled later by a new `GatewayAdapter`, not by a v1 wrapper around Vercel. No capability discovery or feature-specific generation models. |
| 17–18 | No provider promise is trusted for strictness; no paid regeneration for pure transforms; no refusal to export merely because a layer is stale or vacancy unfinished. |
| 19 | `unblur` remains cut. `restore` is reserved, not a disguised generic image-generation command. Relight/reimagine declare full-frame drift. |
| 20 | Markup is vector overlay only; no document editor, collaboration, or richer UI-only editing. |
| 21–22 | No scope expansion from gold-exam feedback beyond import→cull→develop→deliver. Taste changes may edit preset/prompt data; architecture changes require reslicing. |
| 23 | MCP cannot add verbs, richer parameters, direct database access, or UI-only capability. |

## 8. OPEN-item landing and placeholders

| OPEN map item | Landing slice | Placeholder until resolved | Resolution condition |
|---|---:|---|---|
| ARW drive path | 21 | Committed `fixtures/a7c2.ARW`; synthetic mounted-volume directories for locator/offline tests | Drive is mounted and David supplies its folder path; run the real import/offline/gold evidence without changing APIs. |
| Vercel Gateway key and per-verb model IDs | 16, then 17–19 | Fake HTTP gateway with canned asymmetric PNGs, boxes, and vectors; defaults proposed by the map: fill/outpaint/reimagine/generate `openai/gpt-image-2`, grounding/auto-enhance `google/gemini-3.1-flash`, embeddings `google/gemini-embedding-2` | Key is supplied, `doctor` resolves each configured ID, and live model IDs are recorded in the fixed table. |
| Smoke test 1: image-edit mask polarity | 16 before live slice 17 | Fixture adapters explicitly declare polarity; no unverified live native mask use | One controlled half-black/half-white edit through `POST /v1/images/edits` proves which pixels gpt-image-2 edits; store the redacted request, input/mask/output hashes, and verdict. |
| Smoke test 2: multimodal Gemini embedding request shape | 11 before production slice 12 | Fake gateway returns deterministic `halfvec(3072)`; real embedding mode remains manual/unconfigured | One image request to `google/gemini-embedding-2` succeeds through Vercel, dimensions/model ID are validated, and the redacted accepted shape is captured as a fixture. |
| Lossless-L compression tag 6 versus 7; M/S pseudo-RAW behavior | 07 and 08 | Uncompressed `a7c2.ARW`; decoder schema already carries `as_shot_wb_applied` | Add one known-camera frame per lossy/L/M/S mode. Assert LibRaw decode for all, record rawler only as an oracle probe, and confirm M/S suppress duplicate WB. This does not block uncompressed A7C II v1. |
| PGlite TOAST `missing chunk number 0` under wide-vector UPSERT | 11, gating 12 | Text search and embedding queue schema disabled; deterministic small vectors only in fake request tests | Reproduce or clear on exactly PGlite 0.5.8 and `pglite-pgvector` 0.0.9 with `halfvec(3072)`. If reproduced, 12A selects and verifies a safe schema/write/migration strategy before worker shipment. |
| Founder checklist timing before Adobe subscription ends | 04 and 21 | Deterministic Classic-style XMP fixture plus `fixtures/a7c2.ARW` | On the other machine, export Classic 4–5★ masters and write sidecars; record completion date and copied/linked source path. If timing arrives before slice 21, ingest the artifacts into slice 04 fixtures immediately without blocking unrelated implementation. |
