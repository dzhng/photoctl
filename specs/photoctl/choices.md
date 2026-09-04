# Implementation choices

## Sound

### Slice 05/08a2 integration — Source decode failures cross the evaluator as a distinct error

- **When:** Slice 05 canonical-evaluator integration review.
- **The choice:** Export first asks the graph evaluator to render from the best online locator. If those source bytes cannot be
  decoded, the evaluator throws `SourceEvaluationError`, so export can retry the same immutable output node from its pinned preview.
  A different failure—such as reaching a develop node whose pixel operation has not shipped—keeps its original error and becomes
  `decoder_unavailable`; it never triggers a misleading source fallback. The alternative was to inspect error-message text or retry
  every evaluator failure as though the original file were offline.
- **The gap:** The evaluator accepted a structured source locator but did not distinguish failure to decode that source from failure
  to evaluate the graph above it, while export's offline contract requires different handling for those cases.
- **The reach:** Preview and export callers can make source-tier fallback decisions without importing the renderer's private source
  decoder or coupling to error wording. Future evaluator operations remain unable to silently turn into source pixels after failure.
- **Verdict:** **Sound.** The error class marks the exact component boundary where recovery differs and preserves the private decoder
  seam.
- **Confidence:** High.

### Slice 05 review — TIFF delivery metadata is embedded in-process

- **When:** Slice 05 delivery-export correctness review.
- **The choice:** Sharp asks its underlying image library, libvips, to encode each TIFF. That path keeps the XMP packet—the metadata
  block used by Adobe-style tools—but drops the native TIFF `Artist` and `Copyright` fields even when Sharp is given both. After
  encoding, photoctl therefore appends a replacement first image-file directory (IFD), the TIFF table that points to pixels and
  metadata. It copies every existing table entry and offset unchanged, adds the two standard text tags, and points the TIFF header
  at the replacement table. The alternative was to invoke a separately installed metadata executable after every export or add a
  second image-processing dependency solely to rewrite two fields.
- **The gap:** The slice requires EXIF-compatible creator and copyright metadata in TIFF, but does not choose how to work around the
  encoder dropping those fields.
- **The reach:** TIFF export remains one in-process durable write with no machine-level executable dependency. If Sharp/libvips later
  preserves these native tags itself, the tested metadata owner can remove the directory rewrite without changing the export API.
- **Verdict:** **Sound.** It repairs the standard TIFF structure before publication and keeps deployment self-contained; round-trip
  tests verify both native fields, XMP, and 16-bit pixel samples.
- **Confidence:** High.

### Slice 05 — Delivery publication wins safety over perfectly atomic history

- **When:** Slice 05 delivery export and closeout review.
- **The choice:** An export crosses two durable systems: the filesystem that holds the JPEG/PNG/TIFF and the PGlite database that
  records its history. Photoctl first publishes and synchronizes the complete file, then inserts the history row. For example, if
  the database write fails after `/delivery/client.jpg` reaches disk, the photographer still has a valid but unrecorded file. The
  reverse order could leave a durable history row pointing at a partial or nonexistent delivery after a crash. Ordinary writes use
  atomic no-replace publication where hard links are supported, while explicit overwrite is the only path allowed to replace an
  existing name. Filesystems that reject hard links fall back to exclusive destination creation, followed by write and fsync;
  failure removes the partial file and an existing name is never replaced. That fallback preserves no-clobber semantics, but a
  concurrent reader can observe the destination while it is still being written because Node exposes no portable atomic
  rename-with-no-replace primitive.
- **The gap:** The plan required durable output, history, and no unasked clobbering, but a filesystem rename and a database insert
  cannot participate in one shared transaction.
- **The reach:** Export retries may discover an unrecorded file and apply the requested collision policy, but catalog history never
  promises a delivery that had not yet been published. Future history reconciliation must preserve this ordering.
- **Verdict:** **Sound.** It chooses the recoverable orphan over a false durable claim and makes destructive replacement explicit.
- **Confidence:** High.

### Slice 05 — Library presets shadow package presets and CLI metadata merges by field

- **When:** Slice 05 preset implementation.
- **The choice:** When both the installed package and a library contain a preset called `delivery`, the library file wins because it
  is the photographer's local policy. Command-line values then win over that file. Metadata overrides are field-by-field: passing
  `--iptc creator=Alice` keeps the preset's copyright instead of erasing the whole metadata block. The alternative would either make
  built-in names impossible to customize or make one small command-line override silently discard unrelated preset values.
- **The gap:** The plan named package and library preset locations plus CLI precedence, but did not define same-name lookup order or
  whether the two metadata fields merge together or replace as one object.
- **The reach:** Libraries can carry portable house delivery policy while one export can change a single value without copying the
  entire preset. Future preset fields should follow the same specific-over-general precedence.
- **Verdict:** **Sound.** The closest user-owned configuration wins, and narrow overrides remain narrow.
- **Confidence:** High.

### Slice 04 — Sampled identity keeps a narrow relocation inference and an mtime replacement boundary

- **When:** Slice 04 identity integration and collision audit.
- **The choice:** A second path with the same sampled key reuses an unpromoted photo only when its old path is absent on the
  same confirmed-mounted volume, which is the explicit rename case. An offline or unknown old volume refuses the import because
  the old bytes cannot be compared. At the exact same locator, unchanged stored mtime remains idempotent; changed mtime refuses
  an unpromoted match rather than blessing a replacement whose middle bytes may differ. When an old source is readable, both
  files receive full hashes and the bucket is promoted before identity is decided.
- **The gap:** Collision safety says not to infer equality from the sample, while the required `mv` contract says a missing old
  path on the same online volume retains its ID. Exact-locator replacement had a similar ambiguity that the stored mtime can
  distinguish without hashing every initial import.
- **The reach:** Rescans preserve IDs for the named same-volume rename and ordinary unchanged file, but refuse every unavailable
  case outside that boundary; promoted buckets use cryptographic equality thereafter.
- **Verdict:** **Sound.** The inference is no broader than the explicit relocation contract and uncertainty elsewhere fails safe.
- **Confidence:** Medium; a same-volume delete followed by an adversarial sampled collision is indistinguishable without an
  always-full-hash policy.

### Slice 04 — Copy mode has one catalog-local volume identity

- **When:** Slice 04 copy/import integration.
- **The choice:** Library-owned originals use the stable volume UUID `photoctl-library`, scoped by the library database, and paths
  remain relative to that library root. Resolution handles this UUID directly, so list/show/export do not need
  `PHOTOCTL_VOLUME_MAP`; on macOS the resolved path is still mapped to its physical mount before Trash selection. Reusing a copy
  destination compares the full hash whenever the identity bucket is promoted.
- **The gap:** External volumes have hardware UUIDs, but a library-owned original needs a durable locator that survives moving
  the whole library and cannot depend on a test-only mapping.
- **The reach:** Copy import, offline source removal, display, export, and volume-aware Trash share one stable locator rule.
- **Verdict:** **Sound.** The identity is stable where it must be and deliberately local where a global UUID would be misleading.
- **Confidence:** High.

### Slice 04 — Streams retain only bounded pages and honor consumer backpressure

- **When:** Slice 04 drive-scale and daemon transport review.
- **The choice:** Import retains at most four prepared candidates and commits them in scan order. List reads 64-photo pages,
  emits one row frame at a time, and awaits socket then stdout consumption. Progress events use the same live path. The terminal
  stream envelope contains `{rows:[],total}` so neither daemon client nor CLI accumulates a second copy. Frame encoding and
  decoding both enforce 16 MiB, and import uses a ten-minute activity-reset idle timeout rather than the ordinary 31-second cap.
- **The gap:** Capping worker count alone still retained every preview buffer; similarly, framing rows without awaiting writes
  merely moved an unbounded queue into Node streams. A fixed ordinary timeout also abandoned the authoritative 56-second import.
- **The reach:** Drive-size affects total work, not retained preview/row/event memory, while a silent hung daemon still fails.
- **Verdict:** **Sound.** Ordering, bounded memory, live telemetry, and failure detection now agree across direct and daemon paths.
- **Confidence:** High.

### Slice 04 — Disk removal stages reversible receipts before catalog commit

- **When:** Slice 04 removal implementation and failure audit.
- **The choice:** Source and cache paths move first and return rollback receipts; only then does the catalog transaction delete
  the photo. A pre-commit failure restores receipts in reverse order. Any rollback failure becomes a typed unavailable error with
  every unrestored path instead of being swallowed; after database commit, cleanup failure cannot roll the catalog backward.
- **The gap:** A filesystem move and PGlite transaction cannot be one atomic operation, and silent rollback errors falsely claim
  the source still exists.
- **The reach:** `remove --from-disk`, cache cleanup, partial batches, and removable-volume failures expose the truthful durable state.
- **Verdict:** **Sound.** The only irreversible boundary is the catalog commit, with recovery evidence on every earlier move.
- **Confidence:** High.

### Slice 03b — Restore recovery trusts durable topology, not the last journal phase

- **When:** Slice 03b restore implementation and crash-window review.
- **The choice:** Restore writes absolute live, stage, rollback, and source paths whose stage and rollback names share one UUIDv4 token. Recovery rejects any other path grammar or non-directory/symlink target, locks every surviving tree, and chooses rollback from the trees that actually exist rather than assuming the last journal phase reached disk. A `committed` phase is published before rollback deletion, so recovery after that boundary only finishes cleanup and never replaces the promoted library. The shared lock-holding open path also rejects a journal, so an adopted daemon lock cannot bypass this boundary; only restore's own post-promotion verification opts into the journaled tree.
- **The gap:** The plan required a durable journal and rollback but did not define write/rename crash ordering or how stale phase data is reconciled with filesystem state.
- **The reach:** Every process interruption between journal writes, directory renames, verification, and recursive cleanup has a single bounded recovery action without authorizing deletion of arbitrary siblings.
- **Verdict:** **Sound.** The filesystem is the observable truth after a crash, while the committed marker separates rollback-safe work from cleanup-only work.
- **Confidence:** High.

### Slice 03b — Successful restore returns only durable public facts

- **When:** Slice 03b protocol review.
- **The choice:** The success envelope is `{library,from,schema_version}`. It omits the proposed `previous_library` and `rollback_removed` fields because successful verification deliberately removes the rollback directory; returning that dead path would imply a usable artifact that no longer exists.
- **The gap:** Early implementation guidance suggested exposing the rollback path even though the lifecycle contract removes it.
- **The reach:** Automation can rely on every returned path existing for its documented purpose and does not mistake internal crash-recovery machinery for retained history.
- **Verdict:** **Sound.** The protocol describes the committed postcondition rather than implementation residue.
- **Confidence:** High.

### Slice 03b — Migration history must be the exact known prefix

- **When:** Slice 03b migration runner.
- **The choice:** Before applying anything, the runner sorts the recorded versions and accepts only `[]`, `[1]`, `[1,2]`, through the current complete prefix. Future, duplicate, missing, or gapped ledgers fail. Current-schema verification also requires the named tables, constraints, and explicit locator index, so a dump truncated before post-data constraints cannot be promoted. A persistent handle consumes its startup migration result once; later `migrate` actions query current state and report no newly applied versions.
- **The gap:** Merely comparing the maximum recorded version with `LATEST_SCHEMA_VERSION` makes a gapped catalog look current, and caching the startup result makes repeated daemon commands lie.
- **The reach:** Restore validation, direct migration, and repeated daemon migration share one truthful forward-only contract.
- **Verdict:** **Sound.** Exact-prefix validation prevents partially known schemas from being blessed and keeps command results action-scoped.
- **Confidence:** High.

### Slice 03b — pgDump cleanup is part of the narrow backup capability

