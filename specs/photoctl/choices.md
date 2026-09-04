# Implementation choices

## Sound

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
  or decides where a volume is mounted. In plain control flow: `read preferred online source →
  exact-copy only when it is a full-frame orientation-1 JPEG → otherwise render; if the online read
  fails → try pinned preview and warn; if neither can be read → file_offline`.
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
- **The choice:** Before exact-copy export, photoctl recomputes the fixed content key and byte size for
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

## Needs user

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
