# photoctl v1 — what shipped and why

photoctl is a CLI-first photo library and non-destructive editor for Mac with a
portable core: TypeScript on Node 24, PGlite, a Rust napi addon, a Swift Core
Image helper, the Vercel AI Gateway for generative work, and explicitly
configured image-processing adapters. A photographer shoots, culls, rates and
delivers from a terminal; an agent drives the same verbs one-shot from a chat
loop. Every capability is a verb with a JSON envelope; there is no GUI product.

This folder is the closed record of the v1 build. The code is the source of
truth for *how*; this document holds what the code cannot: why the shape is
what it is, the invariants future work must keep, the decisions made on the
user's behalf, what was tried and rejected, and the evidence the result was
held to. Build order, slice checklists and per-pass verification narratives
were deliberately cut when the spec closed.

Companion records in this folder:

- [`choices.md`](choices.md) — the decision ledger: every material choice an
  implementing agent made where the plan was silent, with verdicts.
- [`visualizations/map.html`](visualizations/map.html) — the kickoff
  four-quadrant map and its original decision ledger (D1–D40 + A′);
  [`assets/original-decisions-review.md`](assets/original-decisions-review.md)
  maps each of those decisions to its current owner.
- [`assets/spec-input.md`](assets/spec-input.md) — David's original spec and
  delta; [`assets/drafts/`](assets/drafts/) — the blind plan drafts that were
  synthesized into the build ladder.
- `assets/` — retained evidence, indexed at the end of this document.

## Purpose and shape

The product settles a few things the input spec left open, and the whole
architecture follows from them:

- **Human and machine share one surface.** `dispatch(request, ctx)` in
  `packages/commands/src/dispatch.ts` is the only command API. The CLI
  serializes it, the daemon runs it, `--no-daemon` calls it in-process, and a
  future MCP server (never built; it stayed unspecified until real) would call
  it too. JSON is the default; `--human` is a renderer stripped before the
  request is built; exit classes are fixed (`0` ok, `2` usage, `65` data,
  `69` unavailable, `75` retry) and written down once in
  `packages/protocol/src/envelope.ts` (`exitCodeFor`).
- **Originals are never touched.** The library owns edit state as an immutable
  image DAG; writing metadata beside a source is an explicit `xmp write`; new
  files may be written beside originals at the user's chosen destination, but
  original bytes are never overwritten regardless of format.
- **Deterministic work is local, invention is remote.** RAW decoding
  (vendored LibRaw), develop, geometry, resampling, masks, healing and SAM
  segmentation run in `crates/photoctl-image` on the CPU and are
  byte-reproducible; non-RAW containers decode through sharp and Core Image
  RAW decoding lives in the Swift helper, both behind one decoder seam. Only pixels
  that must be invented (fill, outpaint, reimagine, relight, generate,
  upscale) go to a configured provider, and their returns are retained as
  purchased artifacts.
- **Fidelity is guaranteed by the application, not the model.** Every pixel
  outside a masked edit is copied exactly from the base input by the strict
  composite node; a model is never trusted to leave pixels alone.
- **Limitations are reported, not hidden.** Soft state returns `warnings[]`
  with a closed `WarningCode` and exit 0; missing capability fails with a
  named code; nothing silently substitutes a lower-quality source, a different
  recipe, or a guessed value.

## Verification policy

The acceptance target is David's Apple Silicon Mac and camera workflow. Intel
Mac and Linux verification are not completion or release requirements; the
portable code and its tests remain, and unverified platforms are never claimed
as passed. SSH/headless acceptance and actual Lightroom Classic interoperability
verification were removed by explicit user direction (2026-09-07); the XMP
implementation and its authored Classic-style fixtures stay, but those fixtures
are never relabelled as verified Classic output.

GitHub CI is a fast smoke subset (lint, typecheck and four small unit tests).
The full suite — host TypeScript, Rust, Docker functional with real SAM
weights, and macOS packed-install — is a local closeout gate run once at the
end of an implementation, never a feedback loop. The last full run is recorded
in [`assets/final-closeout-2026-09-08.md`](assets/final-closeout-2026-09-08.md)
and the closing gate for this archive in
[`assets/spec-close-2026-09-08.md`](assets/spec-close-2026-09-08.md).
Later correctness fixes and their current verification status are tracked in
the [post-close review](assets/post-close-review-2026-09-08.md).

## The reasons — why it works this way

**Bun installs, Node runs.** Bun 1.3 is the package manager, workspace/catalog
resolver and Turbo launcher (the `~/dev/duet` precedent); Node 24, pinned in CI
and the Docker seam, executes every line of project code including spawned
workers, because Node does not remap
`./x.js` imports to `.ts` and the test harness must spawn the *built* CLI as a
real process. A precedent worker spawned with `bun` importing `.ts` was the
recorded failure.