- **When:** Slice 03b backup integration.
- **The choice:** `LibraryHandle.dumpSql()` exposes text rather than the raw PGlite object. It uses `pgDump` and then commits in a `finally` block because the tool leaves the shared session in a read-only transaction; callers receive `file.text()` only after the session is returned to writable operation.
- **The gap:** The package API supplies `pgDump` but no restore function and does not clean up the shared session for the daemon's next command.
- **The reach:** Manual and automatic backup can share the daemon handle without making subsequent imports or tags fail, while the database implementation remains private to the library package.
- **Verdict:** **Sound.** The capability is narrow and restores the session invariant even when dumping throws.
- **Confidence:** High.

### Slice 03b — Backup durability precedes retention

- **When:** Slice 03b backup publication.
- **The choice:** A snapshot is written to a unique temporary file, fsynced, renamed, timestamped, and followed by a backup-directory fsync before rotation. Removals receive another directory fsync. Recency comes from the ISO creation time and collision suffix encoded in photoctl's filename rather than mutable mtimes, so copying history during restore cannot reorder it. The newest snapshot survives even when it alone exceeds 200 MiB, with a typed warning, and restore copies SQL history into the staged library with per-file durability rather than cloning a database directory.
- **The gap:** The plan fixed the retention numbers but did not specify publication ordering, oversized-newest behavior, or how backup history crosses a restore swap.
- **The reach:** Power loss cannot expose a half-written snapshot or lose a newly published directory entry merely because retention started, and restored libraries keep their SQL recovery history.
- **Verdict:** **Sound.** Publication establishes the replacement artifact before optional cleanup and preserves the no-directory-clone firewall.
- **Confidence:** High.

### Slice 03b — Restore fault hooks are test-only lifecycle seams

- **When:** Slice 03b crash testing.
- **The choice:** The library restore options expose callbacks immediately before initial journal publication, after each directory rename, and during rollback cleanup. CLI users and environment variables cannot select them; tests use them to terminate a real child process at exact durability boundaries.
- **The gap:** Ordinary exception injection cannot prove behavior after an uncatchable process exit between two filesystem operations.
- **The reach:** Crash regressions can falsify journal ordering without adding production flags or parsing special environment state.
- **Verdict:** **Sound.** Narrow programmatic seams make the destructive boundaries testable without broadening the public CLI contract.
- **Confidence:** High.

### Slice 02b — Human output neutralizes terminal controls and row delimiters

- **When:** Slice 02b human renderer.
- **The choice:** Suppose a tag, path, error message, or warning contains a newline, tab, or terminal
  escape byte. The human renderer writes a visible escaped spelling such as `\\n` or `\\u001b`, and a
  pipe inside a table cell becomes `\\|`. One logical value therefore stays on one table row and cannot
  inject a new column or a terminal control sequence. The JSON envelope is untouched; this applies only
  when a person explicitly asks for `--human`.
- **The gap:** The plan required deterministic readable text but did not say how to display control
  characters originating in user or filesystem data.
- **The reach:** Every current and future command can safely reuse the generic renderer without each verb
  sanitizing its own values or changing its machine-readable result.
- **Verdict:** **Sound.** Escaping preserves the information while protecting row boundaries and terminals.
- **Confidence:** High.

### Slice 02b — Failures without a supplied message get a label derived from their code

- **When:** Slice 02b human renderer.
- **The choice:** Some failures, such as a mixed batch returning `code:"partial"`, have result rows and a
  summary but no top-level message. Human output prints `Error [partial]: Partial failure`; when a command
  does supply a message, that exact message wins. The alternative would print a bare code for some
  failures even though the human-output contract promises both a stable code and an explanation.
- **The gap:** The plan required failure messages, while the envelope permits failure `data` and therefore
  its `message` field to be absent.
- **The reach:** Future error codes automatically receive a readable label without adding presentation
  branches to command handlers or widening the protocol.
- **Verdict:** **Sound.** Presentation fills a presentation-only gap while the typed envelope remains the
  sole machine contract.
- **Confidence:** High.

### Slice 03a — Preview provenance is cryptographically bound to the JPEG bytes

- **When:** Slice 03a preview-cache lifecycle.
- **The choice:** A derived preview is two files: the JPEG an agent opens and a small JSON sidecar explaining which
  source tier and source dimensions produced it. The sidecar now also stores the JPEG's SHA-256 digest, a compact
  fingerprint of the exact bytes. On read, photoctl recomputes that fingerprint and rejects the pair if it differs.
  For example, if power fails after a new JPEG is renamed but before its new sidecar is renamed, the old explanation
  cannot accidentally bless the new pixels; the next `show` repairs the pair. Cache accounting charges both files,
  because both are required for one usable artifact.
- **The gap:** The plan required atomic artifact writes and provenance validation but did not define how two separately
  renamed files prove they belong to the same completed write, or whether sidecar bytes count toward the cache limit.
- **The reach:** Every later develop, layer, fill, and markup preview can trust cached provenance after a crash, and
  `cache prune --max` measures all bytes that must survive together rather than hiding metadata overhead.
- **Verdict:** **Sound.** Content binding turns a two-file crash window into a detectable cache miss, which is safely
  regenerated from canonical state.
- **Confidence:** High.

### Slice 03a — Prune claims each path before deleting and lets a concurrent touch win

- **When:** Slice 03a cache-prune pass.
- **The choice:** Pruning takes one clock snapshot, pages old rows in bounded least-recently-used order, then asks the shared
  preview coordinator for an exclusive lease on each path. It conditionally deletes the database row only if
  `last_used` is still older than the snapshot's 30-minute cutoff. If `show` validated and touched the preview after
  the list was captured, that condition fails and the file stays. If prune claims first, a new materializer waits;
  after deletion it regenerates instead of receiving a disappearing path. A filesystem failure restores the row,
  records the first error, and continues with later candidates before reporting failure.
- **The gap:** The plan named leases, a captured prune time, and a concurrent-touch test, but did not choose the
  database/filesystem ordering or specify whether one undeletable file stops the entire LRU pass.
- **The reach:** Agents can inspect a returned path without a simultaneous cleanup invalidating it, and a permanently
  bad cache entry cannot starve every newer candidate on repeated prune runs.
- **Verdict:** **Sound.** The lease closes the file race, the conditional claim closes the stale-query race, and
  per-item failure isolation preserves forward progress.
- **Confidence:** High.

### Slice 03a — `cache prune` reports budget movement and accepts zero as an explicit purge target

- **When:** Slice 03a command contract.
- **The choice:** A successful prune returns four integer byte counters: artifacts removed, bytes freed, bytes still
  indexed, and the requested maximum. `--max` uses the same binary byte units as library initialization, but explicitly
  accepts `0B`; that means “remove every eligible derived artifact” while still protecting pinned, recent, and leased
  files. Without `--max`, the command uses the library's stored cache budget.
- **The gap:** The slice named `cache prune [--max]` but did not define its result envelope or whether zero is a valid
  operator-requested budget.
- **The reach:** Scripts can verify whether cleanup actually made progress and can deliberately clear regenerable
  previews without deleting offline source previews or model assets.
- **Verdict:** **Sound.** The counters expose the result without requiring filesystem inspection, and zero is a useful,
  reversible operation on explicitly prunable data.
- **Confidence:** Medium.

### Slice 03a — Cache-index paths are relative to the active per-library cache root

- **When:** Slice 03a integration review.
- **The choice:** The database stores `view/<photo>/<render>/<artifact>` rather than the machine's absolute cache
  directory. A `CacheIndex` adapter receives the active per-library root and translates at its boundary. If an operator
  changes `PHOTOCTL_CACHE`, the same logical rows point into the new root: `show` recreates missing artifacts there and
  prune can remove stale accounting for files that are absent. The abandoned physical files under the old override are
  outside the newly selected cache and are no longer managed until that old root is selected again or removed directly.
  Storing absolute paths instead would let one catalog accumulate rows for multiple overrides and make the current
  budget impossible to satisfy because prune must not delete outside its active root.
- **The gap:** The plan made the cache base overrideable and the database portable, but did not define whether cache
  index identities include a machine-specific root or how switching the override reconciles soft cache state.
- **The reach:** Backup/restore in 03b does not bake one machine's cache directory into the catalog, while every cache
  producer and pruner resolves paths through the same current-root adapter.
- **Verdict:** **Sound.** Cache files are regenerable local state, so portable logical identities are safer than
  permanently accounting for an inactive machine path.
- **Confidence:** Medium.

### Slice 02 — Daemon startup transfers the already-held kernel lock

- **When:** Slice 02 daemon lifecycle.
- **The choice:** The starting CLI inherits its locked file descriptor into the detached daemon as fd 3;
  the daemon rewrites the same lock payload and keeps that descriptor for its full PGlite lifetime.
- **The gap:** The plan required the client to take the lock and the daemon to own it, but did not define
  an atomic handoff mechanism.
- **The reach:** Every auto-start, version replacement, direct-mode transition, and crash recovery keeps
  the one-writer guarantee without a release/reacquire window.
- **Verdict:** **Sound.** Descriptor inheritance preserves continuous kernel ownership.
- **Confidence:** High.

### Slice 02 — Initialization is the sole in-process bootstrap command

- **When:** Slice 02 command routing.
- **The choice:** `init` dispatches directly because its target is not yet a library, closes that handle,
  then starts the daemon. All commands against an existing library use the daemon unless explicitly
  passed `--no-daemon`.
- **The gap:** A daemon cannot lock or open a PGlite directory before `init` creates it.
- **The reach:** The public init result remains unchanged while a successful init immediately leaves the
  new library daemon-served.
- **Verdict:** **Sound.** It is a bootstrap boundary, not a parallel database access path.
- **Confidence:** High.

### Slice 02 — Daemon transport has a bounded length-prefixed frame

- **When:** Slice 02 transport implementation.
- **The choice:** Frames use a four-byte big-endian JSON byte length and reject payloads above 16 MiB.
  The daemon log is a socket-identity-derived file in the OS temporary directory, beside neither the
  library nor its source photos.
- **The gap:** Frame encoding and log location were explicitly delegated.
- **The reach:** Request, streamed-event, response, and control messages share one decoder that tolerates
  arbitrary socket chunking; runaway lengths cannot allocate unbounded memory.
- **Verdict:** **Sound.** The format is deterministic, dependency-free, and safely bounded.
- **Confidence:** High.

### Slice 02 integration — Initialization success survives an optional daemon-start failure

- **When:** Slice 02 integration review.
- **The choice:** `init` first creates and migrates the durable library, then attempts to start its convenience daemon. If that
  second step fails, the command returns the successful initialization envelope with a `daemon_unavailable` warning. For
  example, a broken packaged daemon no longer makes `init` exit 69 after the library already exists, which made the natural
  retry fail with “library already exists.” The next ordinary command can retry daemon startup against the valid library.
- **The gap:** The plan required initialization to leave a daemon running but did not define partial success after the durable
  creation boundary had committed.
- **The reach:** Initialization is safely retryable from an automation caller's perspective, and warnings distinguish a usable
  catalog from its temporarily unavailable acceleration process.
- **Verdict:** **Sound.** The response follows the irreversible state transition and exposes the recoverable secondary failure.
- **Confidence:** High.

### Slice 02 integration — Daemon control reports observed state and secures local IPC

- **When:** Slice 02 integration review.
- **The choice:** Public `daemon start|status` responses ask the daemon for live state instead of inventing uptime and queue values.
  Ordinary commands take the cheaper endpoint route only when the live lock payload names the expected versioned Unix socket;
  request failure triggers a probed recovery. `daemon stop` reports failure when a live holder does not answer or does not exit by
  the deadline. Idle connected sockets do not consume request-queue capacity because only framed work is a request. When an idle
  queue receives its first request, one 5 ms admission window coalesces simultaneous socket arrivals before serial execution; the
  caller's lock-wait budget starts after that transport window. Recovery attempts the advisory lock before classifying a
  live-looking PID/socket pair as an unresponsive owner, allowing stale artifacts with a reused PID to be replaced. The Unix
  socket and current log are owner-only (`0600`), and each daemon start truncates the prior log instead of appending across restarts.
