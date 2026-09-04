# Implementation choices

## Sound

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
- **The gap:** The plan lists accepted extensions and the metadata columns but does not say which tags
  are required when a supported non-RAW image has sparse metadata.
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

### Slice 01b — `Image16` is full-range, display-referred sRGB in an interleaved typed array

- **When:** Slice 01b render-owned pass.
- **The choice:** Decoding an embedded JPEG produces three unsigned 16-bit channel values per pixel in
  red-green-blue order, stored as a `Uint16Array`. “Full-range” means JPEG white becomes 65535, not 255
  placed inside a larger integer type; `space:"display-srgb"` says the values are ready for display and
  are not the scene-linear camera data introduced by later RAW decoders. Sharp's plain `ushort` cast
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
- **The choice:** The render package receives a final output path, an optional online RAW-file range,
  and an optional pinned JPEG path. It never opens the photo catalog or decides where a volume is
  mounted. In plain control flow: `read online range → exact-copy when orientation is 1 → otherwise
  render; if the online read fails → try pinned preview and warn; if neither can be read → file_offline`.
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
  empty when a JPEG or TIFF carries no corresponding EXIF fields. Capture time and its UTC offset may
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

## Needs user

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