**One daemon owns the library for its lifetime.** PGlite is single-writer, so
`apps/daemon/src/server.ts` holds the one kernel advisory lock
(`packages/library/src/lock.ts`, `.photoctl-open.lock`) and runs every command
serially through a bounded queue. The lock is a `flock` on an open descriptor,
not a PID file: a killed process releases it atomically, so no stale-unlink
algorithm exists. The client spawns the daemon with the locked descriptor
inherited as fd 3 so ownership is continuous through startup. A lost response
after sending is reported as `daemon_unavailable` with an unknown outcome and is
never replayed; callers inspect library state before retrying. The daemon
proves liveness with a keepalive frame every second while a request is queued
or executing, so the client's idle ceiling is one rule for every verb
(`requestTimeout` in `packages/commands/src/daemon-client.ts`) and a paid
generation waiting on a slow provider cannot be misreported as dead.
Keepalives belong to the live connection, not the handler: disconnecting stops
keepalive writes. Timer cleanup itself does not cancel work or replay a purchase;
handlers retain their existing progress and stream failure behavior.

**Identity is sampled, promoted only on collision.** A file's content key is a
SHA-256 over size plus the first and last mebibyte (`packages/library/src/identity.ts`).
A second candidate with the same key triggers a persisted full hash of both;
equality that cannot be established (offline original) refuses rather than
guesses. Photos, originals and files are three owners: `photos` owns logical
identity, culling and the edit document; `originals` owns each distinct
original's byte identity, kind and capture metadata; `files` owns locations of
one original. A RAW and its camera JPEG are two originals of one photo; two
copies of a RAW are two locations of one original. This split exists because
pairing different bytes inside `photos` would have corrupted deduplication,
source validation and relocation.

**Every photo has an offline preview.** Import is not successful until a
pinned, source-independent 1616-pixel JPEG and its `cache_index` row exist;
re-import repairs either half. Edited previews are lazy, prunable derivations
keyed by the canonical `render_hash`; `show` is the synchronization point and
returns only after the requested view is readable. One full-frame display
master per render feeds every detail crop so zooming never re-evaluates the
graph and never upscales the 1616 preview and calls it detail.

**The edit is an immutable DAG with full hashes.** Nodes are never edited in
place; a mutation inserts nodes and a document revision in one compare-and-set
transaction (`packages/render/src/graph/store.ts`). Logical identity is
`{kind, recipe_version, canonical parameters, ordered input node ids}`, so a
`render_hash` commits without pixels; evaluation identity adds ordered input
artifact hashes and source provenance; nondeterministic (paid) nodes also carry
an execution id. Canonical artifacts are oriented scene-linear Rec.2020 float32
TIFFs published and fsynced before the graph transaction redirects a root; a
crash can leave an orphan, never an active node with missing pixels. Undo and
redo walk stored revisions; they never replay commands or purchases.

**One color core, one resampler, one compositor.** Develop math (levels → WB →
matrix → operators → TRC), delta kernels, noise reduction, masks, resampling,
composite, heal and draw live in `crates/photoctl-image`; sharp probes and
decodes non-RAW containers, encodes and tags ICC/XMP/EXIF, and performs the
final delivery downscale, but no other pixel-space resample. Composition is
scene-linear Float32 with exact preservation at zero coverage. Operator math is
ported from OpenColorIO's grading operators (BSD-3, not linked) rather than
from darktable/ART (GPL, never linked). LibRaw is vendored under CDDL-1.0 and
built without OpenMP; CIRAW is an explicit alternative behind the same decoder seam.

**Highlights are reconstructed by default, in float, before any reduction.**
Upstream integer staging clipped samples that float processing retains, so
recovery runs on the native neighborhood between white balance and the matrix
(`crates/photoctl-image/src/highlight.rs`, method `libraw-spatial-float-v1`).
The requested versus actual treatment is part of cache identity; NULL means
unknown, never "disabled". The user approved the resulting rendering on
2026-09-07 (see visual provenance).

**Coordinates are oriented, uncropped base pixels everywhere.** `bbox` is
`[x,y,w,h]` in that space; crop and straighten apply last; adapters convert
external frames once (`packages/render/src/coordinates.ts`,
`transforms.ts`) and never leak them. `--norm` expresses coordinates relative
to original dimensions. A layer's frame derives from exact execution lineage,
never from matching dimensions, because equal RGB bytes are not evidence of
equal coordinates.