- **The gap:** The daemon slice fixed the transport and queue ceiling but left probe truthfulness, idle-connection admission,
  burst admission, filesystem permissions, and failed-stop reporting implicit.
- **The reach:** Status and lifecycle automation can trust successful control responses; warm commands avoid an extra control
  round-trip; another local account cannot send commands through the socket; unused connections cannot manufacture overload;
  simultaneous work observes the configured queue ceiling; restart logs remain bounded by one daemon run.
- **Verdict:** **Sound.** Observed status remains truthful while endpoint routing stays cheap, recovery remains explicit, and local
  control surfaces use least privilege without changing the protocol.
- **Confidence:** High.

### Spec maintenance — Preview cache safety lands before new render producers

- **When:** Post-slices-02/07a wavefront audit.
- **The choice:** Slice 03a now installs the one preview coordinator, validation-before-touch cache index, materialization leases,
  and prune grace before Slice 08 adds developed render graphs. Without that move, Slice 03 was expected to protect in-flight
  files using machinery the plan did not build until five slices later. Develop now plugs a new producer into the existing
  lifecycle instead of creating a second cache owner.
- **The gap:** A preview-contract amendment added concurrency guarantees after the original dependency graph was written.
- **The reach:** Cache prune, ordinary preview, develop, and later layer previews inherit one writer and one lifetime model.
- **Verdict:** **Sound.** The dependency order now builds the prerequisite before its first consumer and prevents parallel cache
  implementations from drifting.
- **Confidence:** High.

### Spec maintenance — Sampled identity collisions promote only the colliding bucket

- **When:** Post-slices-02/07a wavefront audit.
- **The choice:** Ordinary imports keep the fast head-and-tail content key. When a second file shares that key, Slice 04 computes
  full hashes for both files, stores those hashes on the colliding photos, and then decides duplicate versus distinct. If the
  existing file is offline and has never been promoted, import refuses to attach the newcomer rather than guessing they are the
  same. The rejected alternatives were hashing every file in full or silently merging different middles.
- **The gap:** D9 required a full hash “on collision” but did not define persistence or the unavailable-existing-source case.
- **The reach:** Large-drive import retains its sampled-hash speed while database identity stays collision-safe and repeatable.
- **Verdict:** **Sound.** Work is paid only by the rare ambiguous bucket, and uncertainty cannot corrupt the locator graph.
- **Confidence:** Medium.

### Rendered previews are lazy, versioned views of committed edit state

- **When:** User-directed preview workflow amendment, 2026-09-04.
- **The choice:** Import keeps one immutable pinned source preview for offline recovery. Edited previews are separate,
  prunable JPEGs keyed by canonical edit state (`render_hash`) and viewport (`view_hash`). Pixel-affecting commands commit state
  and return the new render hash without rendering. Preview lazily creates one full-frame display master per render state at
  `view/<id>/<render_hash>/master.jpg`; native full-frame `show` returns it, and crops/smaller views derive from it without
  reevaluating the graph. Before promotion, a cached numeric full-frame view may feed a crop only when it contains enough real
  pixels at that region's scale. The default ≤1616px overview stays cheap and does not force the master. Exact derived views live
  at `view/<id>/<render_hash>/<view_hash>.jpg`. A requested region defaults to native 1:1 source pixels, never an enlarged
  overview. Export snapshots and reports the same render hash at command start, but renders from the graph rather than treating
  the lossy display master as export truth. A new edit or viewport produces a new path rather than overwriting inspected pixels.
  Requests for the same missing artifact coalesce into one render, and preview paths receive a 30-minute post-access prune grace.
  Every preview is opaque, orientation-applied sRGB with an embedded `sRGB2014` profile; the response includes invertible
  base/view transforms and rejects a wholly non-visible region rather than returning a misleading edge pixel.
- **The gap:** The plan exposed the pinned import preview but did not define how an agent sees develop, layer, fill, retouch, or
  markup changes before export.
- **The reach:** `packages/render/preview` owns state/view hashing and materialization; every pixel mutation contributes its
  canonical inputs to the render hash. The mandatory slice-12 journey makes a global edit, creates and inspects the full-frame
  native master, proves a detail zoom crops it without another graph evaluation, makes and adjusts a local fill while inspecting
  each new render state's detail, returns to the final overview derived from the final master, then exports the verified hash.
- **Verdict:** **Sound.** A per-state full-frame display master makes the common full-frame → detail → zoomed-out loop simple and
  makes every later crop cheap, while the sufficiency check prevents a small overview from masquerading as full-resolution detail.
- **Confidence:** High.

### Preview clipping intersects pixel edges instead of moving the requested rectangle

- **When:** Slice 01b preview-contract correction.
- **The choice:** A pixel viewport is treated as an interval with an inclusive left/top edge and an exclusive right/bottom edge.
  For example, `[-50,0,100,100]` asks for pixels spanning from 50 pixels left of the image through pixel 49 inside it, so the
  returned region is `[0,0,50,100]`. Fractional outer edges round outward (`floor` at left/top, `ceil` at right/bottom) before
  the interval is intersected with the image. The rejected alternative was to clamp a negative origin to zero while retaining
  the original width; that silently moves the request and returns pixels the caller never selected.
- **The gap:** The contract required clipping and reporting partial intersections but did not define fractional pixel-edge
  rounding.
- **The reach:** `show.preview_info.actual.region`, projection matrices, visible polygons, and later crop/mask consumers inherit
  the same honest intersection rather than a shifted viewport.
- **Verdict:** **Sound.** Outward edge rounding preserves every pixel touched by the requested continuous rectangle, while
  intersecting endpoints makes the returned geometry a subset of the request.
- **Confidence:** High.

### Lossless tiled masters and progressive UI delivery are later optimizations

- **When:** User-directed preview scope decision, 2026-09-04.
- **The choice:** V1 keeps the full-frame JPEG display master and synchronous `show`. Replacing that master with lossless,
  random-access tiles and letting a UI cancel, prioritize, or progressively refine requests are tracked in the separate preview
  optimization spec. Correctness does not depend on either optimization: `show` still returns a complete readable view.
- **The gap:** The preview audit mixed requirements needed for trustworthy agent inspection with throughput improvements needed
  only once an interactive UI or measured large-image bottleneck exists.
- **The reach:** V1 remains smaller. The future implementation must preserve render/view hashes, coordinates, color, warnings,
  cache lifetime, and export correlation rather than expose a second preview contract.
- **Verdict:** **Sound.** Defer unmeasured storage and latency complexity while leaving a named replacement seam.
- **Confidence:** High.

### Slice 01b importer — EXIF parsing returns source dimensions and leaves orientation geometry to render

- **When:** Slice 01b importer pass.
- **The choice:** A portrait photo can store pixels as a landscape-shaped rectangle plus an EXIF
  orientation number that says how a viewer must rotate or mirror it. The importer reports that stored
  rectangle and the orientation number separately. The import command then asks render's coordinate
  module for the oriented dimensions before writing the photo row. The alternative was for importer and
  render to each decide that orientations 5–8 swap width and height; those two copies could later
  disagree on the same photo.
- **The gap:** The plan says database dimensions are oriented and names render as the coordinate owner,
  but it does not define whether the EXIF reader returns stored or already-oriented dimensions.
- **The reach:** The 01b integration must call render's `orientedDimensions` once. Future decoders,
  crops, and masks then inherit one orientation rule instead of recreating it at every metadata edge.
- **Verdict:** **Sound.** It keeps parsing at the file boundary and geometry in the module that owns
  coordinate transforms.
- **Confidence:** High.

### Slice 01b importer — Missing descriptive EXIF is nullable, but missing dimensions refuse import

- **When:** Slice 01b importer pass.
- **The choice:** A supported JPEG or TIFF may have pixels but no lens name, camera name, exposure, or
  timezone. The EXIF reader represents those descriptive facts as `null`, allowing the photo to remain
  useful. Width and height are different: without them photoctl cannot establish the base coordinate
  space used by render, crop, masks, and export, so the reader rejects that file. Treating every absent
  tag as fatal would refuse ordinary stripped images; treating dimensions as optional would push an
  unusable photo into every later command.
- **The gap:** The plan defines content-based image admission and the metadata columns but does not say
  which tags are required when a decodable still image has sparse metadata.
- **The reach:** Import error mapping must turn the missing-dimensions failure into the per-file
  unsupported result, while `show` can serialize absent descriptive metadata consistently as `null`.
- **Verdict:** **Sound.** Pixel geometry is a functional requirement; camera annotations are not.
- **Confidence:** Medium.

### Slice 01b — Pixel orientation and coordinate orientation share one transform table

- **When:** Slice 01b render-owned pass.
- **The choice:** A photo can say “rotate right” or “mirror left-to-right” in its EXIF orientation
  metadata. Photoctl turns that instruction into one small transform record containing a quarter-turn
  rotation plus an optional vertical or horizontal reflection. Both the coordinate functions and the
  Sharp pixel decoder consume that same record. Coordinates are measured along image edges: the
  top-left is `[0,0]`, the bottom-right is `[width,height]`, and a bounding box transforms all four of
  its edges before its new top-left and size are computed. The alternative was two separate tables—one
  for points and another for pixels—which could eventually make a click land on a different subject
  than the one shown on screen.
- **The gap:** The plan fixed the eight EXIF orientations and the `[x,y,w,h]` box shape but did not
  define edge-versus-pixel-centre coordinates or how pixel and geometry transforms would stay aligned.
- **The reach:** Crop, segmentation boxes, masks, layer transforms, markup, and render orientation all
  inherit one oriented, uncropped base coordinate space.
- **Verdict:** **Sound.** One owner prevents an orientation fix in rendering from silently leaving
  editing coordinates behind.
- **Confidence:** High.

### Slice 01b — Preview-source `Image16` is full-range, display-referred sRGB in an interleaved typed array

- **When:** Slice 01b render-owned pass.
- **The choice:** Decoding an embedded-range, whole-file, or pinned-preview display source produces
  three unsigned 16-bit channel values per pixel in red-green-blue order, stored as a `Uint16Array`.
  “Full-range” means JPEG white becomes 65535, not 255
  placed inside a larger integer type; `space:"display-srgb"` says the values are ready for display and
  are not the scene-linear data introduced by later full-resolution decoders. Sharp's plain `ushort` cast
  kept 8-bit values in the 0–255 range, so the graph deliberately converts through Sharp's `rgb16`
  colourspace first. The alternative would look correct in TypeScript while giving later compositing
  code only 1/257th of the expected numeric range.
- **The gap:** The plan named `Image16` but did not specify its memory layout, numeric range, or explicit
  colour-space tag.
- **The reach:** The develop and composite graph stages can accept one stable pixel buffer without
  guessing whether a value is linear light, display light, 8-bit, or 16-bit.
- **Verdict:** **Sound.** The type and runtime values carry the information downstream pixel operations
  need to remain deterministic.
- **Confidence:** High.

### Slice 01b — Export receives resolved sources and leaves destination planning to its caller

- **When:** Slice 01b render-owned pass.
- **The choice:** The render package receives a final output path and a resolved `ImageSource`: an
  online whole file, an online JPEG byte range, or a pinned preview. It never opens the photo catalog
  or decides where a volume is mounted. In plain control flow after slice 05: `render preferred online source into the requested
  delivery format → if the online read fails, render the pinned preview and warn → if neither can be read, file_offline`.
  The command layer creates the output directory and owns collision naming before it calls this API;
  destination write errors still propagate instead of being mislabeled as an offline source. The
  alternative would make rendering depend on PGlite, cache policy, volume resolution, and filename
  policy all at once.
- **The gap:** The plan assigned source resolution to library/importer and export execution to render,
  but did not define the data passed across that boundary or who creates the destination directory.
- **The reach:** Slice 02 can change catalog transport and slice 05 can add templates and collision
  policy without changing the pixel graph or adding a second source resolver.
- **Verdict:** **Sound.** The API keeps catalog state, source-byte rendering, and destination planning
  with their declared owners while preserving the stable offline outcome.
- **Confidence:** High.

### Slice 01b — Photo rows represent absent metadata without inventing values

- **When:** Slice 01b library pass.
- **The choice:** A photo always has `camera` and `exposure` JSON objects, but either object may be
  empty when an admitted image carries no corresponding EXIF fields. Capture time and its UTC offset may
  be null for the same reason. Structural facts are stricter: byte size cannot be negative, displayed
  width and height must be positive, and EXIF orientation must be one of 1 through 8. The alternative
  would either reject otherwise valid photographs with sparse metadata or make every reader handle
  three states for the JSON objects: missing, null, and empty.
- **The gap:** The plan named the columns but did not specify nullability, defaults, or database checks.
- **The reach:** Every import format and every `show` response inherits the distinction between an
  unknown descriptive fact and an invalid structural fact.
- **Verdict:** **Sound.** Empty objects preserve a stable response shape while nullable scalar facts
  remain honestly unknown.
- **Confidence:** Medium.

### Slice 01b — One open file produces identity and locator stat facts

- **When:** Slice 01b library pass.
- **The choice:** `identifyFile` opens the source once, reads the contracted head and tail samples from
  that open descriptor, and returns its size and modification time alongside the content key. It
  checks size and modification time again before returning. If a copy is still writing the file while
  photoctl samples it, the operation fails instead of combining the beginning of one state with the
  end of another. A caller does not reopen the path to obtain locator metadata, because the path could
  point at a replacement by then.
- **The gap:** The plan fixed the hash bytes but did not define the API result or concurrent source-file
  behavior.
- **The reach:** Import and later relocation logic receive one coherent set of file facts; callers must
  retry a file that changes during inspection.
- **Verdict:** **Sound.** It makes the content key describe one observed file state rather than a race
  between independent path reads.
- **Confidence:** High.

### Slice 01a — A successful `doctor` reports no foreign lock holder

- **When:** Slice 01a.
- **The choice:** `doctor` must briefly own the library lock to read a consistent catalog. If another
  process owns it, `doctor` waits or returns `library_locked` with that process's ID. If `doctor`
  succeeds, it necessarily owns the lock itself, so its JSON reports `lock_holder: null` rather than
  echoing its own process ID. The alternative would make a healthy result look contended even though
  the competing holder is gone.
- **The gap:** The plan named a lock-holder field but did not define what it means on a successful run.
- **The reach:** Scripts can treat a non-null holder as contention evidence rather than normal
  self-observation.
- **Verdict:** **Sound.** The field describes foreign contention, which is the only holder state callers
  can act on.
- **Confidence:** Medium.

### Slice 01a — A cache override selects a base directory, not one shared cache

- **When:** Slice 01a.
- **The choice:** When `PHOTOCTL_CACHE=/tmp/cache` is set, a library whose ID is `abc` uses
  `/tmp/cache/abc`. The library ID is still appended, just as it is beneath the default macOS cache
  directory. Treating the override as the final directory would let two libraries overwrite each
  other's preview files and cache index.
- **The gap:** The plan named the override but did not say whether it replaces the base or the complete
  per-library path.
- **The reach:** Every preview tier, rendered fallback, and later cache-prune operation inherits this
  isolation boundary.
- **Verdict:** **Sound.** An override changes location without removing per-library isolation.
- **Confidence:** High.

### Slice 01a — PGlite durability is configured before Postgres starts

- **When:** Slice 01a.
- **The choice:** PGlite normally starts its embedded Postgres with `-F`, which means completed writes
  need not be flushed to durable storage. Postgres does not allow `fsync` to be changed after startup,
  so photoctl removes `-F` from PGlite's public startup arguments and then verifies both `fsync` and
  `synchronous_commit` are on. The planned alternative—running `SET fsync=on` after opening—fails at
  runtime and would leave the library less durable.
- **The gap:** The plan specified the final settings but assumed Postgres allowed both to change after
  startup.
- **The reach:** Every catalog write, migration, and future daemon session depends on this startup
  policy.
- **Verdict:** **Sound.** It establishes and verifies the required property at the only phase where
  Postgres permits it.
- **Confidence:** High.

### Slice 01a — The external lockfile is backed by the operating system's advisory lock

- **When:** Slice 01a review correction.
- **The choice:** The lockfile still contains the holder's process ID, socket, and start time, but an
  open file descriptor now carries the actual exclusion lock. An advisory lock is a lock the operating
  system releases automatically when its process exits, including after `kill -9`. The first version
  instead read a dead PID and unlinked its file; two processes could both make that decision and one
  could delete the other's new live lock. A synchronized concurrent probe reproduced multiple
  simultaneous holders.
- **The gap:** The plan required stale-file reclamation but did not provide an atomic compare-and-delete
  operation; ordinary filesystem unlink has none.
- **The reach:** All direct PGlite access and the future daemon depend on this being a true one-writer
  boundary. It also adds the native `fs-ext` install dependency for supported macOS/Linux builds.
- **Verdict:** **Sound.** Kernel ownership removes the race instead of tuning its timing window.
- **Confidence:** High.

### Slice 01a — Command options are parsed as a closed set

- **When:** Slice 01a review correction.
- **The choice:** Each command lists the options it accepts; an unknown option, duplicate option, missing
  value, or stray positional argument returns `usage` before the library is touched. The first version
  searched only for known option names, so `--cache-mxa 1GiB` silently initialized a library with the
  default size and `doctor nonsense` succeeded. The alternative makes automation typos look like valid
  work.
- **The gap:** The plan fixed command shapes but delegated the parser implementation.
- **The reach:** Later verbs can extend one strict parser without inheriting silent argument loss.
- **Verdict:** **Sound.** A CLI contract is only stable when unrecognized input is rejected.
- **Confidence:** High.

### Slice 00 — The fixture tool discovers previews through both TIFF pointers and JPEG validation

- **When:** Slice 00.
- **The choice:** A Sony RAW file is a TIFF container whose directories point at embedded JPEGs. The
  independent fixture tool follows those directory pointers, then parses each referenced JPEG's own
  header to establish its dimensions. It also scans for JPEG signatures as a fallback measurement
  path and de-duplicates the result. This keeps the test oracle independent from the future importer
  while ensuring an offset is not accepted merely because a TIFF tag named it.
- **The gap:** The plan required a TIFF directory walk but did not prescribe how referenced bytes
  should be validated or whether maker-specific directories needed a fallback.
- **The reach:** Importer and render tests will treat `fixtures/a7c2.json` as their external oracle.
- **Verdict:** **Sound.** Two independent structures in the fixture must agree before a preview fact is
  recorded.
- **Confidence:** High.

### Slice 00 — Workspace packages compile as NodeNext ECMAScript modules

- **When:** Slice 00.
- **The choice:** TypeScript emits standard ECMAScript modules using Node's `NodeNext` rules. Source
  imports therefore use the `.js` extension that the built Node 24 process will load. The alternative
  was bundling packages or relying on a TypeScript runtime, both of which would make tests differ from
  the shipped CLI.
- **The gap:** The plan fixed Node 24 as the runtime but did not choose a TypeScript module-resolution
  mode or whether the CLI would be bundled.
- **The reach:** Every later package inherits this compile-and-run boundary.
- **Verdict:** **Sound.** It keeps development and production on the same native Node module contract.
- **Confidence:** High.

### Slice 01b review — Import returns the IDs it created or recognized

- **When:** Slice 01b command integration.
- **The choice:** Import adds `ids:[...]` to its summary. Before `list` exists in slice 04, a script
  that imports one photo otherwise has no machine-readable value it can pass to `show` or `export`;
  parsing a UUID from logs or querying the database would bypass the CLI contract. On re-import the
  same array contains the already-existing ID, so the next command does not need a separate branch.
- **The gap:** The A2 aggregate names counts but does not expose the identities behind them, while the
  slice-01 checkpoint immediately needs the imported ID.
- **The reach:** Agents can chain import into every ID-based verb now; slice 04 can retain the field
  when folder import adds many IDs rather than inventing a second handoff mechanism.
- **Verdict:** **Sound.** The small additive field closes a real orchestration gap without changing the
  meaning of any A2 count.
- **Confidence:** Medium.

### Slice 01b review — A batch with no admitted image has no invented volume

- **When:** Slice 01b command integration.
- **The choice:** When content probing admits no image, the import result returns `volume:null`.
  Probing may read the candidate bytes, but the A2 volume summarizes admitted library sources rather
  than every attempted path. The alternative would fabricate a volume-shaped result for a batch that
  created no locator.
- **The gap:** A2 shows a volume for imported photos but does not define the aggregate when every input
  is skipped before volume resolution.
- **The reach:** Later folder summaries can distinguish “nothing was opened” from “these files came
  from this resolved volume,” and callers do not learn false mount state.
- **Verdict:** **Sound.** Null states exactly which fact is unknown and why.
- **Confidence:** Medium.

### Slice 01b review — A matching content key, not modification time, proves source identity

- **When:** Slice 01b export review.
- **The choice:** Before using an online source for export, photoctl recomputes the fixed content key and byte size for
  each available locator. A file whose contents match but whose filesystem modification time was
  merely touched remains the same photo and can still supply the 7008×4672 embedded JPEG. Requiring
  the old timestamp would incorrectly downgrade an unchanged online source to a 1616-pixel cache
  fallback and warn that it was offline.
- **The gap:** The plan stores locator modification time but does not say whether it participates in
  identity. The content-key formula is the explicit identity contract.
- **The reach:** Relocation, restored backups, and metadata-preserving copies can change filesystem
  timestamps without changing photo identity; all locators are judged by the same content rule.
- **Verdict:** **Sound.** Timestamp is useful freshness evidence, but it must not override the declared
  byte identity.
- **Confidence:** High.

### Slice 01b review — Whole-file sources are identified by the content probe registry, not stored as embedded previews

- **When:** Slice 01b accepted-format review.
- **The choice:** Every whole-file image leaves `files.embedded` as the list of genuine embedded JPEG
  ranges only. When export sees no embedded range, it consults the central content probe registry and
  uses the whole online file as the render source; a full-frame orientation-1 JPEG may be copied exactly,
  while every other admitted format is decoded and encoded as JPEG. Sparse files get dimensions from
  their image header when descriptive EXIF is absent. The rejected alternative stored a whole file as a pretend
  `EmbeddedJpeg`, which would let future cache code mistake container bytes for a preview.
- **The gap:** The plan names `source:"file"` but does not define how that source crosses the catalog
  boundary without adding another schema column.
- **The reach:** Slice 07 can add decoder selection while the embedded-preview collection keeps one
  meaning, and slice 04 can scan ordinary images without requiring EXIF metadata.
- **Verdict:** **Sound.** Source kind remains derivable from the sole format owner and no permanent
  preview seam is diluted.
- **Confidence:** High.

### Slice 01b review — Cache repair validates bytes and repairs the index independently

- **When:** Slice 01b idempotency review.
- **The choice:** Re-import byte-compares the expected 1616 preview with the pinned cache file. A match
  leaves the file timestamp untouched but still upserts `cache_index`; a missing or same-length corrupt
  file is atomically rewritten. This covers a crash after the file rename but before the database
  commit, where checking only file existence would leave the index missing forever, while blindly
  rewriting every valid preview would turn an idempotent import into repeated cache churn.
- **The gap:** The plan requires both a pinned file and an index row but does not define recovery when
  only one side survived.
- **The reach:** Folder-scale re-import remains convergent and cheap in writes, and later pruning can
  trust that valid pinned files eventually regain their index entry.
- **Verdict:** **Sound.** Each half is verified and repaired without treating either as proof that the
  other committed.