**Generation is strict about what it sends and what it keeps.** The provider
sees the current photographic composite (excluding final markup) cropped to
the selection plus context, with outside-visible pixels black-padded and
recorded; the mask is clipped to the visible footprint; the composite protects
every zero-mask pixel exactly. Generation is the commit boundary; a failed
upscale retains the generated branch with `upscale_failed`. Every provider
return, including rejected work, is journaled with its original encoded bytes
(`packages/render/src/provider-images/`), and retained bytes are never
deleted automatically.
Refresh is a stored program that rebinds to current develop; reconnect
promotes only deterministic work; only explicit refresh spends money again.
Upscaling is a separate `UpscaleAdapter` boundary that requires explicit
configuration — ambient credentials are not consent to send pixels to another
vendor — and the release default is a deterministic fake until a live adapter
is evidenced (ledger U2).

**Selection is an initial SAM mask plus manual correction.** SAM 2.1 (CPU
only, hash-pinned ONNX export) supplies the starting mask; `segment --layer
--operation add|subtract|replace` corrects the same layer in base coordinates
without another model call, and undo/redo make over-correction reversible.
The user confirmed this as the v1 scope on 2026-09-08 (ledger S94): automatic
fine-edge quality on hair, wires and foliage is a documented limitation, not an
open gate.

**Paired originals were a clean-start schema change.** The user chose to change
the development schema directly and rebuild disposable catalogs rather than
build a migration, backfill or compatibility adapter. Historical
`fixtures/libraries/schema-v*.pgsql` dumps remain as evidence, not as supported
input. Never reset a real library automatically.

## Invariants the code must keep honoring

Grouped by owner. Each one is enforced by tests named in the pointers section;
violating one silently breaks a promise the CLI makes to agents.

### Protocol and transport
- `ErrorCode` and `WarningCode` are closed unions; the exit mapping is written
  once. Batch verbs (`rate flag label tag develop export xmp remove embed`)
  return per-item `results`; single-target verbs take one id. Explicit `embed`
  is capped at 1,000 ids; `--all` returns exact totals and at most 100
  failure rows with `failures_omitted`.
- `--human` never changes JSON, exit codes or stderr NDJSON. `--stream` emits
  bounded row frames; the terminal envelope is `{rows:[],total}`.
- The daemon frame ceiling is 16 MiB and never grows; graph inspection is
  paginated with revision-bound cursors instead.
- Warn, never refuse, on soft state (offline source, stale layer, unfilled
  vacancy, uncovered canvas). Invalid requests, unavailable required pixels and
  destination failures still fail with a code.

### Library, identity and files
- A broken or version-mismatched library is refused with a recovery command
  (`restore`), never recreated, quarantined or auto-upgraded. `fsync` and
  `synchronous_commit` are asserted on after every open.
- One lock per library, released on every open/throw path; timeout returns
  `library_locked` with `holder_pid` and `waited_ms`.
- Locators are volume UUID plus relative path; library-owned copies use the
  reserved `photoctl-library` volume. A different drive at the same mount path
  can never be mistaken for the original; a missing path selects nothing.
- A photo has at most one original of each kind; a different JPEG cannot
  silently join an established pair; an occupied location whose bytes now
  identify a different original is refused. Removal verifies stored identity
  before moving a file to Trash and every disk removal requires `--yes`.
- XMP: the catalog is authoritative until `xmp write`; foreign nodes survive
  byte-for-byte; sidecar targets are logical-photo scoped and compared
  case-insensitively within a volume, refusing possible aliases.
- Backups are metadata-only SQL snapshots; restore preserves `artifacts/`,
  originals, previews and presets and reports `artifact_available:false`
  rather than fabricating pixels.

### Import and previews
- Imports are capability-based: every decodable single-frame still is
  admitted by probing bytes; extensions are hints; corrupt, animated or
  multipage input returns `unsupported_file` and creates no row.
- The shared cache directory is prepared before admission; per-photo failures
  join the partial result without starving other units; unexpected faults
  still abort.
- Preview materialization is single-flight and inspection-safe: waiters share
  one artifact, a failed attempt clears the flight, `last_used` updates only
  after the returned file is readable, and prune never removes an in-flight
  artifact or one returned within the previous 30 minutes.
- Every preview and view is an orientation-applied opaque JPEG tagged with the
  bundled `sRGB2014.icc`; export may use another profile, inspection never
  guesses.

### Graph, develop and layers
- Nodes are immutable; hashes are full SHA-256 (`--human` alone abbreviates).
- Canonical artifacts keep unclamped scene-linear samples; no clamp before
  output. Determinism is structural: the crate uses no float atomics, and its
  one threaded kernel (noise reduction) works in fixed row blocks with an
  ordered merge, so the same dictionary and decoder produce the same bytes.