- **Confidence:** High.

### Slice 01b review — Batch failure codes are independent of item order

- **When:** Slice 01b export review.
- **The choice:** If every export item fails with the same code, the envelope keeps that shared code.
  If failure codes differ—or successes and failures are mixed—the aggregate code is `partial`, while
  every item retains its own result. The alternative chose the first failed item's code, so reversing
  two IDs could change the process exit and an agent's retry decision without changing any outcome.
- **The gap:** A6 defines mixed success as partial but does not spell out the all-failed,
  heterogeneous case.
- **The reach:** Every future batch verb can adopt the same permutation-invariant aggregation rule.
- **Verdict:** **Sound.** Aggregate meaning depends on the set of outcomes, never argv ordering.
- **Confidence:** High.

### Slice 01b review — Source I/O failures keep different retry semantics from malformed bytes

- **When:** Slice 01b import review.
- **The choice:** A missing path maps to `not_found`; permission, device-I/O, and stale-mount errors map
  to `file_offline`; bytes that no registered probe can admit map to `unsupported_file`. A file
  that changes during inspection also returns stable JSON with
  `reason:"changed_during_import"` instead of leaking a stack trace. Collapsing all four situations
  into “unsupported” would tell automation to fix data when the storage edge actually needs attention.
- **The gap:** The content probe registry defines accepted and unsupported inputs but not operating-system read
  failures or a source mutating during import.
- **The reach:** CLI exit classes remain actionable when slice 04 adds scanning, removable drives, and
  retryable import work.
- **Verdict:** **Sound.** The protocol preserves the operational distinction that its exit classes are
  designed to carry.
- **Confidence:** High.

### Slice 01b review — The envelope workbench is static and self-contained

- **When:** Slice 01b checkpoint.
- **The choice:** `wb envelope` renders typed success, locked, and partial examples into one standalone
  HTML file. It imports the protocol's exit mapping at build time but needs no live library, daemon,
  network, scripts, fonts, or linked assets when opened. A live demo would make a contract review
  depend on machine state and could hide one of the failure shapes when that state was hard to trigger.
- **The gap:** The plan requires the report but delegates how examples are produced and packaged.
- **The reach:** Later workbench reports can stay reproducible artifacts, and the protocol review can
  be opened from a checkout or CI artifact without starting photoctl.
- **Verdict:** **Sound.** Static fixtures make the human checkpoint deterministic while remaining typed
  against the owning package.
- **Confidence:** Medium.

### Slice 07a — Swift sends raw RGB floats through a validated temporary file

- **When:** Slice 07a CIRAW boundary.
- **The choice:** A quarter-scale camera decode contains more than six million channel samples, so
  `photoctl-mac` does not turn pixels into JSON or mix binary bytes into its status stream. The caller
  gives it a unique temporary output path; Swift writes row-major RGB 32-bit little-endian floats
  there and prints a small JSON description to stdout. TypeScript checks that description and the
  exact expected byte count before constructing `LinearImage`, then removes the temporary directory
  whether decoding succeeds or fails. The alternative—base64 in JSON—would enlarge every decode and
  hold another full copy in memory; a mixed stdout protocol would make partial failures hard to parse.
- **The gap:** The plan delegated the f32 Swift-to-TypeScript wire format but did not choose framing or
  lifecycle.
- **The reach:** CIRAW has a bounded, inspectable process boundary that future helper operations can
  follow without putting platform frameworks in Node. LibRaw remains an in-process native decoder and
  does not have to adopt this transport.
- **Verdict:** **Sound.** Metadata and pixels each use the representation suited to them, and failed
  calls cannot leave library-owned artifacts behind.
- **Confidence:** High.

### Slice 07a — Helper discovery never compiles Swift at command time

- **When:** Slice 07a mac-helper packaging seam.
- **The choice:** When a command needs CIRAW, `@photoctl/mac-helper` first honors the explicit
  `PHOTOCTL_MAC_HELPER_PATH`, then looks for a packaged binary, then the workspace's already-built
  debug binary, and finally asks the operating system `PATH`. For example, a source checkout works
  after the normal build, while a release package can ship its own binary at the same API seam. The
  rejected alternative ran `swift build` from `decode`, which would turn a photographer's runtime
  command into a compiler/toolchain operation and make installed packages depend on source code.
- **The gap:** The repo shape required a wrapper and platform packages but did not define development
  lookup order before the release-packaging slice exists.
- **The reach:** Slice 14 can add per-platform binaries without changing commands or decoder selection;
  tests and unusual installations retain one explicit override.
- **Verdict:** **Sound.** Build-time and runtime responsibilities stay separate, and the lookup order
  converges on the packaged artifact rather than a development path.
- **Confidence:** Medium.

### Slice 07a — An unrun headless gate is represented as unknown

- **When:** Slice 07a G3 verification.
- **The choice:** `doctor` reports `requires_window_server:null` while the CIRAW helper itself is
  available. The normal host process decoded the camera fixture twice identically, but this machine
  refused the SSH connection needed to prove operation without a window server. Reporting `false`
  would turn “not tested” into a promise; reporting `true` would turn an SSH configuration problem
  into a decoder failure. The checked-in probe changes the field only after it produces real G3
  evidence.
- **The gap:** The plan defined pass and fail behavior for G3 but not the state where the required host
  environment cannot launch the exam.
- **The reach:** Agents can distinguish installed CIRAW support from the still-open headless property,
  and 07b can proceed without silently closing the risk.
- **Verdict:** **Sound.** A nullable capability records the evidence actually available and prevents a
  false architecture decision.
- **Confidence:** High.

### Slice 07a — Decoder fallback has its own warning code

- **When:** Slice 07a automatic selection.
- **The choice:** Suppose an online ARW is intact but the preferred native decoder is unavailable.
  `decode --with auto` succeeds from the full embedded JPEG or pinned preview and returns
  `decoder_fallback`; it uses `source_offline` only when the original file itself cannot be read. The
  alternative reused `source_offline` for both cases, which would tell an agent to reconnect a drive
  even though installing or repairing a decoder is the real way to regain RAW pixels.
- **The gap:** The plan required a warning on automatic decoder fallback, while the closed warning-code
  union had no member describing that reason.
- **The reach:** Future show, render, and export integration can preserve the difference between storage
  availability and decoder capability without parsing human messages.
- **Verdict:** **Sound.** The machine-readable warning identifies the condition an automated caller can
  act on while preserving the successful fallback.
- **Confidence:** High.

### Slice 07a — Linear float output clamps to the representable 16-bit TIFF range

- **When:** Slice 07a decode probe output.
- **The choice:** The neutral CIRAW configuration disables extended dynamic range, and `decode --to`
  stores each linear sample as an unsigned integer from 0 through 65,535. A negative numerical fringe
  becomes 0 and a value above 1 becomes 65,535 instead of wrapping around to an unrelated brightness.
  The float `LinearImage` remains unchanged in memory; only the explicitly requested integer TIFF is
  clipped. The alternative would need a floating-point TIFF contract or a scene-referred exposure
  normalization that the plan did not request.
- **The gap:** The plan says “linear 16-bit output” without spelling out how out-of-range floating-point
  samples map to an unsigned file representation.
- **The reach:** Decoder probes remain comparable and safe to open, while the render graph and later
  color core retain unclipped floats for actual processing.
- **Verdict:** **Sound.** Saturating conversion is deterministic and preserves ordering at both bounds;
  wrapping would create false colors.
- **Confidence:** Medium.

### Slice 07b — Camera samples are black-subtracted counts, not display-ready colors

- **When:** Slice 07b LibRaw pixel contract.
- **The choice:** After LibRaw turns the camera's one-color-per-sensor-site mosaic into three channels
  with AHD (Adaptive Homogeneity-Directed demosaicing), photoctl subtracts the measured sensor black
  offset but does not divide by the white level or apply the camera white balance. A sample therefore
  remains a linear camera count: black is `0`, the adjusted saturation point is `white−black`, and the
  separate `asShotWb` numbers describe rather than alter the pixels. The alternative would emit values
  from zero to one or bake white balance into the pixels, either of which would make slice 07c repeat or
  guess which part of the shared camera front end had already run.
- **The gap:** The plan required camera space and forbade color conversion, but did not choose the
  numeric units after black subtraction.
- **The reach:** The shared develop front end, TIFF probes, histograms, and future decoder comparisons
  must interpret LibRaw samples with the accompanying black and white levels rather than as display RGB.
- **Verdict:** **Sound.** It preserves the sensor measurement and leaves every color decision with the
  one shared develop pipeline.
- **Confidence:** High.

### Slice 07b — Native decode runs off the JavaScript event loop while LibRaw remains thread-safe

- **When:** Slice 07b napi concurrency boundary.
- **The choice:** A full AHD decode takes several seconds, so the napi function returns a promise and
  performs the C++ work on Node's native worker pool. LibRaw keeps its thread-local AHD scratch state;
  photoctl disables OpenMP by supplying no OpenMP build flags rather than defining
  `LIBRAW_NOTHREADS`, which would replace that scratch state with shared static memory. The alternative
  synchronous binding would freeze daemon commands during every decode, while the no-threads build
  would let two otherwise independent probes or decodes corrupt one another.
- **The gap:** The plan selected napi and prohibited OpenMP but did not specify scheduling or distinguish
  internal thread safety from parallel demosaic execution.
- **The reach:** Multiple daemon requests may safely overlap without blocking unrelated JavaScript work;
  future native image operations should follow the same worker-boundary rule when they are CPU-heavy.
- **Verdict:** **Sound.** Parallel Rust tests reproduced corruption with shared AHD scratch state and
  stayed deterministic after restoring LibRaw's thread-safe mode.
- **Confidence:** High.

### Slice 07b — LibRaw uses its nominal inset crop before orientation

- **When:** Slice 07b LibRaw adapter.
- **The choice:** The Sony fixture contains a larger stored sensor rectangle around the photograph.
  Immediately after unpacking, photoctl asks LibRaw to apply the format's declared raw inset, producing
  the camera's nominal `7008×4672` image, then maps LibRaw's orientation while copying pixels. Returning
  the larger storage rectangle would expose optical-black and margin pixels that other decoders never
  show; inventing a photoctl crop would create a second camera geometry table.
- **The gap:** The global coordinate rule forbids an artistic crop but does not say whether container
  sensor margins count as image pixels.
- **The reach:** Imported dimensions, decoder scale flooring, camera matrices, and the slice 07c oracle
  all begin from the same oriented camera rectangle.
- **Verdict:** **Sound.** The decoder's own format metadata owns sensor margins; this is normalization of
  the stored raster, not a user crop.
- **Confidence:** High.

### Slice 07b — Fractional decoder scales use bilinear pixel-center sampling in Rust

- **When:** Slice 07b scale implementation.
- **The choice:** LibRaw always performs AHD at the nominal camera dimensions. For scale `0.5` or `0.25`,
  photoctl then computes each output pixel from the four surrounding camera pixels at pixel-center
  coordinates, with dimensions floored exactly as the public decoder contract requires. Nearest-neighbor
  sampling would alias fine detail; asking LibRaw for half-size would change the demosaic algorithm and
  make full and scaled calls disagree for reasons beyond resizing.
- **The gap:** The plan required one Rust resampler and exact scaled dimensions but did not select the
  interpolation kernel or whether scaling occurs before or after AHD.
- **The reach:** Slice 10 should promote this implementation as the one shared resampler rather than add
  a second kernel for previews, layers, or masks.
- **Verdict:** **Sound.** Post-AHD bilinear sampling gives one deterministic camera decode at every scale
  and a reusable baseline kernel.
- **Confidence:** Medium.

### Slice 07b — Explicit camera TIFFs normalize measured levels into real 16-bit samples