- Develop tiers: exposure, brightness, contrast, saturation, vibrance, black
  point and small white-balance moves are compensated on existing layers by a
  scene-linear delta; everything else marks dependent layers `stale`.
- Layer mutations create one revision and one composite root; user-visible
  layers are ordered roots, not containers for private pipelines. Only
  `blend='normal'` exists. A moved subject keeps its untransformed silhouette
  as a vacancy that stays magenta until filled (ledger U4).
- Renderer semantics participate in cache identity through a semantic
  revision, so a pixel-processing correction invalidates cached views without
  deleting history.
- Markup is one ordered vector document in base space, rasterized with the
  bundled Inter font and projected last; it is removable by ordinary undo.

### Canvas and full-frame generation
- Outpaint never changes the original, photo identity or catalog dimensions;
  extent belongs to enabled borders independent of opacity; uncovered canvas
  renders opaque scene-linear black and warns `canvas_uncovered` before any
  cache hit can bypass it (ledger U3).
- Each border retains the visible input frame it was authored around;
  removing a border never revalidates or clips a later crop; cropped-out
  content never reappears because the canvas grew.
- Full-frame edits (reimagine, relight) consume the current photographic
  result excluding final markup — user-approved 2026-09-07 — and are placed
  as removable layers, never borders.

### Providers and cost
- No runtime capability discovery: model ids are a fixed table; gateway
  `modalities` are never read. Missing key → `provider_unconfigured`;
  throttling → bounded retry then `provider_busy`.
- Live native-mask fills refuse `provider_unverified_mask` until the
  mask-polarity smoke has recorded polarity; the smoke has never run with a
  configured key.
- Embedding is consent-gated (`init --embed auto` or explicit `embed`); the
  multimodal request body is a versioned provisional candidate that only a
  purpose-key smoke may promote.

### Segmentation
- CPU execution provider only; weights are hash-verified and fetched from the
  installed version's release URL or an explicit `models_base_url` mirror,
  never a moving "latest". A model bytes mismatch fails loudly.
- The encoder is cached per photo and tier in the daemon, evicted LRU, and
  checks rendered pixels so a develop change cannot reuse stale features.
- Mask logits are projected into uncropped base coordinates before
  thresholding; pixels outside the crop are never selected.
- The 5 GB RSS canary is an investigation signal, not a limit or an
  optimization target (user direction, 2026-09-06).

### Release
- The root package version is the one owner for the CLI, package manifests
  and the Swift helper's `--version`; drift fails packing.
- A release tag publishes packages and their matching model assets together;
  tags are never pushed as experiments; actual public publication remains
  unverified (ledger U26).

## Contracts — single owners

| Concept | Sole owner |
|---|---|
| Envelope, closed codes, exit mapping, stderr events, `CommandRequest`, per-verb Zod shapes, frame protocol | `packages/protocol` (leaf) |
| Dispatcher, verb handlers, daemon client, source ladder | `packages/commands` |
| Library handle, lock, settings, migrations, backup/restore, identity, locators, Trash, XMP, cache index, search fusion | `packages/library` |
| Content-based image probe registry, EXIF and timezone, embedded-preview index, cache tiers and prune | `packages/importer` |
| Decoder seam and adapters, immutable DAG, artifacts, preview coordinator and views, develop dictionary/tiers/presets, layers and transforms, fill/outpaint planning, markup, export planning | `packages/render` |
| Gateway transport, image/structured/embedding adapters, `UpscaleAdapter` registry, fixed model table, versioned prompts, cost table | `packages/providers` |
| Color core, delta kernels, noise reduction, highlight reconstruction, resample/transform, masks, composite, SAM runtime, heal, draw, LibRaw wrapper | `crates/photoctl-image`, `crates/libraw-sys` |
| Core Image RAW decode helper | `helpers/mac` (`photoctl-mac`) |
| Daemon server, embed worker, background registry | `apps/daemon` |
| Global flags, process exit and human rendering (per-verb argument parsing belongs to `packages/commands`) | `apps/cli` |
| Development reports (`wb`) — never shipped | `apps/workbench` |
| Built-CLI spawn harness, fake gateway, hold-lock helper, fixture manifest reader | `packages/test-harness` |
| Reference inputs and the facts they establish | `fixtures/` (see its README) |

## Pointers into the code

Entry points a reader can grep for, by area. Tests named here pin the
behavior above; they run as real processes against the built CLI unless they
are pure-logic unit tests.

- **Protocol:** `packages/protocol/src/{envelope,events,frames,request}.ts`,
  `verbs/*.ts`; tests `envelope.test.ts`, `frames.test.ts`.