- **When:** Slice 07b CLI verification output.
- **The choice:** `decode --to` maps a camera count with `(sample−black)/(white−black)`, clips the result
  to zero through one, and writes an uncompressed RGB TIFF whose stored channel samples truly span
  16 bits. Scene-linear inputs already use zero-to-one values and take the same final saturating write.
  The previous Sharp path labelled its container 16-bit but numerically clamped float camera counts as
  though they were zero-to-one, leaving effectively 8-bit values and mostly white LibRaw output.
- **The gap:** The plan required linear 16-bit output but did not define how unnormalized camera counts
  reach that file or verify the numeric sample depth independently of TIFF metadata.
- **The reach:** Decoder probes are inspectable by ordinary TIFF readers without changing the in-memory
  camera contract; slice 07c still owns the linear Rec.2020 profile and display color transform.
- **Verdict:** **Sound.** The file preserves relative sensor levels at the requested integer precision
  while the develop graph retains unclipped floats.
- **Confidence:** High.

### Slice 07b — Native availability is lazy, but native tests build the host addon first

- **When:** Slice 07b package and test boundary.
- **The choice:** Importing `@photoctl/img` does not immediately load a `.node` binary. The first LibRaw
  inspection chooses the package matching the current operating system and CPU, and a missing package
  becomes an explicit unavailable result instead of crashing every command. Because generated native
  binaries are not committed, the TypeScript test script builds and copies the current host addon before
  Vitest starts. The alternative eager import would prevent even non-image commands from starting on an
  unsupported installation; assuming a pre-existing developer build would make a clean checkout fail.
- **The gap:** The plan named per-platform packages but did not specify load timing or how source-checkout
  tests obtain an ignored native artifact.
- **The reach:** `doctor` and automatic decoder selection share one availability truth, and clean local or
  Docker tests exercise the same package loader used by the CLI.
- **Verdict:** **Sound.** Optional native capability remains observable without making it a process-wide
  startup requirement.
- **Confidence:** High.

### Slice 07b — Probe answers format capability without reading the whole pixel payload

- **When:** Slice 07b decoder selection.
- **The choice:** `probe()` opens and parses LibRaw metadata, including the TIFF compression tag, but
  does not unpack every sensor byte. Thus a deliberately truncated file can identify as a supported Sony
  RAW and later fail decode with an I/O error. Treating that damaged original as “decoder unavailable”
  and silently switching to an embedded preview would hide source corruption; fully unpacking during
  probe would also perform the expensive read twice for every healthy decode.
- **The gap:** The plan requires a support/compression probe and fallback when an adapter is unavailable,
  but does not define whether probe is also a whole-file integrity check.
- **The reach:** Automatic selection distinguishes “this decoder understands the format” from “this
  particular source decoded successfully”; future source-integrity handling should surface the latter
  explicitly rather than overload decoder availability.
- **Verdict:** **Sound.** Capability probing stays cheap and source corruption remains an error instead of
  becoming a lower-quality silent fallback.
- **Confidence:** Medium.

### Slice 07b — Recursive source discovery excludes LibRaw's alternate placeholder translation units

- **When:** Slice 07b portable build.
- **The choice:** The build recursively discovers upstream `src/**/*.cpp`, then excludes the three files
  ending in `_ph.cpp`. Those files implement no-postprocessing placeholders for a different LibRaw build;
  compiling them beside the real preprocessing, postprocessing, and writer sources defines the same C++
  functions twice and ELF linkers reject the library. Listing every desired source by hand would avoid
  duplicates today but silently omit a new decoder file on a later pinned LibRaw update.
- **The gap:** The plan required recursive source discovery but did not call out upstream's mutually
  exclusive placeholder files.
- **The reach:** Linux and macOS use the same full LibRaw implementation, while a future vendor update
  remains discoverable through the source glob and checksum review.
- **Verdict:** **Sound.** It preserves the plan's update-safe discovery rule while selecting exactly one
  implementation of each LibRaw function.
- **Confidence:** High.

### Slice 07b integration — Git preserves vendored LibRaw whitespace verbatim

- **When:** Slice 07b integration review.
- **The choice:** Git whitespace diagnostics are disabled only for `crates/libraw-sys/vendor/**`.
  LibRaw's upstream archive contains trailing whitespace and mixed line endings; normalizing those files
  would make photoctl's vendored bytes diverge from the pinned, checksummed release. Project-owned Rust,
  C++, TypeScript, scripts, and documentation keep the repository's normal whitespace checks.
- **The gap:** The plan required an exact vendored source release and a clean diff gate, but did not say
  how the gate should treat formatting already present in third-party source.
- **The reach:** Future LibRaw updates remain auditable against their upstream archive without weakening
  whitespace review anywhere photoctl owns the code.
- **Verdict:** **Sound.** The exception is path-scoped to immutable third-party provenance.
- **Confidence:** High.

### Slice 03b integration — Direct commands defer non-daemon contention to the library lock

- **When:** Slice 03b integration review.
- **The choice:** A command running with `--no-daemon` stops a live photoctl daemon before opening the
  library, but does not reject a socketless lock held by another direct process. It proceeds to the
  ordinary library-open path, which waits for the configured lock budget and reports both the holder PID
  and elapsed budget if contention persists. Explicit `daemon stop` and destructive restore keep their
  strict behavior and reject a non-daemon holder immediately.
- **The gap:** The daemon lifecycle specified how direct commands displace a daemon and how library-open
  contention waits, but did not define which subsystem owns a socketless holder encountered while
  preparing direct execution.
- **The reach:** All direct-mode verbs now expose the same lock-wait contract as `openLibrary`; daemon
  control and restore retain their stronger safety boundary.
- **Verdict:** **Sound.** The library lock remains the sole owner of contention timing and error data,
  while daemon shutdown remains responsible only for actual daemons.
- **Confidence:** High.

### Slice 07c integration — macOS signs the packaged native addon after copying it

- **When:** Slice 07c integration review.
- **The choice:** The native packaging script ad-hoc signs the destination `.node` file on macOS after
  copying Cargo's dylib into its platform package. Cargo's linker signature can verify after a filesystem
  copy yet still be killed by the macOS loader; signing the artifact at its final path makes the package
  boundary deterministic. Linux packaging performs no signing step.
- **The gap:** The release layout required per-platform native packages but did not define how a copied
  Apple Silicon dylib preserves a loader-acceptable code signature.
- **The reach:** Source builds, tests, and packed macOS installs all load the exact addon artifact that
  was signed at its shipped location instead of depending on copy semantics.
- **Verdict:** **Sound.** This is the narrow platform-required finishing step at the package owner, and
  it leaves native implementation and non-macOS builds unchanged.
- **Confidence:** High.

### Slice 07c — Full-frame color transforms run off the daemon event loop

- **When:** Slice 07c shared color-front implementation.
- **The choice:** When a decoder hands photoctl millions of RGB samples, the native call first snapshots
  the mutable JavaScript typed array and sends the levels, white-balance, matrix, and transfer work to a
  worker task. The daemon can continue accepting socket traffic while the pixels are processed. The
  boundary copy is required because napi typed arrays remain writable by JavaScript; sharing one with a
  worker would be an unsafe data race and make results depend on mutations after invocation. On the G4
  host, snapshotting the 11.7 MiB quarter-scale display buffer took 2.4 ms and the 187.3 MiB full A7C II
  display buffer took 22.3 ms; the much larger per-pixel transform remains off-thread.
- **The gap:** The plan named Rust as the one color owner but did not specify how its napi boundary
  should be scheduled inside the persistent daemon.
- **The reach:** Every later develop operator inherits this execution model. CPU-heavy pixel work
  belongs on native tasks, while the daemon thread remains an orchestration boundary.
- **Verdict:** **Sound.** It preserves the single color owner without turning large RAW files into
  command-admission stalls.
- **Confidence:** High.

### Slice 07c — A neutral CIRAW oracle zeros per-file presentation defaults

- **When:** Slice 07c G4 diagnosis.
- **The choice:** A Core Image RAW filter starts with some values chosen from each camera file, including
  baseline exposure, shadow bias, local tone mapping, and highlight recovery. The oracle's first honest
  run left those defaults active and failed at mean ΔE00 4.723. Photoctl now sets them to neutral just as
  it already neutralized boost, noise reduction, sharpening, contrast, detail, lens correction, and
  gamut mapping. The result is a scene-linear decode rather than Apple's suggested starting look.
- **The gap:** The 07a property list omitted these newer or file-dependent CIRAW controls even though it
  required a neutral render.
- **The reach:** CIRAW remains a useful independent decoder oracle; otherwise later develop settings
  would be measured on top of an invisible Apple exposure/tone adjustment.
- **Verdict:** **Sound.** It enforces the stated neutral invariant and made G4 pass without moving its
  tolerance.
- **Confidence:** High.

### Slice 07c — The embedded JPEG is visual context, not a neutral RAW measurement

- **When:** Slice 07c workbench report.
- **The choice:** `wb oracle` shows the full embedded JPEG, CIRAW, and LibRaw images at identical quarter
  dimensions so framing and orientation are reviewable. Only CIRAW versus LibRaw contributes to ΔE00.
  The embedded JPEG carries the camera maker's contrast, exposure, and color rendering, so including it
  in the numeric neutral-decoder score would measure an intentional presentation difference as a bug.
- **The gap:** The plan required a three-way workbench and a decoder tolerance but did not state whether
  the already-rendered preview belongs in the numeric pair.
- **The reach:** Future fixtures can use their camera previews to catch geometry errors without forcing
  an independent RAW implementation to imitate proprietary picture styles.
- **Verdict:** **Sound.** It keeps all three views useful while the threshold tests the two comparable
  scene-linear decoders.
- **Confidence:** Medium.

### Slice 07c — The oracle measures the public linear-TIFF boundary

- **When:** Slice 07c workbench report.
- **The choice:** `wb oracle` decodes through the real CLI and measures the exported 16-bit linear
  Rec.2020 TIFFs rather than importing a private in-memory decoder buffer. The quarter-scale request
  keeps the three full frames practical while retaining more than one source pixel per 64×64 patch.
- **The gap:** The plan fixed the patch grid and threshold but did not say whether the oracle should
  compare private floating-point buffers or the artifacts users can actually request.
- **The reach:** G4 covers command dispatch, decoder metadata, the shared camera front, TIFF
  quantization, and framing as one public contract. Sub-16-bit numerical drift is deliberately outside
  this integration gate and remains the color core's unit-test responsibility.
- **Verdict:** **Sound.** A decoder oracle is more durable when it exercises the supported seam instead
  of reaching around it, and the chosen scale still gives every patch real spatial support.
- **Confidence:** Medium.

### Pre-slice 08 — One immutable image DAG replaces flat render state and private layer pipelines

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** Source, develop, generation, upscale, deterministic resample, transform, mask composite,
  composite, crop, markup, and output are typed immutable nodes in one graph. User-visible layers remain an
  ordered editing vocabulary, but each revision points a layer at one output node; a processing node never
  masquerades as another painted layer. Graph topology uses normalized nodes and ordered edges, while each
  node kind owns a validated canonical parameter schema. Changing parameters inserts a replacement node and
  document revision rather than mutating history. The rejected alternatives were a visible layer for every
  operation, per-layer private DAG fragments, and continuing the flat `fill_params` replay design.
- **The gap:** The plan called a linear renderer a graph and assigned future layers enough fields to become a
  second render-state owner. Adding upscaling there would compound the duplication.
- **The reach:** Slice 08 establishes the graph before develop; Slice 10 makes layers roots into it; fill,
  reimagine, retouch, markup, preview, export, undo, and future processing share the same evaluator and identity.
- **Verdict:** **Sound.** The feature becomes a general processing architecture instead of an upscaler bolted
  onto generated layers.
- **Confidence:** High.

### Slice 08a1 architecture audit — Logical edit identity is separate from pixel execution identity