- **Transport:** `packages/commands/src/{execute,daemon-client}.ts`,
  `apps/daemon/src/server.ts` (`KEEPALIVE_INTERVAL_MS`); tests
  `apps/daemon/src/server.test.ts`, `apps/cli/src/{daemon-lifecycle,concurrency-race,fresh-open}.test.ts`,
  `test/macos/daemon-performance.test.ts`.
- **Library:** `packages/library/src/{open,lock,identity,locators,trash,backup,restore,restore-journal}.ts`,
  `migrations/`, `xmp/`, `search/`; tests `lock.test.ts`, `identity*.test.ts`,
  `restore*.test.ts`, `xmp/*.test.ts`, `apps/cli/src/{library-lifecycle,backup-restore,xmp}.test.ts`.
- **Import and cull:** `packages/importer/src/{formats,scan,pipeline,exif,embedded,cache,cache-prune}.ts`,
  `packages/commands/src/handlers/{import,cull}.ts`; tests
  `packages/commands/src/{import,reimport-idempotent,paired-import,cull}.test.ts`,
  `apps/cli/src/{offline-preview,show-path,camera-jpeg,paired-originals-journey}.test.ts`.
- **Decoders and highlights:** `packages/render/src/decoder.ts`,
  `crates/libraw-sys/src/photoctl_libraw.cpp`, `crates/photoctl-image/src/{develop.rs,highlight.rs}`,
  `helpers/mac/Sources/photoctl-mac/PhotoctlMac.swift`; tests
  `apps/cli/src/decoder-libraw.test.ts`, `test/macos/decoder-{ciraw,oracle}.test.ts`,
  `packages/commands/src/source-treatment.test.ts`.
- **Graph and artifacts:** `packages/render/src/graph/{types,recipes,store,evaluator,projection,output,canvas-support}.ts`,
  `packages/render/src/artifacts/`; tests `graph/*.test.ts`, `artifacts/artifact-publication.test.ts`.
- **Develop:** `packages/render/src/develop/`, `crates/photoctl-image/src/develop/`,
  `crates/photoctl-image/src/{tone_curve,horizon}.rs`; tests `develop/*.test.ts`,
  `packages/commands/src/develop-format-matrix.test.ts`, `apps/cli/src/{undo,crop,white-balance,filter}.test.ts`.
- **Preview and export:** `packages/render/src/{preview,preview-coordinator,preview-artifact}.ts`,
  `packages/render/src/export/`, `packages/commands/src/handlers/{show,export}.ts`;
  tests `preview*.test.ts`, `export/*.test.ts`, `packages/commands/src/{show,export-*}.test.ts`,
  `apps/cli/src/{export-integrity,agent-preview-loop}.test.ts`.
- **Layers and selection:** `packages/render/src/layers/`, `transforms.ts`,
  `mask-operations.ts`, `crates/photoctl-image/src/{mask,resample}.rs`,
  `packages/commands/src/handlers/{layer,segment}.ts`; tests
  `packages/commands/src/{layers,segment-refinement,segment-text-fake}.test.ts`,
  `test/model-runtime/segment-at.test.ts`.
- **Fill, outpaint and full-frame:** `packages/render/src/fill/`,
  `packages/render/src/{reimagine,full-frame-refresh,generate}.ts`;
  tests `packages/commands/src/{fill-*,person-move,outpaint-*,full-frame-geometry,reimagine-*,generate,retouch,markup,auto-enhance}.test.ts`,
  `apps/cli/src/*-journey.test.ts`, `test/journeys/`.
- **Providers:** `packages/providers/src/{gateway,table,cost}.ts`, `adapters/`,
  `upscale/`, `prompts/`; tests `provider-*.test.ts`, `upscale/upscale-adapter.test.ts`,
  `apps/daemon/src/workers/embed-consent.test.ts`, `apps/cli/src/{embed-drain,search-embed}.test.ts`.
- **SAM runtime:** `crates/photoctl-image/src/sam2*.rs`, `crates/photoctl-image/ort/`,
  `scripts/export-sam2.py`, `fixtures/models.json`, `packages/library/src/models.ts`.
- **Release:** `scripts/{pack.mjs,install-clean.sh,gold-exam.sh,publish-npm.mjs,fetch-models.mjs}`,
  `.github/workflows/{ci,publish}.yml`; tests `test/macos/packed-install.test.ts`,
  `apps/cli/src/{version-sync,gold-exam-dry,gold-exam-report}.test.ts`.

## Testing rules that outlive the build

- Functional tests drive the built CLI as real OS processes against real
  PGlite data directories inside the Docker seam; there are no env-gated
  skips, and the harness fails a run that executed zero tests.