- **When:** DAG/upscaling unknowns walk, corrected by the Slice 08a1 architecture audit on 2026-09-05.
- **The choice:** A logical image node says what edit should happen; an execution says which pixels were actually used and produced.
  For example, changing exposure inserts a logical node and revision immediately, so the CLI can return the new render hash without
  decoding the photo. Later, preview may evaluate that same node from an online full-resolution artifact or from the pinned offline
  preview. Those runs share the document edit and render hash, but their evaluation keys differ because the ordered input artifact
  hashes differ. Source runs additionally record the actual locator, tier, dimensions, and decoder id/version. A deterministic run
  reuses its evaluation key; a generative run keeps a distinct full execution id even if another attempt returns identical bytes.
  Canonical recipe, execution, artifact, render, and view hashes retain all 256 SHA-256 bits; only human presentation abbreviates them.
  The rejected single-level model put the output artifact hash on the logical node: it could not create a revision until rendering,
  contradicting lazy preview, and it made online and fallback source choice change document history.
- **The gap:** The initial DAG plan used input artifact hashes directly in node identity without reconciling that with the existing
  contract that edit commands commit state before pixels exist. It also did not say whether source fallback changes edit history.
- **The reach:** Cache reuse, refresh, undo, graph pagination, artifact GC, preview paths, and export correlation
  inherit collision-safe identities and crash-safe publication.
- **Verdict:** **Sound.** Edit history stays stable and cheap while cache correctness still follows the exact pixels used; paid
  nondeterministic attempts keep distinct lineage.
- **Confidence:** High.

### Slice 08a1 implementation — Revision batches use local node keys and must be root-complete

- **When:** Slice 08a1 implementation review, 2026-09-05.
- **The choice:** `commitRevision` accepts caller-chosen batch-local keys for new nodes, and inputs or roots reference either one
  of those keys or an existing full node id. Draft order is irrelevant. The writer resolves the graph from the final typed root,
  refuses cycles and missing/cross-photo references, and rolls back if any supplied draft is not reachable. For example, a caller
  can submit output → develop → source in any array order, but cannot quietly attach a second unused crop node to the revision.
- **The gap:** The requested atomic batch contract did not define how nodes created in the same transaction refer to one another,
  or whether extra unrooted drafts are legal.
- **The reach:** Develop, crop, layers, and future multi-node mutations get one stable request shape without provisional node ids,
  while failed or malformed requests cannot accumulate unreachable graph metadata.
- **Verdict:** **Sound.** Local keys are transaction-scoped addresses, not a second persistent identity, and root-completeness keeps
  the immutable store honest.
- **Confidence:** High.

### Slice 08a1 implementation — Unowned future node parameters start strict and minimal

- **When:** Slice 08a1 registry implementation, 2026-09-05.
- **The choice:** Every node kind has a distinct strict v1 parameter schema now. Kinds whose command/evaluator arrives later expose
  only their minimal explicit structural fields; unknown top-level fields fail instead of silently entering a recipe. `develop` is
  the deliberate exception requested by the architecture owner: its parameters are a direct generic JSON object in 8a1, so 8b can
  replace validation with the real develop dictionary without introducing or removing a wrapper. For example, crop accepts exactly
  `{x,y,w,h}`, while develop accepts `{exposure:1}` directly rather than `{values:{exposure:1}}`. The same registry owns each
  kind's supported recipe versions; both the application and v5 schema admit only version 1 until a later migration adds another.
- **The gap:** The architecture required typed per-kind ownership before several later slices have specified their complete payloads.
- **The reach:** Canonical recipe stability and malformed-input refusal are available now; each later owner must deliberately revise
  its kind schema alongside its evaluator and recipe version instead of relying on an open catch-all by accident.
- **Verdict:** **Sound.** It preserves the direct parameter shape and makes uncertainty visible at the registry boundary.
- **Confidence:** Medium; later slices still own the final fields and version transitions for their kinds.

### Slice 08a2 implementation — Current display artifacts are canonical RGB16 TIFFs

- **When:** Slice 08a2 artifact-publication implementation, 2026-09-05.
- **The choice:** The artifact owner normalizes oriented display-sRGB RGB pixels to an uncompressed 16-bit TIFF carrying the
  bundled `sRGB2014` profile, hashes those exact bytes, and stores them beneath a two-hex shard. Publication fsyncs the temporary
  file, installs it with an atomic no-replace link, verifies an already-present valid object byte-for-byte, atomically repairs a file
  whose bytes no longer match its content-addressed path, and fsyncs directory entries.
  This decision covers the source/output display artifacts that exist now; it does not settle the OPEN provider/upscale encoding.
- **The gap:** The plan required one normalized content-addressed representation and durable no-overwrite publication, but did not
  choose an encoding or shard width for the first executable graph.
- **The reach:** Source evaluation, deterministic reuse, restore validation, orphan discovery, and downstream preview production
  now agree on one byte identity. Future linear, mask, or provider artifact classes must add deliberate formats rather than silently
  reinterpret this display-RGB contract.
- **Verdict:** **Sound.** Lossless tagged TIFF makes the current pixels independently verifiable and keeps the unresolved provider
  size/round-trip measurement open.
- **Confidence:** Medium; storage cost is intentionally unoptimized until representative artifacts are measured.

### Slice 08a2 implementation — Existing photos acquire their initial graph on first graph-aware use

- **When:** Slice 08a2 preview integration, 2026-09-05.
- **The choice:** A migrated photo without a document gets one immutable source→output revision when `show`, `graph`, or the graph
  workbench first needs it. Concurrent initializers converge on the winner's revision. The alternative was a data migration that
  eagerly inserted graph history for every pre-08 photo before any graph consumer existed.
- **The gap:** Schema v5 introduced graph tables but deliberately did not backfill one logical graph per existing photo.
- **The reach:** Old libraries enter the graph model without a second compatibility renderer or a potentially large eager migration;
  after initialization every preview follows the same active-root/evaluator contract.
- **Verdict:** **Sound.** Lazy creation is deterministic from stable photo orientation, CAS-protected, and removes the legacy pixel
  path instead of preserving it beside the graph.
- **Confidence:** High.

### Slice 08a2 implementation — Revision-bound cursors finish the snapshot they started

- **When:** Slice 08a2 graph-inspection implementation, 2026-09-05.
- **The choice:** The opaque cursor carries and checks the photo, inspected revision, history mode, and last full node identity.
  If a newer revision becomes active between pages, later pages continue the original revision rather than fail or switch state.
  Invalid cursor structure is rejected before any database cast.
- **The gap:** The contract required revision binding so edits cannot mix pages, but did not choose snapshot continuation versus
  stale-cursor refusal.
- **The reach:** Agents can finish a consistent inspection while editing continues, and each request remains independently bounded.
- **Verdict:** **Sound.** Immutable revisions make continuation both simpler and more useful than invalidating a safe snapshot.
- **Confidence:** High.

### Slice 08a2 implementation — Restore preserves file trees by staging hard links

- **When:** Slice 08a2 restore integration, 2026-09-05.
- **The choice:** Before swapping the restored database directory into place, restore recreates `artifacts/`, `originals/`,
  `previews/`, and user-authored `presets/` in the staged sibling using hard links, then fsyncs the staged tree. Unsupported entries and symlinks are refused.
  After promotion, the command validates registered canonical artifacts and marks missing or corrupt files unavailable.
- **The gap:** The plan required database replacement without deleting potentially large library-owned file trees, but did not
  choose byte copying, moving after swap, or hard-link staging.
- **The reach:** Restore remains rollback-safe, does not duplicate large source/artifact bytes, and does not erase export/develop
  policy that SQL backups intentionally omit, while SQL metadata cannot claim a missing canonical file is available.
- **Verdict:** **Sound.** Source and stage share a filesystem by construction, so hard links provide an atomic, bounded-storage
  preservation mechanism compatible with the existing directory-swap journal.
- **Confidence:** High.

### Pre-slice 12 — Generated pixels optionally match destination density through a generative node

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** `generation.upscale=auto|off` defaults to `auto`; `--upscale`, `--no-upscale`, and
  `--upscale-model` override it. Full-frame reimagine targets oriented base dimensions; masked generation targets
  its base-space crop including padding. The planner chooses the smallest supported uniform generative scale
  covering both axes, then uses the one deterministic resampler once for exact geometry. It reuses any cached
  generative artifact with sufficient density; otherwise it reruns from the original generation artifact, never
  recursively from a resized/composited result. Scaling a layer upward maintains density under `auto`. Generic
  tiling and unexplained aspect stretching are forbidden; adapter-native tiling/reversible frame mappings are
  allowed and recorded. If limits stop short, exact dimensions still land with `density_satisfied:false`.
- **The gap:** The old fill normalization only matched provider response dimensions to the sent crop, not to
  the base image's real pixel density, and a later layer scale could silently magnify that deficit.
- **The reach:** Fill, reimagine, transform, refresh, preview, and export agree on what “full resolution” means.
- **Verdict:** **Sound.** It makes generated detail honest at the destination without making rendering itself
  nondeterministic.
- **Confidence:** High.

### Pre-slice 09 — Upscaling is an explicit external adapter with balanced guarded semantics

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** A dedicated `UpscaleAdapter` sits outside gateway transport and owns its display-sRGB color
  conversion, supported scales/limits, optional native tiling, and reversible frame mapping. A release pins a
  generative default; library then command overrides win. `auto` runs only after explicit adapter configuration,
  never because ambient credentials exist. The default aesthetic is balanced creative: medium detail synthesis,
  high resemblance, and a versioned guarded prompt that uses original intent as context while forbidding a repeat
  of the replacement operation. Both original and derived prompts are provenance. A real-provider comparison
  chooses adapter-specific controls when credentials exist; the fake-adapter contract and build never wait for it.
- **The gap:** Vercel's four general routes cannot represent every purpose-built SOTA upscaler, while routing to
  a second vendor silently would violate user intent and make model behavior unreproducible.
- **The reach:** Provider selection, consent, doctor, settings, events, cost, prompts, and future hosted/local
  implementations share one stable boundary.
- **Verdict:** **Sound.** External differences stay at the external boundary without runtime capability guessing.
- **Confidence:** Medium until the live model/control spike runs.

### Pre-slice 12 — Partial generative success remains useful and refresh follows current lineage

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** If generation succeeds and upscaling fails, the generated branch becomes active with an
  `upscale_failed`/configuration warning; no failed image node enters the graph. Retrying upscale reuses that exact
  generation. Refreshing generation instead rebinds it to the current upstream develop node and reconstructs
  descendants, so a brightness change followed by regenerate is visible to the provider. Compatible later develop
  changes may add deterministic compensation to old generated branches; incompatible ones make the old lineage
  explicitly stale. Mask exactness is proved at the mask-composite boundary against that node's base input, not
  against a final output that may contain later global edits. Offline low-resolution context remains usable, but
  source-context density and generated-output density are reported as separate facts.
- **The gap:** A flat refresh record cannot express which expensive stage to rerun, and final-image equality would
  misclassify legitimate downstream edits as mask leakage.
- **The reach:** Failure recovery, cost, stale warnings, undo, strict compositing, and provenance become precise.
- **Verdict:** **Sound.** The system retains paid successful work without claiming a failed enhancement happened.
- **Confidence:** High.

### Pre-slice 08 — PGlite backup remains metadata-only and restore preserves canonical artifacts

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** `backup` remains a small SQL recovery mechanism for PGlite corruption, not a full media backup.
  Before canonical DAG artifacts land, restore is narrowed from replacing the entire library directory to replacing
  database state while preserving artifacts, originals, previews, and backups. A restored node may honestly report
  an already-missing artifact; SQL does not promise to recreate it.
- **The gap:** Today's whole-directory restore is safe only because canonical external layer/generated artifacts do
  not exist yet. Later it would delete the very files intentionally excluded from SQL.