- Only external edges are substituted: a real-HTTP fake gateway speaking the
  four OpenAI-compatible routes photoctl uses, the volume/mount edge
  (`PHOTOCTL_VOLUME_MAP`), and `PHOTOCTL_NO_DAEMON=1` for in-process runs.
- Timing budgets are injectable and derived from measured Node spawn time.
- Fixture facts live in `fixtures/README.md` and `fixtures/a7c2.json`,
  produced by the independent stdlib-Python generator in `fixtures/tools/`,
  so identity and embedded-preview tests cannot be tautologies.
- Real-model probes (SAM) belong to the default Docker and macOS gates and
  fail rather than skip when weights are absent.

## Divergences from the plan

The places where building taught something the plan did not know. Each is a
decision a future reader would otherwise re-derive.

- **Lock mechanism.** Plan: create-exclusive PID file with staleness rules.
  Shipped: kernel advisory lock on an open descriptor; a synchronized probe
  had reproduced two holders under the planned unlink scheme.
- **Daemon bootstrap.** `init` alone dispatches in-process, closes its
  bootstrap handle, then starts the daemon; every later command goes through
  the daemon. A failed optional daemon start after a durable init is a
  warning, not an error.
- **Hash width.** The 12-hex preview identities of the first slices were hard
  cut to full SHA-256 when the DAG landed; `--human` alone abbreviates.
- **Linear artifacts.** An early evaluator canonicalized display-sRGB RGB16
  and clipped highlights; corrected to scene-linear float32 before any layer
  work built on it.
- **Highlight reconstruction** became the ordinary graph request rather than
  an opt-in, separated from older artifacts by the renderer semantic revision
  instead of an upgrade migration.
- **Sidecar ownership** moved from folder-wide bans to a placement policy:
  edited files may live beside originals and import as separate photos;
  collisions are prevented, valid arrangements are not.
- **Paired originals** replaced a selection-only proposal with the
  photos/originals/files split and a clean-start schema; the batch result
  gained per-unit conflicts and expected read/identity/copy errors so a caller
  can never mistake unadmitted photos for a completed import.
- **Disk removal** enforced `--yes` only for multiple ids until the
  original-decision audit restored D34's confirmation for every disk removal.
- **Fill refresh** originally refused already-transformed fills; an affine
  branch descriptor now reconstructs base and mask in the original generation
  space instead.
- **Outpaint extent** derives from enabled layer state rather than a mutable
  canvas table or counter, because exposure or rotation changes must not
  reactivate a consumed crop.
- **Generation input** for full-frame edits is the current photographic
  result (user-approved), with no runtime heuristic and no extra flag to keep
  both proposals.
- **Reference strength** for `generate --ref` means freedom to vary (zero =
  closest preservation), never an exact-copy guarantee; reference-only
  generation exists because a test proved an unsupported adapter would
  otherwise buy an unrelated text-only image.
- **Full-frame upscale overrides.** `reimagine` and `relight` forward the
  global `--upscale`/`--no-upscale`/`--upscale-model` intent into the shared
  density policy; standalone `generate` keeps its own explicit-size rule.
- **Model publication** is automated on version tags but consumes the
  prepared model artifact rather than a public URL because no public release
  has run; the manifest's `awaiting_export` state, which nothing produced, was
  removed at closeout.
- **Liveness** moved from per-handler progress heartbeats plus a per-verb
  timeout list to a transport keepalive at closeout, after review found paid
  verbs that emitted no progress and could be misreported as failed.
- **ONNX Runtime** is built from a pinned source recipe through Cargo for
  host, Docker and release because the served archive's provenance could not
  be established and its eager CPU-feature initializer wrote outside the
  NDJSON stderr contract on Linux.
- **CI scope** shrank to a smoke subset by user direction; hosted full-suite
  runs, Intel/Linux verification and emulator debugging were removed.
- **Never built:** `unblur` (cut), a local generative runner, `apps/mcp`,
  automatic canonical-artifact garbage collection (storage measured, policy
  deliberately not authorized), a second refinement model for fine edges.

## Dead ends

Tried and rejected, with the reason, so nobody re-walks them.

- Stale-PID unlink locks; an in-process daemon "yield" that released the
  kernel lock between batches (tears down the shared handle).
- Feeding a RAW's embedded JPEG straight to the graph as a source (one
  command-layer owner now maps fallbacks to `decoder_fallback`/`source_offline`).
- Planckian 6504 K chromaticity as the D65 anchor (discontinuity at zero) and
  Rec.709 luminance weights on Rec.2020 data.
- Simple highlight blending (desaturated real colored lights), hard
  sensor-clipping gates (mottled boundaries), bilinear interpolation
  (softens), CIRAW's native recovery as the default (flat flame cores).
- Stacked local-contrast tunings that crushed shadows (G8 stays a recorded
  non-acceptance); the first noise-reduction tuning (watercolor); the first
  selective-color probe (drove gamut-aware correction).
- A macOS Vision horizon detector (portability); a second command seam for
  auto-straighten before `crop` existed.
- Full base-sized float canvases as provider input; fusing catalog-to-final
  mask transforms into one matrix (clamp/interpolation boundaries make it
  wrong); upscaling a prior composited result on rescale; the magenta
  sentinel as vacancy provider input.
- One-axis aspect ceilings for outpaint (an identical request grows
  repeatedly); clipping an exterior crop on border removal; z-prefix
  membership for refresh (revives consumed support).
- Success-only execution links for provider originals (missed rejected
  images); re-encoding working pixels as "original".
- SAM: square prompt geometry (helps wires, hurts foliage); the full upstream
  predictor in single- and multi-mask modes (also fails the edge target);
  deferring only three CPU-feature facts in ONNX Runtime (three dispatch
  objects and four kernel selections also initialize early).
- A duet-style embedding worker with independently tuned yield/poll constants
  (the pairing is unsound); vector(3072) without an index (use halfvec + HNSW).

## Visual provenance

The standards the result was held to, and what each drove:

- **User-approved rendering** —
  [`assets/camera-delivery-review/balanced-delivery/final-verdict.md`](assets/camera-delivery-review/balanced-delivery/final-verdict.md)
  (2026-09-07, "the rendering looks fine"). Drove the default RAW-led
  delivery: LibRaw decode, float highlight reconstruction, the people preset.
  The sibling directories record the rejected historical sets and causal
  investigations that led there.
- **User-accepted pairing card** —
  [`assets/paired-layout/`](assets/paired-layout/README.md) (2026-09-08).
  Drove the contact sheet's membership presentation; captured with host
  headless Chrome at desktop and a true 390-pixel viewport after three
  unprimed critiques.
- **Mounted-camera gold exam** —
  [`assets/mounted-gold-2026-09-07/`](assets/mounted-gold-2026-09-07/README.md):
  the prescribed import → list → rate → develop → export journey through a
  fresh packed install on the real A7C II card, plus the
  [same-catalog camera-JPEG witness](assets/paired-import-review.md).
- **Decoder oracle** — [`assets/gates/G4-decoder-oracle.md`](assets/gates/G4-decoder-oracle.md)
  and `G4-ciraw-libraw.png`: the ΔE00 tolerance between CIRAW and LibRaw.
- **Develop operator gates** — `assets/gates/G6…G10*.md` and
  [`assets/crop-auto/`](assets/crop-auto/review.md): one variable per
  checkpoint with an unprimed critique; G8 local contrast remains a recorded
  non-acceptance.
- **Selection** — [`assets/sam-photographic/`](assets/sam-photographic/README.md)
  (coarse pass, fine edges fail) and
  [`assets/selection-refinement/`](assets/selection-refinement/README.md)
  (manual correction witness). Together they are the evidence behind S94.
- **Canvas and generation** — `assets/outpaint-*`, `assets/frame-views`,
  `assets/fill-fit`, `assets/full-frame-*`, `assets/reference-controls`,
  `assets/*-journey`, `assets/generate`, `assets/auto-enhance`, `assets/markup`:
  deterministic keyless captures with unprimed critiques. None is a
  photographic-quality acceptance; live-provider texture, live upscaler
  quality and mask polarity remain conditional and unverified.
- **Runtime evidence** — `assets/sam-runtime`, `assets/outpaint-resources`,
  `assets/full-source-performance.md`, `assets/list-availability-performance.md`:
  measured latency and RSS on the recorded host, not release guarantees.

## Open questions the user still owns

Recorded with provisional, reversible calls in [`choices.md`](choices.md):
the fake release-default upscaler (U2), black uncovered canvas (U3), magenta
vacancy (U4), graph inspection bounds (U5), and the other needs-user entries.
Live provider evidence (mask polarity, multimodal embedding dialect, upscaler
quality) requires purpose-specific keys and consent that were never supplied;
nothing in the shipped product depends on them.

## Review debt recorded at closeout

The whole-spec review (three read-only passes over commands/transport,
render/native and library/providers) found the architecture designed at its
seams and accreted at its edges. The confirmed defect (paid-verb liveness) and
the mechanical consolidations were fixed before this archive; the findings
below were judged too invasive or too product-shaped for an unsupervised
closeout and are left for the user, each with its owner:

- **Two Lanczos paths.** `crates/photoctl-image/src/resample.rs` keeps a
  separable edge-replicating `resize_lanczos3` beside the affine `transform`
  kernel whose outside taps fade; a `resample` node without a target (only
  standalone `generate` writes one) takes the first path, every other node the
  second. Each path is deterministic and consistently selected by recipe, so
  cache identity is sound, but the "one resampler" claim is one native owner
  with two edge semantics. Collapsing them changes border pixels of existing
  canonical artifacts and belongs behind a renderer semantic revision.
- **Migrations are told as history.** `packages/library/src/migrations/`
  replays twenty-one steps into every fresh library and `verifyLatestSchema`
  in `runner.ts` hand-mirrors about 130 constraint, index and trigger names. The clean-start policy
  permits one baseline migration; the collapse was judged too large to land
  unsupervised at closeout. Setting defaults likewise have three writers
  (`packages/protocol/src/verbs/settings.ts`, two migrations, `open.ts`).
- **Locator historical-mount fallback**
  (`packages/library/src/locators.ts`, `outside_configured_volume`) only fires
  under the test volume resolver; whether it is a product rule on a real Mac
  is a decision, not a bug.
- **`migrate_required`** is raised only for a PGlite major mismatch that
  `photoctl migrate` cannot fix; its hint already says `restore`. Renaming it
  changes a public code.
- **Commands seams still classify some render-owned errors by message**
  (ledger S2; `packages/commands/src/handlers/{layer,graph,presets,develop}.ts`),
  and the catch-alls in `handlers/develop.ts` (`commandInputError`),
  `handlers/presets.ts` (`inputError`) and `packages/commands/src/embedding.ts`
  (`provider_busy`) convert unexpected errors into `usage` or a retry. Mapping
  by error class is the fix; it touches exit classes.
- **Lock and poll budgets** are parsed three ways with different defaults
  (`context.ts`, `daemon-client.ts`, `apps/daemon/src/server.ts`); one parse
  at the CLI boundary is the fix.
- **Advisory progress emission** is copy-pasted in seven handlers while
  `search` and `embed` propagate a failing consumer; one policy in
  `packages/commands/src/progress.ts` is a behavior choice for those two verbs.
- **`show`'s pristine fast path** (`handlers/show.ts`) matches the source
  document's output recipe by SQL literal; render should export the check.
- **Test-only fixture across a package boundary:**
  `apps/workbench/src/fill.test.ts` imports
  `packages/commands/src/fill-upscale-fixture.ts` by relative path because
  moving it into the harness would create a dependency cycle with providers.
  The fixture is now excluded from the shipped build; a shared test package
  beneath providers is the structural fix. The gateway fixture repeats two
  provider constants for the same cycle reason.
- **Harness stream mode** (`packages/test-harness/src/spawn.ts`) fabricates a
  final envelope shape for `search` and `list`; consumers read `.stream`.
- **Smaller items:** `layers/operations.ts` fuses raster geometry, lineage
  and mutations; the native develop boundary validates the artifact span
  twice and the delta entry silently ignores non-global parameters (guarded
  in TypeScript); two JPEG SOF scanners and three read-range helpers in
  importer/library; a sam2 test asserts a resampler call tuple.

## Evidence index

Evidence directories under `assets/` carry a README or verdict file stating
exactly what they do and do not establish; the raw capture sets without one
(`concurrency-spike/`, `markup/`, `outpaint-states/`, `outpaint-states-corrected/`,
`slice05/`) are described by the review that consumed them. The index by theme:

- Closeout gates: `final-closeout-2026-09-08.md`, `local-closeout-2026-09-07.md`,
  `preview-closeout-2026-09-07.md`, `selection-redo-closeout-2026-09-07.md`,
  `settings-closeout-2026-09-07.md`, `integration-checkpoints.md`, `ci-triage.md`,
  `packed-install-*.json`, `spec-close-2026-09-08.md`.
- Reviews: `final-correctness-review.md`, `original-decisions-review.md`,
  `choices-consolidation-review.md`, `paired-import-review.md`,
  `outpaint-state-review.md`, `list-availability-performance.md`.
- Native runtime: `ort-acquisition/`, `ort-lazy-proof/`, `sam-export/`,
  `sam-runtime/`, `gates/G2-libraw-build.md`, `gates/libraw-compression.json`.
- Storage and retention: `artifact-storage/`, `export-retained/`.
- Concurrency: `gates/G1-concurrency.txt`, `concurrency-spike/`.
- Search and providers: `gates/G5-halfvec.txt`, `gates/embed-shape.json`,
  `gates/upscale-spike.json`, `gates/mask-polarity/`, `upscale-spike/`.