- **The reach:** Slice 08 artifact layout and restore tests must land together before generated paid state exists.
- **Verdict:** **Sound.** It keeps the intentionally simple backup while preventing recovery from causing media loss.
- **Confidence:** High.

### Slice 09a — Gateway rate limiting has a short bounded retry window

- **When:** Slice 09a provider transport implementation.
- **The choice:** Gateway calls make three total attempts for HTTP 429 only. A valid `Retry-After` value wins but is capped at two
  seconds; without one, retries wait 100 then 200 milliseconds. Each attempt has a 30-second abort ceiling. Tests may inject a
  one-to-five-attempt ceiling and a fake clock. Other HTTP failures remain immediate because the contract does not prove they are
  safe to repeat: 400/401/403/404 map to unconfigured input or credentials, while other statuses and transport failures map to
  temporary provider failure. URL-returned images have the same 30-second ceiling and a 64 MiB streaming cap. The fake gateway
  separately rejects request bodies above 32 MiB so malformed fixtures cannot consume unbounded memory.
- **The gap:** The slice delegated the retry policy and required only that rate-limit retries be bounded.
- **The reach:** All four gateway routes share the same latency ceiling and attempt provenance; a real deployment with sustained
  rate limits may fail sooner than a vendor SDK would.
- **Verdict:** **Sound.** It gives brief provider throttling a chance to recover without hiding prolonged unavailability or
  retrying unspecified failures.
- **Confidence:** Low to medium; live 09b timings and provider error bodies may justify different isolated ceilings or status
  classification.

### Slice 09a — Provider settings use purpose-scoped rows and explicit per-upscaler consent

- **When:** Slice 09a doctor and selection implementation.
- **The choice:** The existing settings table stores three JSON objects: `models` for purpose-to-model overrides, `generation` for
  the `auto|off` upscale preference, and `providers.upscale[model].configured` for explicit consent. Unknown fields are ignored so
  later slices can extend those objects. A command model override still implies a request to upscale, but it cannot bypass the
  configured bit.
- **The gap:** The plan fixed precedence and consent semantics but not the durable JSON shape that represents them.
- **The reach:** Doctor, future generation verbs, migrations, and configuration tooling inherit one explicit distinction between
  choosing a model and authorizing an external service.
- **Verdict:** **Sound.** Purpose-specific model choice stays independent from provider authorization, and ambient credentials
  cannot become consent.
- **Confidence:** Medium until a settings-writing command exercises the shape in a later slice.

### Slice 09a — External execution details extend the existing DAG execution record

- **When:** Slice 09a provenance integration.
- **The choice:** Schema v7 adds one nullable, object-constrained JSON column to `node_executions`. The JSON contains only a bounded
  whitelist of external facts; graph inspection composes it with canonical node parameters, ordered input node/artifact hashes,
  and output artifact facts already owned by relational tables. Unknown transport/debug/auth fields are stripped at ingestion,
  while missing or recipe-mismatched provenance prevents a generate/upscale success from committing.
- **The gap:** The slice required complete bounded provenance but did not choose between a new parallel record model, many nullable
  columns, or an extension of the existing execution owner.
- **The reach:** External operations remain part of ordinary graph lineage, secrets do not enter the catalog, and future provenance
  additions must fit the bounded whitelist rather than create another execution identity.
- **Verdict:** **Sound.** One owner preserves the logical/execution split while the relational graph remains authoritative for
  facts it already stores.
- **Confidence:** High.

### Slice 09a — Provider geometry normalizes once at the adapter boundary

- **When:** Slice 09a image and structured adapter implementation.
- **The choice:** Structured `box_2d` values are interpreted as Gemini-style `[top,left,bottom,right]` coordinates on a 0–1000
  scale, rounded into integer `[x,y,w,h]` pixels against the first supplied image. Image responses decode to display-sRGB RGB16,
  reuse the shared Rust pixel-center resampler when dimensions differ, and encode the normalized result as an 8-bit PNG. Sharp
  only decodes and encodes; it does not own the resize.
- **The gap:** The contract assigned frame conversion and adapter-internal color conversion but did not spell out coordinate order,
  rounding, or the normalized PNG sample depth.
- **The reach:** Callers see canonical pixel geometry regardless of provider dialect, while future non-Gemini structured adapters
  may need their own coordinate converter and later delivery work may revisit the intermediate PNG depth.
- **Verdict:** **Sound.** Provider-specific conventions terminate at the provider boundary and the repository keeps one resize
  kernel.
- **Confidence:** Medium; the geometry is pinned by fixtures, while live-provider color/sample evidence remains for 09b.

## Needs user

### Slice 09a — The fake upscaler is the provisional release default

- **When:** Slice 09a fixed-model table implementation.
- **The choice:** Until the 09b comparison selects a live service, `photoctl/fake-upscale-v1` occupies the release-default slot.
  It is deterministic and still requires explicit configuration, so ordinary `auto` operation reports unconfigured instead of
  synthesizing pixels or selecting from ambient credentials. 09b must replace this placeholder with the evidence-selected adapter
  and model before a generative release.
- **The gap:** The slice requires a fixed release default and a complete fake contract, while explicitly leaving the first live
  adapter/model open to the later spike.
- **The reach:** Selection and doctor have a concrete non-magical identifier today, but any downstream code that mistakes the fake
  for a shippable model would expose fixture behavior.
- **Verdict:** **Needs-user.** The placeholder is safe and reversible for contract work, but only the 09b visual/cost evidence can
  authorize a real release default.
- **Confidence:** Low by design.

### Slice 08a2 — Graph inspection uses provisional response bounds

- **When:** Slice 08a2 graph-inspection implementation, 2026-09-05.
- **The choice:** `graph show` returns at most 100 nodes per page (50 by default) and includes at most 32 ordered inputs in a node
  summary. `graph node` includes at most 64 inputs, consumers, and executions plus 64 KiB of parameter JSON, while returning exact
  counts and explicit truncation flags. The tests keep a serialized page below 1 MiB, well under the daemon's 16 MiB frame cap.
- **The gap:** The contract required bounded records and pagination but did not set product-facing numeric limits.
- **The reach:** Very wide composites or highly reused nodes require follow-up inspection tooling to reach records beyond the
  detailed cap; ordinary lineage pagination remains complete.
- **Verdict:** **Needs-user.** These isolated limits are safe and reversible, but representative large graphs should determine
  whether 32/64/100 are the right usability/performance tradeoff before release.
- **Confidence:** Low until measured on real edited libraries.

### Slice 05 — Collision `skip` is a successful no-write result with requested-state identity

- **When:** Slice 05 export protocol.
- **The choice:** If `client.jpg` already exists and the caller requests `--on-collision skip`, the item returns success with
  `skipped:true`, the existing file's dimensions and byte count, and the render hash that this command snapshotted. A render hash is
  a fingerprint of the requested edit state; it is not proof that the pre-existing file contains those pixels. No export-history row
  is inserted because this invocation wrote nothing. The alternative is to report skip as a failure, omit the required hash, or add
  a second nullable artifact-provenance field that current files cannot reliably supply.
- **The gap:** The plan defined skip policy and required a render hash on every successful item, but did not define whether skipping is
  success or what the hash means when no new artifact is created.
- **The reach:** Scripts can distinguish completed writes from harmless skips without treating an existing destination as an error;
  they must not interpret a skipped item's hash as verified provenance for that existing file.
- **Verdict:** **Needs-user.** Keep the reversible provisional contract because it makes batch retries idempotent and explicit. Before
  release, change the protocol if `render_hash` must always certify file contents rather than identify the state the command attempted.
- **Confidence:** Low.

### Slice 04 — Import and list use fixed bounded-work windows

- **When:** Slice 04 performance implementation.
- **The choice:** Import prepares four files concurrently, list pages 64 photos at a time, and an active import may remain silent
  for ten minutes before the daemon client declares it hung. These values bound memory and avoid the old 31-second total timeout;
  none changes ordering or persisted results.
- **The gap:** The slice delegates scan concurrency and requires bounded streaming but does not select concrete window sizes or
  an idle ceiling for very slow removable media.
- **The reach:** Peak memory, filesystem parallelism, first-row latency, and hung-daemon detection inherit these defaults.
- **Verdict:** **Needs-user.** The values are isolated reversible performance policy; tune them after a real large-drive import if
  four workers overload the disk or ten silent minutes is too short.
- **Confidence:** Low until measured on the founder drive.

### Slice 02 integration — CLI tags trim boundaries but preserve case and Unicode

- **When:** Slice 02 integration review.
- **The choice:** A command such as `tag <id> --add "  Ceremony  "` stores `Ceremony`: boundary whitespace is removed, a
  whitespace-only tag is rejected, and case plus Unicode spelling remain exact. Repeating the padded or unpadded form is the
  same idempotent request. The alternative would either preserve invisible accidental differences or impose case folding and
  Unicode normalization before the product's search and XMP behavior is fully exercised.
- **The gap:** The plan required exact idempotent tag values but did not define user-input normalization.
- **The reach:** Slice 04's filters, XMP keyword union, search indexing, and human tables inherit tag identity semantics.
- **Verdict:** **Needs-user.** The reversible provisional call trims only boundary whitespace and otherwise preserves what the
  photographer typed. Before release, change the single command boundary if tags should be case-insensitive or Unicode-normalized.
- **Confidence:** Low.

### Slice 01b — Rendered JPEG fallback uses quality 88

- **When:** Slice 01b render pass.
- **The choice:** Exact-copy online export preserves any eligible full-frame JPEG source bytes. When photoctl must render a
  rotated image or encode the pinned 1616 preview, Sharp uses JPEG quality 88. Lower values make smaller
  files with more visible loss; higher values cost bytes without guaranteeing a useful visual gain.
- **The gap:** Slice 01 requires a JPEG encoder but does not choose its quality. The later A6 delivery
  example uses 88, so implementation borrowed that value rather than inventing a second default.
- **The reach:** Offline fallback appearance and file size inherit this value until slice 05 owns named
  export presets and delivery defaults.
- **Verdict:** **Needs-user.** Keep 88 as the reversible provisional call; change the slice-05 preset
  data if David wants a different delivery tradeoff.
- **Confidence:** Low.

### Slice 01b — An ambiguous photo prefix uses `not_found` with an explicit reason

- **When:** Slice 01b library pass.
- **The choice:** Suppose two photo IDs begin with `0199a7c2`. `photoctl show 0199a7c2` must not pick
  whichever database row sorts first. The library rejects it with the existing `not_found` data-error
  code and adds `reason:"ambiguous"`; a longer prefix then resolves normally. The alternative is to add
  a new `ambiguous_id` member to the public error-code union, which is clearer but expands a protocol
  the plan declared closed without naming that code.
- **The gap:** The plan requires unambiguous prefixes but defines neither the ambiguous response nor a
  dedicated error code.
- **The reach:** Every verb that accepts photo IDs will expose this error shape, so scripts may branch
  on the code and reason.
- **Verdict:** **Needs-user.** The reversible provisional call keeps the closed code list and exit 65;
  before release, add `ambiguous_id` if callers should distinguish ambiguity at the top-level code.
- **Confidence:** Low.

### Slice 01a — The provisional daemon idle timeout is fifteen minutes

- **When:** Slice 01a.
- **The choice:** A library stores `daemon_idle_ms=900000`, so the daemon planned for slice 02 will exit
  after fifteen minutes without commands or background work. Five minutes would save memory sooner but
  would cause more cold starts during an editing session; never exiting would keep resources resident.
- **The gap:** The slice required the setting but did not choose its initial value; the planning map
  called fifteen minutes a proposal rather than a settled product decision.
- **The reach:** Slice 02's daemon lifecycle and perceived command startup latency will use this value.
- **Verdict:** **Needs-user.** This is a product tradeoff between resource residency and responsiveness.
  The reversible provisional call is fifteen minutes, matching the planning map; change the stored
  default before release if a different editing cadence is preferred.
- **Confidence:** Low.
