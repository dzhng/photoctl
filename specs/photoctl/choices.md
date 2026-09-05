# Implementation choices

## Needs-user

### Slice 13a generate — Reference images use the gateway's generic JSON image field provisionally

- **When:** Slice 13a standalone generation, 2026-09-05.
- **The choice:** `generate --ref photo.jpg` rotates and normalizes the reference to PNG, then places one data URL in a
  `reference_image` field on the existing OpenAI-compatible `images/generations` request. The command records only that a reference
  was used, not the local path or image bytes. The fake gateway pins that wire shape. [Vercel's current GPT Image 2 surface](https://vercel.com/ai-gateway/models/gpt-image-2) advertises
  reference images, but the public raw-REST material inspected during the pass did not name the exact field; its higher-level SDK
  instead models a prompt as text plus an images array. The alternative is a model-specific multipart edit request, which would move
  `--ref` off the generation route and require capability-specific adapter evidence.
- **The gap:** The slice requires `--ref` and fixes the gateway route, but does not version the raw reference-image dialect or supply
  live acceptance evidence.
- **The reach:** A live gateway can reject only reference-bearing calls while text-only generation remains valid. The uncertainty is
  isolated to `ImageModelAdapter.buildGeneration`; catalog, graph, import, and result schemas do not depend on the field name.
- **Verdict:** **Needs-user.** Keep the keyless contract provisionally, then run one reference-image smoke with the configured release
  model before claiming live support. If rejected, replace the adapter's request shape from provider evidence without changing the
  command or graph contracts.
- **Confidence:** Low; product intent is clear, but the raw transport spelling is not evidenced yet.

## Sound

### Slice 13a generate — Standalone paid pixels are a source-less generation recipe

- **When:** Slice 13a standalone generation, 2026-09-05.
- **The choice:** A generated photo starts at `generate` recipe version 2 with zero graph inputs. Version 1 remains the edit/fill
  recipe and still requires exactly one upstream photo node. An ordinary output wrapper becomes both document roots, so `show`,
  `develop`, and `export` can treat the generated photo like any other photo without manufacturing a blank or hidden source image.
  The provider execution pins the canonical artifact under the source-less node, so reopening or previewing the photo reuses paid
  pixels instead of calling the provider again.
- **The gap:** The graph's only generation recipe was defined for editing existing pixels and therefore required an input, while this
  command intentionally has no base-density target or source photo.
- **The reach:** Schema v14 permits version 2 only for the node kinds that genuinely own it. Future generated-photo edits build above
  the output wrapper, and existing fill/reimagine recipes keep their old identities and arity.
- **Verdict:** **Sound.** Versioning states the semantic difference directly and keeps all downstream image behavior on the shared
  document graph.
- **Confidence:** High; recipe, migration, built-show, and later-develop tests exercise both sides.

### Slice 13a generate — Catalog creation and the first graph revision share the import transaction

- **When:** Slice 13a standalone generation, 2026-09-05.
- **The choice:** Provider pixels are first normalized into the existing content-addressed canonical artifact store. The ordinary
  import preparation then identifies that TIFF, builds its pinned preview, and opens one catalog transaction. Inside that same
  transaction it creates the photo and locator, adds the `generated` tag, registers artifacts and executions, and activates the first
  revision. If any catalog or graph validation fails, none of those rows survive and staged preview files are rolled back. Published
  content-addressed bytes may remain as harmless unreferenced repair/cache material, matching existing graph publication semantics.
  Generated locators are explicitly rooted at the portable `photoctl-library` volume; host disk discovery never reclassifies an
  artifact that already lives inside the library.
- **The gap:** Calling the public `import` and `tag` commands sequentially would expose a half-imported photo and could not attach the
  paid execution atomically. The graph revision owner previously always opened its own transaction.
- **The reach:** The graph store now exposes the same revision implementation for a caller-owned transaction; regular callers still
  use its transaction-opening wrapper. A byte-identical generated result is refused within the transaction rather than overwriting an
  existing photo's edit history.
- **Verdict:** **Sound.** One import owner still controls identity/cache/catalog work, and all user-visible state crosses a single
  commit boundary.
- **Confidence:** Medium; the duplicate-content refusal is safer than silently replacing existing intent, but future product UX may
  want a distinct duplicate result code.

### Slice 13a generate — External 8-bit samples are expanded before canonical color conversion

- **When:** Slice 13a visual gate, 2026-09-05.
- **The choice:** Sharp's decoded provider bytes are explicitly expanded from `0..255` to `0..65535` before entering the shared
  display-sRGB 16-bit image type. Previously the buffer requested a 16-bit container, but Sharp retained the original numeric sample
  range; dividing those values for preview made ordinary colors nearly black. The conversion now maps 128 to 32896 and 255 to 65535,
  which preserves the full normalized display range before the canonical scene-linear conversion.
- **The gap:** Existing fill tests asserted geometry and protected pixels but never pinned the numeric range of provider color
  samples; the standalone visual checkpoint made the latent black-output defect visible.
- **The reach:** Generate, fill, reimagine, and future external-image consumers share correct brightness and color scaling. No recipe
  or stored schema changes; previously generated near-black artifacts remain immutable evidence of the old execution.
- **Verdict:** **Sound.** The mapping is exact for every 8-bit code value and a pure boundary test owns it.
- **Confidence:** High; the failed visual metrics, direct pixel probe, corrected telemetry, and focused unit test agree.

### Slice 12d3 — Vacancy workflow state comes from content lineage, not role

- **When:** Slice 12d3 person-move integration, 2026-09-05.
- **The choice:** A stable `vacancy` identity describes its relationship to a subject; it does not permanently mean “magenta and
  unfinished.” The active vacancy is unfilled exactly while its content first-input lineage reaches the sentinel `solid`. Only that
  placeholder state is excluded from develop compensation and staleness. Once filled, the same identity is photographic content and
  follows the ordinary develop tiers; moving its subject again resets the content to the solid without allocating another vacancy.
- **The gap:** Slice 10c2 could equate role with placeholder state because vacancy fill did not yet exist. Keeping that shortcut would
  leave a filled hole warning forever and silently exempt generated pixels from later develop changes.
- **The reach:** Show, export, develop commits, and strict fill share one derived state. The database relationship remains stable while
  undoable content revisions move cleanly between pending and filled workflow states.
- **Verdict:** **Sound.** Immutable lineage already records the state transition, so no mutable status column or parallel flag can
  drift from the active graph.
- **Confidence:** High; one public journey observes warning, fill, both develop tiers, export, and reset through command dispatch.

### Slice 12d2 — The keyless agent journey separates state continuity from model aesthetics

- **When:** Slice 12d2 agent-preview integration, 2026-09-05.
- **The choice:** The mandatory real-CLI journey uses a code-generated, asymmetric high-resolution raster with stable subject,
  detail, anchor, and protected-pixel facts. It accepts the fake provider's intentionally flat replacement as a deterministic state
  transition, then judges placement, linear-light opacity, preview reuse, provider request counts, and export identity independently.
  It does not turn the synthetic fill into an aesthetic oracle; photographic edge and texture quality remains a separate live or
  workbench visual gate.
- **The gap:** A keyless provider can deterministically prove orchestration and pixel ownership, but it cannot stand in for the
  perceptual behavior of a live generative model.
- **The reach:** CI catches stale previews, repeated paid work, coordinate drift, cache contamination, incorrect blending, and stale
  export without credentials or lucky sampled content. Live visual review retains one clear variable instead of inheriting false
  confidence from a synthetic image.
- **Verdict:** **Sound.** The test's claims stop at the boundary its fixture can actually establish.
- **Confidence:** High for state, cache, and export continuity; deliberately none for live fill aesthetics.

### Slice 12a — The generation execution and active graph revision commit together

- **When:** Slice 12a strict-fill implementation, 2026-09-05.
- **The choice:** Provider bytes are normalized and published first, but the artifact row, immutable generate execution, canonical
  descendants, replacement layer snapshot, and output root enter the catalog in one revision transaction. A failed or structurally
  invalid provider response therefore has no catalog execution and no new undo state. A prepared execution must also remain
  reachable from the revision's resulting document roots; retaining an inactive node elsewhere in the catalog is not enough. The
  alternative was a visible intermediate generation revision or an execution row that no active graph could reach.
- **The gap:** The graph store previously committed deterministic nodes and revisions separately from provider execution recording.
- **The reach:** Fill, later refresh, and future paid mutations inherit a transaction boundary that cannot expose a paid node without
  its exact output or activate a replacement layer piecemeal.
- **Verdict:** **Sound.** Publication remains content-addressed and recoverable, while all catalog-visible state is atomic.
- **Confidence:** High; failure tracers compare revision and execution counts before and after rejection.

### Slice 12a — A generation recipe pins the execution that supplied its pixels

- **When:** Slice 12a graph-evaluation integration, 2026-09-05.
- **The choice:** The immutable generate recipe stores its execution ID. Evaluating descendants reuses that exact recorded artifact;
  it never silently calls the provider again. A future refresh must create a new generate identity and execution instead of changing
  the meaning of the existing node.
- **The gap:** The evaluator could select an execution only when a caller supplied one explicitly, but ordinary show/export walks
  descendants from the output root without such an argument.
- **The reach:** Lazy preview and export reproduce the committed paid result, including after restart. Missing generated artifacts fail
  closed rather than manufacturing different pixels under the same graph.
- **Verdict:** **Sound.** Nondeterministic pixels become stable graph inputs while refresh remains an explicit later operation.
- **Confidence:** High.

### Slice 12a — Generation preserves crop sampling; resample owns base placement

- **When:** Slice 12a crop-to-graph integration, 2026-09-05.
- **The choice:** The paid generate execution publishes only its normalized provider crop. Its artifact keeps the intrinsic raster
  dimensions actually returned by the provider, and the recipe records the same dimensions as the sampling-density fact. The canonical
  resample node owns both deterministic sizing and placement through an optional base-canvas target rectangle; pixels outside that
  rectangle are zero because the following strict compositor copies the base wherever its mask is zero.
- **The gap:** The existing compositor requires dimension-matched inputs, but storing a copied full-base image as the generation
  artifact erased which pixels the provider actually returned and made the 12b density planner believe a small crop already had
  full-frame sampling.
- **The reach:** Future upscale runs from the original intrinsic paid crop, density uses those real pixel dimensions, and
  crop-to-base geometry has one immutable recipe owner. The strict compositor
  still protects every unmasked base sample exactly.
- **Verdict:** **Sound after correction.** It preserves provider evidence and the required generate → upscale → resample/place →
  mask-composite sequence without a compatibility branch.
- **Confidence:** High; asymmetric placement and smaller-provider-output tracers pin artifact, sampling, and base-canvas dimensions.

### Slice 08c3 — Normalized controls use OpenColorIO's scene-linear curve domain

- **When:** Slice 08c3 curve implementation, 2026-09-05.
- **The choice:** A curve point such as `[0.5,0.6]` is UI-normalized data, not a direct linear-light coordinate. Photoctl maps
  both axes from zero-to-one onto OpenColorIO's -7-to-+7 `GRADING_LIN` log domain, fits OpenColorIO's monotonic quadratic
  B-spline, applies red/green/blue channel curves first and the RGB master second, then returns to scene-linear Rec.2020.
  Values beyond the first and last controls follow the endpoint tangent instead of being clipped. The unbuilt alternative was a
  simple piecewise-linear curve over raw scene samples, which would give the same UI point a different photographic meaning and
  discard the operator named by the plan.
- **The gap:** The plan named OpenColorIO `GradingRGBCurve` and normalized schema points but did not spell out the normalized-to-log
  mapping, interpolation shape, channel/master order, or endpoint behavior.
- **The reach:** Presets, copied develop dictionaries, in-memory previews, and canonical artifacts now share one stable curve
  meaning. Curve outputs must be non-decreasing because that is the monotonic spline's contract.
- **Verdict:** **Sound.** It follows the authoritative operator's scene-linear path and preserves extended-range pixels.
- **Confidence:** High for algorithm and ordering; medium for the UI-domain mapping until a broader preset corpus is judged.

### Slice 08c3 — Levels preserve extended scene-linear samples

- **When:** Slice 08c3 levels implementation, 2026-09-05.
- **The choice:** Levels first maps black to zero and white to one, then applies reciprocal midpoint gamma. For a sample below
  black, or above white, the same calculation continues with a sign-preserving power instead of clipping it into display range.
  Levels runs after the existing primary/masked/color controls and immediately before curves. The unbuilt alternative was to clamp
  at black and white, which would silently destroy recoverable scene-linear highlights and negative working values.
- **The gap:** The schema fixed black, midpoint, and white ranges, but the plan did not state extended-range behavior or where levels
  sits relative to the other fixed-order operators.
- **The reach:** Later local, geometry, and output operators receive finite extended-range samples, while both native entry points
  use identical level math and order.
- **Verdict:** **Sound.** It preserves the established no-clipping invariant and familiar midpoint semantics.
- **Confidence:** Medium; exact ramp tests pin the math, while product feel remains subject to real presets.

### Slice 08c1b — Global develop has one native owner and a fixed scene-linear order

- **When:** Slice 08c1b pixel implementation, 2026-09-05.
- **The choice:** Rust receives the exact linear artifact samples and applies Bradford white balance and opponent cast, then
  brightness/black point, exposure, contrast about 0.18, and saturation that preserves Rec.2020 Y using the Y row of the existing
  Rec.2020→XYZ matrix. OpenColorIO's BSD-3 scene-linear formulas were ported rather than linked. TypeScript validates the dictionary
  and transports the f32 buffer; it owns no parallel grade.
- **The gap:** The operator table delegated cross-operator order and UI normalization constants.
- **The reach:** Show, export, the linear probe, and later masked operators inherit one deterministic implementation and insertion
  order.
- **Verdict:** **Sound.** It follows the named math and preserves one owner for pixel behavior.
- **Confidence:** High for exposure and primary math; medium for product feel until broader preset fixtures land.

### Slice 08c1b — White balance uses a bounded Planckian/Bradford model

- **When:** Slice 08c1b pixel implementation, 2026-09-05.
- **The choice:** Neutral is D65. Positive temperature means visually warmer, so it lowers target CCT from 6504 K; offsets use the
  delta from the Planckian 6504 K point applied to the exact D65 chromaticity, bounded to 1667–25000 K. This anchors zero exactly
  and continuously. Positive tint and cast move toward magenta through separate target-y and opponent-gain controls.
- **The gap:** The table selected Bradford and an opponent axis but delegated conversion constants and sign conventions.
- **The reach:** Valid extremes stay finite and platform-independent; later UI clients must use these same directions.
- **Verdict:** **Sound.** The convention matches established editor controls and keeps constants in the native operator.
- **Confidence:** Medium until gray-card and skin fixtures exercise the full allowed range.

### Slice 08c1b — The linear probe publishes the actual graph artifact without replacement

- **When:** Slice 08c1b graph integration, 2026-09-05.
- **The choice:** `render <id> --linear --to out.tif` evaluates the active graph, reads its exact scene-linear artifact, and emits the
  same hash-verified IEEE-f32 linear Rec.2020 TIFF bytes after validation without a decoded f32 allocation. It uses delivery's durable atomic no-replace primitive, so an occupied path,
  the source itself, or a hard-link alias is rejected without changing bytes. There is no probe overwrite option.
- **The gap:** The command shape did not specify publication behavior, and the superseded implementation inverted a clamped display
  artifact instead of reading the working pixels.
- **The reach:** Values below zero and above one remain observable, byte determinism describes the real production DAG, and probes
  cannot truncate originals.
- **Verdict:** **Sound.** The probe is an output edge over the canonical artifact, not a second render or approximation.
- **Confidence:** High; a falsified regression proves display-style clamping would fail the three-stop (`8×`) ratio/highlight assertions.

### Slice 08c1b review — Native global develop owns one asynchronous worker buffer

- **When:** Slice 08c1b bounded-memory review, 2026-09-05.
- **The choice:** N-API copies the JavaScript `Float32Array` once before scheduling because JavaScript may mutate its backing store
  while the worker runs. Rust grades that owned `Vec<f32>` in place and returns the same allocation; it never captures or mutates
  JavaScript memory off-thread. Graph develop takes the stronger canonical-byte seam: it copies the verified TIFF once into the
  asynchronous native task, validates and grades its f32 pixel span in place, then publishes the returned canonical bytes without
  ever materializing or iterating a full-frame `Float32Array` on the daemon event loop.
- **The gap:** N-API's asynchronous safety boundary requires one input copy, but the initial implementation also allocated a full
  Rust output frame.
- **The reach:** A 7008×4672 RGB f32 frame is 392.9 MB (374.7 MiB). Peak pixel storage during the native call is bounded to the
  JavaScript input plus one Rust frame (785.8 MB / 749.4 MiB), down from three frames (1.18 GB / 1.10 GiB), while CPU work remains
  off the daemon thread.
- **Verdict:** **Sound.** The single unavoidable safety copy is explicit and the native operator reuses it.
- **Confidence:** High; a native pointer-stability test proves the owned allocation is unchanged by the grade.

### Slice 08c1b review — No-replace publication is one native atomic install

- **When:** Slice 08c1b no-clobber review, 2026-09-05.
- **The choice:** Photoctl writes and fsyncs a sibling temporary, then asks the native image package to install it with the
  platform's atomic no-replace rename: `renamex_np(RENAME_EXCL)` on macOS and `renameat2(RENAME_NOREPLACE)` on Linux. The native
  boundary returns installed, occupied, or unsupported; I/O errors remain errors. Occupied and unsupported outcomes fail closed,
  preserve the destination, and let the caller remove only its temporary. Explicit replacement remains a separate ordinary rename.
- **The gap:** Node has no portable rename-without-replacement API. Direct exclusive writes expose partial final files, while a
  user-space recovery protocol cannot atomically establish ownership across crashes and contenders.
- **The reach:** Linear probes and delivery exports have one constant-space, crash-safe publication boundary with no marker,
  polling, or stale-owner state. Filesystems or kernels lacking the primitive refuse publication safely.
- **Verdict:** **Sound.** The filesystem kernel, not application bookkeeping, owns the atomic name transition.
- **Confidence:** High on the packaged macOS and Linux targets; native tests pin successful moves and occupied destinations.

### Slice 08c1b — Workbench A/B verifies dimensions, not provenance

- **When:** Slice 08c1b visual checkpoint, 2026-09-05.
- **The choice:** `wb ab` accepts two equal-sized images and one named variable, embeds their pixels and hashes, and labels neutral
  versus edited. It explicitly says only dimensions were verified; source, framing, and encoding must come from capture provenance.
- **The gap:** Pixel dimensions alone cannot prove two inputs share a source or crop.
- **The reach:** Later visual passes reuse the report without turning a convenient A/B layout into a false provenance claim or an
  aesthetic endorsement.
- **Verdict:** **Sound.** The report states exactly what it can establish.
- **Confidence:** High.

### Slice 08b integration — Develop batches reuse the shared failure owner and classify revision races as contention

- **When:** Slice 08b review after the shared Slice 06 batch owner landed.
- **The choice:** Resolution, result aggregation, partial-envelope construction, and error-data copying now come from
  `packages/commands/src/batch.ts`. Each resolved photo encloses its own load, graph read, mutation validation, and revision commit.
  Invalid requested values become per-item `usage` results; malformed stored graph state becomes `catalog_unreadable`; and the typed
  graph compare-and-swap conflict becomes retryable `library_locked` with `reason:"revision_conflict"`. The alternative was to keep a
  develop-specific envelope implementation or let one photo abort later items.
- **The gap:** The batch contract requires partial progress but did not select existing public error codes for graph validation and
  a concurrent revision change.
- **The reach:** Multi-photo develop scripts retain ordered outcomes and can retry a raced photo without replaying successful items.
  Future batch handlers inherit one result/error envelope owner instead of another near-copy.
- **Verdict:** **Sound.** The classifications preserve the closed protocol code set and separate corrupt durable state from transient
  write contention.
- **Confidence:** Medium; a dedicated revision-conflict code would be clearer if the public error vocabulary is expanded later.

### Slice 08b — Copy selects the mutation base before the other develop operations

- **When:** Slice 08b command integration.
- **The choice:** One `develop` invocation may copy another photo's settings and refine them. The command first selects its base—the
  source photo for `--copy-from`, otherwise the target's current state—then applies `--reset`, the named preset overlay, explicit
  `--set` assignments, and finally `--unset` paths. For example, `--copy-from A --preset people --set contrast=9 --unset cast`
  produces one before/after classification and at most one immutable revision. If the fully resolved dictionary, including
  provenance, already equals the target state, the command returns its current hashes without adding undo history. The alternative
  was to reject combinations, make behavior depend on argument order, or record duplicate no-op revisions.
- **The gap:** The contract says a preset precedes explicit sets, but does not fully order copy, reset, and unset when options compose.
- **The reach:** Scripts, retries, undo history, and future layer-staleness classification receive one deterministic result
  independent of CLI spelling order; idempotent replay cannot manufacture edits a photographer never made.
- **Verdict:** **Sound.** A copied state is naturally an input, destructive reset is explicit, and the most specific requested edits
  win last.
- **Confidence:** Medium.

### Slice 08b — Preset provenance is stored in the node recipe but excluded from the develop hash

- **When:** Slice 08b immutable-node integration.
- **The choice:** The resolved develop settings and the selected preset name are stored together in the typed develop node. The
  `develop_hash` excludes that name, as required, so two identical settings dictionaries share one `h_…` identity. The logical node
  recipe still records the name: applying an alias with identical values can therefore create a different output `render_hash` even
  though its `develop_hash` matches. The alternative was to discard provenance or add a second revision-metadata schema solely for
  preset names.
- **The gap:** The plan requires retaining the preset name while excluding it from the develop hash, but does not choose where that
  provenance belongs relative to the DAG recipe.
- **The reach:** Inspection and undo retain what the photographer requested. Identical pixels selected through differently named
  presets may occupy separate logical recipes until a later metadata owner exists.
- **Verdict:** **Sound.** It keeps the requested provenance inside the already typed immutable state without duplicating mutable
  photo columns.
- **Confidence:** Medium; the harmless cache split is an architectural tradeoff worth revisiting if preset aliases become common.

### Slice 08b — Saved develop presets contain resolved settings and replace atomically by name

- **When:** Slice 08b library preset implementation.
- **The choice:** `presets save <name> --from <photo>` writes the photo's resolved settings, excluding any prior preset-name
  provenance, to `<library>/presets/develop/<name>.json`. Publication uses a same-directory temporary file, file sync, rename, and
  directory sync; saving the same name replaces that library-owned preset. A library preset shadows a package preset with the same
  name, following the existing preset-precedence rule. The alternatives were to save an inheritance reference, refuse replacement,
  or expose partially written JSON.
- **The gap:** The slice names package and library locations but does not define save collisions, inheritance, or crash ordering.
- **The reach:** Presets remain portable snapshots rather than aliases into another photo's history, and a daemon cannot observe a
  half-written file.
- **Verdict:** **Sound.** Resolved data is self-contained, while atomic replacement matches an explicit save action.
- **Confidence:** High.

### Slice 08b — Structured develop values use one normalized JSON vocabulary

- **When:** Slice 08b dictionary-schema implementation.
- **The choice:** Curves are per-channel ordered `[input,output]` points normalized to 0–1; levels use
  `{black,midpoint,white}`; selective color uses named hue bands with bounded channel adjustments; crop remains base-pixel
  `{x,y,w,h}`; aspect is positive `W:H`; and filters are fixed names plus bounded strength. The alternative was to leave nested
  values as arbitrary JSON or create a second shape for presets.
- **The gap:** The operator table fixes the keys and math owners but does not completely specify the nested JSON representation.
- **The reach:** CLI parsing, presets, canonical hashes, future Rust operators, XMP mapping, and graph validation all inherit these
  shapes.
- **Verdict:** **Sound.** One strict normalized representation makes invalid recipes unrepresentable and keeps hashes portable.
- **Confidence:** Medium; future operator evidence may justify extending the fixed filter names or selective-color vocabulary.

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
  a native atomic no-replace rename, while explicit overwrite is the only path allowed to replace an existing name. Unsupported
  filesystems fail closed after removing the unpublished sibling temporary. This supersedes the earlier direct exclusive-write
  fallback: a reader can now observe either no destination or the complete fsynced file, never a partially written final path.
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

## Superseded

### Slice 08a2 implementation — Display RGB16 as the canonical graph artifact was unsound

- **When:** Slice 08a2 artifact-publication implementation, 2026-09-05.
- **The choice:** The artifact owner originally normalized oriented display-sRGB RGB pixels to an uncompressed 16-bit TIFF carrying the
  bundled `sRGB2014` profile, hashes those exact bytes, and stores them beneath a two-hex shard. Publication fsyncs the temporary
  file, installs it with an atomic no-replace link, verifies an already-present valid object byte-for-byte, atomically repairs a file
  whose bytes no longer match its content-addressed path, and fsyncs directory entries.
  Slice 08c1a supersedes that representation because converting camera data to display RGB clamps highlights and out-of-gamut
  colors before a later edit can use them. Existing display artifacts are treated as unavailable and lazily recomputed.
- **The gap:** The plan required one normalized content-addressed representation and durable no-overwrite publication, but did not
  choose an encoding or shard width for the first executable graph.
- **The reach:** The durable publication and content-addressing mechanics remain sound, but display pixels are only a view/delivery
  result. The provider-returned paid artifact encoding remains OPEN; converting that result once into working linear does not decide
  whether or how its original bytes are retained.
- **Verdict:** **Unsound.** A graph artifact must preserve the scene-linear values consumed by later pixel operators.
- **Confidence:** Medium; storage cost is intentionally unoptimized until representative artifacts are measured.

## Sound

### Slice 08d2 — NLM uses bounded row blocks instead of allocating a denoised frame

- **When:** Slice 08d2 noise-reduction implementation, 2026-09-05.
- **The choice:** Non-local means (NLM) compares each pixel's small neighborhood with nearby
  neighborhoods and averages the most similar ones. A straightforward implementation writes every
  result into a second full-size image. This implementation instead caches a fixed block plus the few
  source rows whose neighborhoods remain reachable, computes each block through one capped persistent
  worker set, and then replaces those input rows. The existing asynchronous native call still owns the
  one input buffer required to keep JavaScript memory safe.
- **The gap:** The plan required deterministic bounded-memory NLM but did not choose the streaming
  strategy or exact scratch-space bound.
- **The reach:** A full-resolution RAW uses scratch space proportional to image width and the fixed
  neighborhood radius, not image height. Future spatial operators can use the same safe-overwrite
  rule only when they prove how long each source row remains live.
- **Verdict:** **Sound.** The cached margin follows the search radius plus patch radius, the fixed
  block allows parallel work without memory growth by image height, and public artifact/in-memory
  parity proves that storage form does not change pixels.
- **Confidence:** High.

### Slice 08d2 — Luminance NLM precedes chroma NLM in one fixed native order

- **When:** Slice 08d2 noise-reduction implementation, 2026-09-05.
- **The choice:** The luminance control averages brightness while adding the same brightness delta to
  all three working channels, so it leaves their color differences unchanged. The color control then
  averages two zero-brightness color components and reconstructs RGB at the source brightness. Running
  brightness first gives the color comparison a quieter signal; running the stages in separate calls
  produces the same bytes as one combined request. The alternative order would make the controls valid
  individually but give a different combined result.
- **The gap:** The plan named separate luminance and color controls and required fixed operator order,
  but did not order those two sub-stages or define their working representation.
- **The reach:** Presets, copied edits, canonical artifact hashes, previews, and exports now share this
  combined-control meaning. Reordering it later would intentionally change rendered identity.
- **Verdict:** **Sound.** Each control preserves the dimension it does not own, and deterministic tests
  pin the combined order through the public native seam.
- **Confidence:** Medium; broader noisy-camera fixtures may motivate different delegated strength data,
  but not a second pixel owner or ambiguous order.

### Slice 08d1 — Spatial develop extends the existing native worker with dimensions

- **When:** Slice 08d1 local-contrast implementation, 2026-09-05.
- **The choice:** A develop request already crosses from TypeScript into one asynchronous Rust worker with scene-linear pixels.
  Brilliance, definition, and sharpen need to know which samples are neighbors, so that same call now also carries image width and
  height. Rust validates that `width × height × 3` equals the sample count, applies the per-pixel grade, then runs the spatial
  stages in their fixed order. The alternative was a second local-contrast renderer or a TypeScript pixel pass beside the native
  owner, either of which could disagree with canonical TIFF evaluation.
- **The gap:** The plan assigned all develop pixels to Rust and named the spatial kernels, but the earlier per-pixel call did not
  need dimensions and therefore omitted them from the boundary.
- **The reach:** In-memory tests, canonical graph artifacts, previews, and exports now use one spatial implementation and one
  dimension check. Later native noise reduction and geometry can extend this owner rather than creating parallel pixel paths.
- **Verdict:** **Sound.** Dimensions are the minimum missing input for an image-neighborhood operator and keep the established
  color-space and artifact owners intact.
- **Confidence:** High; public memory/artifact equality, dimension validation, determinism, and evaluator tests cover the seam.

### Slice 08c1a — Canonical graph artifacts preserve exact scene-linear working pixels

- **When:** Slice 08c1a artifact correction, 2026-09-05.
- **The choice:** A source decode produces oriented scene-linear Rec.2020 RGB `f32` samples. The artifact owner writes those exact
  samples to a deterministic uncompressed IEEE-f32 TIFF with the bundled linear Rec.2020 profile and hashes those bytes. Every DAG
  node therefore reads the same unclamped values its parent published. Only a view or delivery request converts the working pixels
  to display-sRGB RGB16 and clamps them. An external provider may still return display pixels; those convert once into the working
  format, while retention of the provider's paid return remains deliberately OPEN.
- **The gap:** The 08a2 implementation selected a display artifact before the first scene-linear operator existed, so the loss was
  not observable then.
- **The reach:** Develop, later masks/composites, deterministic identity, repair, restore, show, and export now share one true working
  artifact. Negative, highlight-above-one, and out-of-gamut samples survive the DAG until the final display boundary.
- **Verdict:** **Sound.** It restores the specified working color contract without adding a decoder replay or a second cache owner.
- **Confidence:** High; exact sample, reuse, repair, reconciliation, source-only display, and native RAW tests cover the boundary.

### Slice 08c1a — Graph consumers share one ordered source ladder

- **When:** Slice 08c1a source integration, 2026-09-05.
- **The choice:** Show and export ask one command-layer resolver for candidates. An online ordinary image enters the file decoder;
  an online RAW enters the first supported full-resolution native decoder. Only decode failure advances to the best embedded JPEG,
  then the pinned preview. The successful candidate carries its locator, dimensions, decoder identity/version, and fallback reason.
- **The gap:** Preview selection preferred a RAW container's embedded JPEG and did not represent the production decode order.
- **The reach:** Current display consumers and the later linear probe agree on source pixels and provenance. Fallback warnings say
  whether native decoding failed or the original was offline.
- **Verdict:** **Sound.** It composes the accepted decoder selection policy rather than duplicating it per command.
- **Confidence:** High; show/export tests cover display delivery and 08c1b adds the real full-resolution RAW route gate.

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
  safe to repeat: 401/403/404 map to shared credential/model/endpoint configuration, while 400 and other statuses plus transport
  failures map to temporary per-request provider failure. A malformed individual image may cause 400 without invalidating the
  remaining batch. URL-returned images have the same 30-second ceiling and a 64 MiB streaming cap. The fake gateway
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

### Slice 06 — XMP writes target one verified online original locator

- **When:** Slice 06 XMP command implementation, 2026-09-05.
- **The choice:** A photo can have several locators, meaning several catalog records that point to identical original bytes on
  different volumes. When `xmp write` runs, photoctl walks those locators in catalog order, verifies that an online file still
  has the catalogued content identity, and writes one sidecar beside the first match. For example, if the camera card is offline
  but a verified library copy is online, the library copy receives the sidecar; photoctl does not fan the same write out to every
  copy. `xmp sync --read` chooses its sidecar by the same rule, so the read and write commands cannot silently target a path whose
  image bytes were replaced after import.
- **The gap:** The plan required `<stem>.xmp` beside a source but did not say which source wins when one photo has several
  locators, whether every copy should receive a sidecar, or whether mere path existence was enough.
- **The reach:** Multi-volume workflows now have one deterministic XMP target per invocation. A caller that wants another copy's
  sidecar must make that locator the first verified online source rather than expecting automatic replication.
- **Verdict:** **Sound.** One identity-verified target avoids writing metadata beside an unrelated replacement file and avoids a
  partial multi-volume replication protocol that the command contract never promised.
- **Confidence:** Medium; photographers who intentionally maintain mirrored sidecars may eventually want an explicit all-locators
  operation rather than changing this default.

### Slice 06 — Sidecars publish atomically before their catalog observation is recorded

- **When:** Slice 06 XMP write implementation, 2026-09-05.
- **The choice:** The writer reads the current sidecar, merges catalog fields into memory, writes a uniquely named sibling file,
  preserves the old permission mode, fsyncs the file, and then re-reads the pathname. The comparison includes file identity,
  permissions/owner, size, nanosecond modification time, and a SHA-256 digest. Publication then atomically moves the pathname's
  current file to a private sibling and validates those displaced bytes against the snapshot. Change time is deliberately not part
  of this cross-publication identity because the displacement itself changes it; the opened-file reader still compares change time
  before and after reading to detect an in-progress mutation. If an editor replaced the sidecar in the tiny interval after
  verification, photoctl restores that replacement and retries from it. If validation succeeds, photoctl
  hard-links the prepared file into the now-vacant sidecar name; hard-link creation is atomic and refuses to overwrite a new file
  that another editor created in the meantime. Three consecutive conflicts refuse that item. Recoverable conflict paths restore
  the external file and remove private siblings; if a second editor makes restoration impossible, photoctl leaves the displaced
  bytes at the named recovery path and returns a typed failure rather than deleting either version. Pull reads use the same
  opened-file snapshot discipline: bytes and timestamps come from one handle, and pathname replacement causes a retry. After a
  successful publication photoctl fsyncs the directory; only then does PGlite record the written file's modification time.
- **The gap:** The plan required parse-merge and read-only-volume behavior but did not choose a crash boundary or file publication
  mechanism.
- **The reach:** Every future XMP field inherits the same no-partial-file and no-known-lost-update guarantees, including the exact
  post-verification race. Stale reporting remains the recovery seam between filesystem publication and database bookkeeping. The
  three-attempt contention budget is a reversible latency policy; a continuously active external editor gets a typed per-item
  refusal instead of an unbounded loop. A filesystem that does not support same-volume hard links refuses the write rather than
  falling back to a clobbering rename.
- **Verdict:** **Sound.** The ordering preserves the only irreplaceable state—the existing sidecar—until a complete replacement is
  durable, without adding a second journal or schema.
- **Confidence:** High in the conflict-preservation ordering; medium in the unmeasured three-attempt retry budget and the decision
  to fail closed on filesystems without hard-link support.

### Slice 06 — Keyword writes flatten the catalog's tags and refuse conflicting standard prefixes

- **When:** Slice 06 XMP parse-merge implementation, 2026-09-05.
- **The choice:** The catalog stores flat tag strings, not Lightroom's full keyword tree. A write therefore replaces both prior
  flat and hierarchical keyword properties with one `dc:subject` bag containing exactly those flat strings; it cannot reconstruct
  a hierarchy that was deliberately discarded on import. Rating, color label, and the photoctl flag are the other owned
  properties across every `rdf:Description`, then emits the catalog values exactly once. Camera Raw settings and every unrelated
  XML node remain byte-for-byte in place. Namespace validation follows XML scope through ancestor elements and each Description,
  rather than looking only at a local opening tag. If the document binds a standard prefix such as `rdf`, `xmp`, `dc`, or
  `photoctl` to a different namespace URL, the merge refuses that item instead of shadowing the binding and silently
  reinterpreting preserved XML. Lightroom hierarchy is removed only when `lr` actually denotes Lightroom's namespace.
- **The gap:** The plan named the round-tripped values and required foreign-node preservation, but did not define how a flat
  catalog should rewrite Lightroom hierarchy or how to handle a sidecar that reuses a standard prefix for another vocabulary.
- **The reach:** Tag removal is a real replacement—an old hierarchical leaf cannot reappear on the next import—while develop
  metadata remains outside this writer. Nonstandard documents fail per item and leave their bytes untouched.
- **Verdict:** **Sound.** The serialized form matches the information the catalog actually owns, and refusal is safer than
  assigning new meaning to preserved foreign nodes.
- **Confidence:** High because slice 04 already made exact flat leaf tags the catalog contract.

### Slice 06 — Filesystem shape failures use the existing per-item data-error channel

- **When:** Slice 06 independent-review remediation, 2026-09-05.
- **The choice:** The XMP library wraps only its own filesystem operations in a typed error. A disappearing pathname maps to
  `file_offline`; permission and read-only failures map to `volume_readonly`; other item-local path-shape failures such as an XMP
  pathname that is a directory map to the existing `unsupported_file` result. Database and programming errors remain unwrapped
  and abort normally instead of being mislabeled as item failures.
- **The gap:** The batch contract required isolation but the closed protocol did not name an error code for every POSIX filesystem
  condition.
- **The reach:** One malformed sidecar path cannot starve later IDs, while callers do not need a new public error-code variant for
  uncommon filesystem shapes. The native cause code remains in result details for diagnosis.
- **Verdict:** **Sound.** It preserves the closed protocol and draws the isolation boundary at the library operation that knows the
  failure came from an item-local path.
- **Confidence:** Medium; `unsupported_file` is the closest existing data-error category, but a future protocol revision could add
  a more specific filesystem-shape code if automation needs it.

### Slice 06 — Doctor reports XMP divergence as a grouped count and one soft warning

- **When:** Slice 06 doctor integration, 2026-09-05.
- **The choice:** Doctor adds `data.xmp.stale`, a nonnegative count, and emits one `xmp_stale` warning when that count is nonzero.
  For example, three externally edited sidecars produce `xmp:{stale:3}` plus one warning rather than three warning records. The
  command still exits successfully because divergence is soft state; `list --xmp-stale` is the surface for retrieving individual
  photo rows. To keep a very large library from loading every stored path or issuing every filesystem check at once, the count
  reads 128 catalog rows at a time and checks only that page concurrently before advancing.
- **The gap:** The plan required a doctor stale count and named the warning code but did not define the response nesting or whether
  warnings were per photo or aggregated; it also did not choose a bounded scan shape.
- **The reach:** Monitoring can cheaply read one stable health metric, while callers that need IDs use the already paged list
  command instead of expanding doctor output without a bound.
- **Verdict:** **Sound.** It follows doctor's existing grouped diagnostics and keeps the warning payload bounded for large
  libraries.
- **Confidence:** High.

### Slice 09b — G5 changes one high-entropy wide value per cycle

- **When:** Slice 09b TOAST probe implementation.
- **The choice:** Each G5 cycle creates one deterministic but hard-to-compress 3,072-number vector and UPSERTs that value into all
  5,000 rows. The next cycle changes the vector, so PostgreSQL must replace every row's out-of-line TOAST payload; TOAST is the
  PostgreSQL storage mechanism that moves a value too wide for an ordinary table page into separately stored chunks. After the
  twentieth cycle, the probe does not merely count rows: it reads every vector, verifies its dimension, and compares it with the
  exact final value. Using one vector per cycle controls the experiment around the update/storage mechanism. Generating unrelated
  random vectors per row would add CPU and transfer volume without making any individual stored value wider. If the database
  cannot start, run, verify, close, or clean up for an unexpected reason, the probe first replaces any earlier PASS file with
  `status=unsettled` and an unsettled write strategy, then propagates the failure. Keeping the previous PASS would make the evidence
  directory claim a decision that the latest invocation did not actually establish. Its diagnostic is flattened to one line and
  capped at 500 characters so an upstream error cannot turn this small gate file into an unbounded log sink.
- **The gap:** The plan fixed row count, vector width, cycle count, and UPSERT semantics, but did not define vector contents or the
  readback needed to distinguish intact rows from rows whose external chunks were corrupt.
- **The reach:** The G5 result is credible evidence for 09c's write strategy only while the probe really creates wide external
  values and forces a final read. Dependency upgrades can rerun the same controlled workload and compare a strategy verdict rather
  than a timing anecdote.
- **Verdict:** **Sound.** High-entropy per-dimension values exercise the failure class, while deterministic per-cycle inputs make a
  complete value check possible.
- **Confidence:** High.

### Slice 09b — The embedding smoke records one aggregated-vector contract, not merely HTTP success

- **When:** Slice 09b multimodal embedding smoke implementation.
- **The choice:** The smoke sends one candidate item containing a text part and an inline JPEG part and calls the existing
  OpenAI-compatible `/embeddings` route. It calls that candidate accepted only when the response contains exactly one finite
  3,072-number vector. This represents the product need: one searchable vector for one photo plus its text, not two unrelated
  vectors or a provider's smaller default. On success, the evidence keeps the request structure but replaces the JPEG bytes with
  their SHA-256 digest; on HTTP or transport rejection, it keeps no request fixture. The exact content-part dialect is explicitly
  labelled a candidate until a live Gateway call accepts it.
- **The gap:** Vercel's current model page says Gemini Embedding 2 supports interleaved image and text, while its public Gateway
  example and current AI SDK embedding interface remain text-only and do not specify the raw OpenAI-compatible multimodal body.
  The plan required a live smoke to settle that gap but did not define what qualifies as acceptance or what may be persisted.
- **The reach:** 09c cannot silently accept separate or wrong-width vectors. Until a keyed run succeeds, production can attempt
  the named candidate only after explicit embed consent, one photo at a time, and must keep calling it provisional rather than
  treating fake-gateway success as live acceptance. A rejected live run requires a new versioned candidate rather than fallback.
- **Verdict:** **Sound.** The candidate is versioned and explicit-consent-gated in production, while only the purpose-key probe may
  promote it to an accepted provider fixture. A 200 response with the wrong shape records `response_shape`, the response's scalar
  item count, and only the first eight observed vector widths. This diagnoses contract drift without copying an unbounded provider
  response into durable evidence.
- **Confidence:** Medium; only the still-missing live Gateway response can validate the candidate dialect.

### Slice 09b — Live probes require purpose-specific invocation credentials

- **When:** Slice 09b embedding and upscaler evidence surfaces.
- **The choice:** An ordinary `AI_GATEWAY_API_KEY` in the shell does not start either experiment. The embedding smoke requires the
  operator to set `PHOTOCTL_EMBED_SMOKE_API_KEY` for that invocation; with no such key, it exits successfully and writes a
  machine-readable `not_run:unconfigured` record. The upscaler workbench likewise writes empty adapter, model, controls, and
  comparisons until an `UpscaleAdapter` is supplied through the existing registry and its model is marked configured. That
  invocation must also supply source crops and controls; the spike never fills in resemblance or creativity values itself. It then
  passes each PNG crop's original bytes to the adapter, executes the inherited guarded prompt and a single-sentence “preserve
  without changing content” prompt through the registry, writes both outputs and a contact sheet, and records dimensions, latency,
  cost, resolved controls, and pixel drift. The fake adapter includes the prompt in its deterministic output hash so the regression
  can observe two distinct arms without pretending the pixels are vendor evidence. A failed explicitly requested embedding call
  exits nonzero but still writes a rejected evidence record, so automation can distinguish “not authorized to run” from “authorized
  but failed.”
- **The gap:** The plan prohibited ambient credentials from becoming consent but did not choose the operator-facing key name or
  the exit/evidence behavior for configured failures.
- **The reach:** Developers can keep general provider credentials in their environment without accidentally uploading a photo or
  spending money during routine gates. CI can treat an absent optional experiment as green while still noticing a broken experiment
  that someone explicitly asked to run. Future live adapters retain ownership of color/profile conversion because the workbench does
  not normalize the supplied PNG before invocation.
- **Verdict:** **Sound.** Purpose-specific credentials make consent observable, and the exit split preserves failure visibility.
- **Confidence:** High.

### Slice 09b review — Pixel drift is normalized telemetry, not the visual verdict

- **When:** Slice 09b configured-upscaler review.
- **The choice:** For each source crop, the spike decodes the guarded and minimal outputs to opaque RGB and records their mean
  absolute per-channel difference on a zero-to-one scale. A zero means the two returned pixel buffers look identical; one means
  every channel is maximally different. Different output sizes record maximal drift because pixels cannot be aligned honestly.
  The contact sheet remains the review surface: the number proves the two arms differed and locates a suspicious no-op, but never
  chooses a vendor or claims that larger drift is better.
- **The gap:** The slice required visible drift telemetry but did not define a metric or how it should behave for incomparable
  dimensions.
- **The reach:** Later live comparisons inherit a bounded, provider-independent diagnostic while keeping aesthetic judgment in the
  required screenshot review.
- **Verdict:** **Sound.** Normalization makes different crops comparable, and explicitly refusing to turn the metric into a quality
  score avoids an automated product choice.
- **Confidence:** Medium until live outputs show whether a perceptual metric would be more useful.

### Slice 09c — Normalized catalog rows feed one generated full-text index

- **When:** Slice 09c schema-v8 implementation, 2026-09-05.
- **The choice:** A photo's searchable words live in two normalized tables: `files` holds paths and `tags` holds keywords. PostgreSQL
  cannot make a generated column directly query those child tables. Schema v8 therefore has the database refresh a plain
  `photos.search_text` string whenever a file or tag row changes; `photos.searchable` is the generated `tsvector`, PostgreSQL's
  tokenized search document, and its GIN index is the fast lookup structure. For example, importing `weddings/first-look.ARW` and
  adding tag `ceremony` causes the trigger to rebuild one string from all current paths and tags, then PostgreSQL regenerates and
  indexes the tokenized form. The alternative was to duplicate refresh calls in import, tag, XMP, restore, and every future writer,
  where one missed caller would make search silently stale.
- **The gap:** The plan required a generated text-search value over normalized file and tag data, a shape PostgreSQL cannot express
  as one generated-column formula, but did not select the synchronization owner.
- **The reach:** New file/tag writers inherit correct indexing without command-layer bookkeeping. The materialized input is an
  internal projection, not a second user-editable source of truth; direct child-row changes still refresh it.
- **Verdict:** **Sound.** Database triggers cover every writer at the boundary where the normalized facts actually change, and the
  generated/indexed value remains mechanically derived.
- **Confidence:** High.

### Slice 09c — Keyless catalog search uses PostgreSQL's English text configuration

- **When:** Slice 09c full-text search implementation, 2026-09-05.
- **The choice:** Both indexed documents and queries use PostgreSQL's `english` configuration. It tokenizes filename, folder, and
  tag words and applies the same stemming and stop-word rules at write and read time. Before parsing, both sides replace runs of
  non-alphanumeric punctuation with spaces; the query builds that document once and reuses it for matching and rank. A
  punctuation-only query becomes no document and returns no hits. The alternative `simple` configuration would preserve every
  token exactly but would not match ordinary English inflections such as singular and plural forms.
- **The gap:** The plan required a generated `tsvector` and GIN index but did not choose a text-search configuration.
- **The reach:** Keyless retrieval is intentionally English-oriented; filenames and tags in other languages still tokenize, but
  they do not receive language-specific stemming. Changing this later requires rebuilding the generated column and index.
- **Verdict:** **Sound.** The query is natural-language text, the selected rules are applied symmetrically, and vector retrieval
  remains the multilingual/semantic arm whenever the explicitly configured provider is available.
- **Confidence:** Medium; a multilingual catalog evaluation may justify a different or per-library configuration.

### Slice 09c — Background batches yield the daemon command lane, not its lifetime kernel lock

- **When:** Slice 09c worker integration, 2026-09-05.
- **The choice:** photoctl already has exactly one process—the daemon—holding the library's kernel lock and one PGlite handle for
  its lifetime. The embedding worker uses that same handle. It selects at most 50 photos, performs bounded per-photo provider work,
  then pauses before selecting another batch; foreground socket commands take priority during that pause. The pause is derived as
  twice the same polling ceiling the worker uses to notice foreground work, so changing one timing budget cannot invalidate the
  other. The duet-agent alternative closed its independent database session between batches so another process could win the
  lock. Copying that literally here would close the daemon's shared command handle and break the architecture that made the daemon
  the sole lock owner.
- **The gap:** The plan said to lift a cross-process relinquish shape from a repo whose worker and foreground were separate database
  sessions, while photoctl's earlier slice deliberately centralized both in one daemon session.
- **The reach:** Background embedding cannot monopolize a whole backlog, the daemon remains the sole lock owner, and later workers
  must use the same cooperative foreground-priority lane rather than introduce a second lock/session model. Foreground requests
  also replace the worker's key/endpoint/cache context for its next batch. A monotonic cursor completes the current catalog sweep
  before one scalar retry deadline resets it, so failure state stays constant-size and foreground kicks cannot bypass cooldown.
  Shutdown aborts active provider I/O and retry backoff rather than waiting behind an ordinary timeout or `Retry-After` delay.
- **Verdict:** **Sound.** Foreground work stays bounded during automatic backfill while the one-lock invariant remains intact.
- **Confidence:** High.

### Slice 09c review — Foreground dispatch waits for worker database quiescence

- **When:** Slice 09c shared-handle integration review, 2026-09-05.
- **The choice:** Before any foreground dispatch, the daemon marks the embedding worker paused, aborts active provider or retry
  work, wakes sleeps, and awaits the worker promise. Only then may the command use the shared PGlite handle. Dispatch `finally`
  resumes the same monotonic sweep; a pause-aborted batch does not advance its cursor or enter cooldown.
- **The gap:** Checking a `foregroundBusy` flag before selecting 50 items left a time-of-check/time-of-use window in which a
  foreground transaction could begin while a later worker UPSERT used the same connection and transaction scope.
- **The reach:** Foreground transactions cannot absorb or roll back background embeddings, and foreground work waits for at most
  the abort/safe-point boundary rather than the remainder of 50 provider requests. Completed pre-pause UPSERTs stay committed and
  are naturally skipped on resume.
- **Verdict:** **Sound.** One shared database handle requires explicit ownership transfer, not cooperative polling alone.
- **Confidence:** High.

### Slice 09c review — Provider errors end before catalog persistence begins

- **When:** Slice 09c worker liveness review, 2026-09-05.
- **The choice:** The adapter call owns provider error classification; once it returns a validated vector, the catalog UPSERT runs
  outside that recovery boundary. A persistence failure therefore escapes a foreground batch or becomes one contained background
  diagnostic, and automatic work stops until another command kicks it.
- **The gap:** One broad per-item catch converted an UPSERT rejection into `provider_busy`, causing the worker to buy the same
  vector again after cooldown while hiding the local database fault.
- **The reach:** Per-photo provider failures remain isolated, but local durability failures are never retried as external work.
  An operator-triggered retry after fixing the catalog can still regenerate because the first vector was never committed.
- **Verdict:** **Sound.** Payment/retry policy must not cross the boundary where remote success becomes local persistence.
- **Confidence:** High.

### Slice 09c review — Mixed-model vector ranking is exact within a materialized model set

- **When:** Slice 09c hybrid-search integration review, 2026-09-05.
- **The choice:** Search first materializes all embeddings for the requested model, then applies exact cosine ordering and the
  bounded candidate limit. Schema v8 retains its HNSW index, but this query deliberately does not use it while a single photo-keyed
  table can contain rows from several model generations.
- **The gap:** HNSW ordering followed by `WHERE model = ...` may approximate across every model and only then discard old-model
  rows, underfilling the current-model arm during a partial backfill.
- **The reach:** Current-model recall is correct during migrations at the cost of scanning that model's materialized rows. A future
  model-aware physical index or partition can restore approximate indexed ranking without changing the search envelope.
- **Verdict:** **Sound.** Correct model isolation is more important than claiming an index whose ordering domain is too broad.
- **Confidence:** High; the pinned PGlite EXPLAIN proves a CTE scan plus exact sort and no HNSW post-filter.

### Slice 09c — The provisional multimodal dialect stays one photo per provider request

- **When:** Slice 09c provider integration, 2026-09-05.
- **The choice:** The background worker's database batch contains up to 50 photos, but each external request contains exactly one
  photo: fixed descriptive text plus that photo's pinned 1616-tier JPEG. The adapter accepts success only when that request returns
  exactly one finite 3,072-number vector. Requests run one at a time within the database batch, so provider concurrency is bounded
  at one. If photo 17 has a missing preview or malformed response, its result fails and photos 18–50 still run. Sending all 50
  images in one request would invent a batch dialect that the already-unaccepted one-item live candidate never proposed, and one
  malformed item would make the whole provider response ambiguous.
- **The gap:** The slice fixed the database batch size but the live evidence defined only a one-item candidate request and did not
  authorize a multi-image request body.
- **The reach:** Provider payload cardinality, strict validation, bounded concurrency, and per-item failure isolation stay aligned.
  A successful live smoke can promote this candidate; a rejection must produce a newly named request-shape version rather than a
  silent fallback. Serial calls make a batch slower than controlled parallelism would.
- **Verdict:** **Sound.** It spends more HTTP round trips and wall time to avoid claiming an unsupported provider contract, prevent
  a 50-request burst, and keep every failure attributable to one catalog item.
- **Confidence:** Medium until the live Gateway accepts or rejects the candidate.

### Slice 09c — `embed --all` is an idempotent backfill; named IDs request refresh

- **When:** Slice 09c manual command implementation, 2026-09-05.
- **The choice:** `embed --all` pages through photos that have no vector for the currently configured model, including rows whose
  stored model is stale, and leaves already-current rows alone. Running it again after a lost terminal response therefore costs
  nothing and returns an empty successful batch. Passing explicit photo IDs means “refresh these,” so those rows are sent again and
  UPSERTed even when already current. The alternative made every retry of `--all` upload an entire library and incur provider cost
  merely because the caller could not tell whether the prior response arrived.
- **The gap:** The plan offered `--all` and named-ID forms but did not say whether current embeddings were refreshed.
- **The reach:** Automation gets safe replay for whole-library maintenance while operators retain a precise repair/re-embed path.
  Model changes naturally backfill because a row from a different model is not current.
- **Verdict:** **Sound.** It follows the repository's idempotent-operation rule and minimizes unasked paid work.
- **Confidence:** High.

### Slice 09c review — Slow foreground provider calls send activity frames

- **When:** Slice 09c independent scale review, 2026-09-05.
- **The choice:** Foreground embedding and search reuse daemon `progress` frames every five seconds while provider I/O, retry
  backoff, or response parsing is pending. Embed also reports command start and each 50-row database batch. The client applies an
  idle ceiling of at least 31 seconds, never shorter than a caller's queue-admission budget, and resets it on every frame. A single
  provider call that takes 30 seconds therefore emits several small frames, while work queued behind a longer foreground command
  keeps its requested admission window.
- **The gap:** Serial one-photo provider calls can leave a command silent beyond the ordinary 31-second idle timeout, causing the
  client to retry paid work. The plan required activity but did not choose its cadence or idle margin.
- **The reach:** A single request near the gateway timeout and a complete retry sequence both stay visibly alive. Future
  foreground provider commands should reuse the event seam rather than receive an unbounded total timeout.
- **Verdict:** **Sound.** Five seconds is well inside the existing idle window without making progress output noisy at human scale.
- **Confidence:** High.

### Slice 09c review — Whole-library output keeps totals and only the first 100 failures

- **When:** Slice 09c independent scale review, 2026-09-05.
- **The choice:** `embed --all` counts every success and failure but does not keep successful item rows. It retains the first 100
  failures in catalog order and reports how many later failures were omitted. Thus a million-photo success returns an empty result
  list and exact totals; a million-photo failure returns 100 attributable examples, exact totals, and an explicit omitted count.
- **The gap:** The review required a bounded aggregate but did not choose the failure-detail budget or which failures survive.
- **The reach:** Direct memory and the terminal daemon frame no longer scale with library size. Operators see early deterministic
  failures but must use explicit-ID batches when they need a complete per-photo repair report.
- **Verdict:** **Sound.** One hundred ordered examples are enough to diagnose a systemic failure while keeping output fixed-size.
- **Confidence:** Medium; later operator evidence may justify another cap without changing the response shape.

### Slice 09c review — Explicit embed keeps per-item rows within a fixed request budget

- **When:** Slice 09c independent scale review, 2026-09-05.
- **The choice:** Explicit embedding accepts at most 1,000 photo IDs and returns one result for each. Model identifiers are bounded
  to 256 bytes before entering any provider or command result, and each ID/prefix is rejected above its canonical 36-character
  limit before it can be echoed in a failure row. Even the largest accepted explicit batch therefore remains far below the
  daemon's 16 MiB frame; larger maintenance jobs use the aggregate `--all` contract.
- **The gap:** The review allowed the per-item contract to remain only if argument and response memory were bounded, but supplied
  neither an ID count nor a string-size ceiling.
- **The reach:** Scripts keep precise attribution for repair batches, while direct programmatic dispatch cannot bypass the CLI's
  operating-system argument limit and allocate an unbounded result array.
- **Verdict:** **Sound.** The limit is conservative relative to the wire ceiling and makes the guarantee depend on schema bounds,
  not typical string lengths.
- **Confidence:** Medium; changing the count later is compatible, while widening model IDs must preserve the frame calculation.

### Slice 09c review — A configuration rejection pauses automatic embedding until context refresh

- **When:** Slice 09c failure-path review, 2026-09-05.
- **The choice:** A 401/403/404 embedding rejection is treated as a failure of the shared credential/model/endpoint context, not 50
  independent photo failures. The command records the remainder of the selected batch without more provider calls, and the
  automatic worker stops until a later foreground command supplies current key/endpoint/cache context and kicks it. HTTP 400 is
  an isolated per-image `provider_busy` result, so later photos continue; transient failures retain their five-minute retry wakeup.
- **The gap:** Per-item isolation alone made a full 50-row batch immediately retry the same unusable request context forever.
- **The reach:** Bad credentials or a missing shared endpoint/model produce one external request per automatic pass, avoiding spin
  and repeated paid work, while one malformed image cannot stall the library and an operator can resume immediately by issuing a
  command with corrected context.
- **Verdict:** **Sound.** Configuration is shared across the batch; retrying it per photo adds no information.
- **Confidence:** High.

### Slice 09c review — Detached worker failures are contained at the daemon boundary

- **When:** Slice 09c failure-path review, 2026-09-05.
- **The choice:** A setup, schema, or catalog rejection from detached worker work is caught at `kick`, reported once as a bounded
  single-line diagnostic, and left dormant until a later kick. `stop` still cancels active provider work and resolves normally.
- **The gap:** A detached promise had cleanup but no rejection owner, so one local failure could become an unhandled rejection and
  make daemon shutdown reject.
- **The reach:** The foreground daemon remains usable after background infrastructure failures without hiding the diagnostic or
  turning a persistent fault into a busy loop.
- **Verdict:** **Sound.** The daemon owns the detached lifecycle and therefore owns containment and reporting at that boundary.
- **Confidence:** High.

### Slice 09c review — Provider failure drops only the optional vector search arm

- **When:** Slice 09c failure-path review, 2026-09-05.
- **The choice:** Query-embedding configuration, authentication, rate-limit, timeout, outage, and malformed HTTP-success JSON
  failures return text-search hits with a provider warning. The Gateway maps parse failures to a bounded provider error without
  retaining the response body. The local indexed-search and fusion path runs outside that recovery boundary, so its failures
  remain hard command errors. Streaming emits the same warning event carried by the final envelope.
- **The gap:** Keyless search already fell back to text, but a present yet expired or unavailable provider failed the whole search.
- **The reach:** Catalog search remains useful during provider incidents without misrepresenting local database corruption as an
  optional-service warning.
- **Verdict:** **Sound.** The vector arm enriches recall; it does not own availability of the authoritative local catalog.
- **Confidence:** High.

### Slice 09c — Each retrieval arm contributes at most 200 ranked candidates

- **When:** Slice 09c hybrid-search implementation, 2026-09-05.
- **The choice:** Search returns at most 50 hits, but each text/vector arm supplies a candidate window of at least 50, normally four
  times the requested count, and never more than 200 before reciprocal-rank fusion combines them. This lets an item moderately
  ranked in both arms rise into the final page without reading an unbounded library into JavaScript. Fetching only the requested
  count per arm would miss some cross-arm agreements; fetching every match would make latency and memory grow with the catalog.
- **The gap:** The plan fixed the public limit and RRF constant but not the internal candidate window.
- **The reach:** Recall quality beyond the first 200 candidates is intentionally bounded. Later relevance evaluation may change
  this one policy without changing storage, score shape, or the command protocol.
- **Verdict:** **Sound.** The cap is safely above the public page while preserving bounded work, though real-library evaluation may
  justify a different multiplier.
- **Confidence:** Medium.

### Slice 09c — Search labels each hit with one deterministic catalog filename

- **When:** Slice 09c search-result hydration, 2026-09-05.
- **The choice:** A photo can have several file locators. Search reports the basename of its lexicographically first stored relative
  path, without probing volumes or exposing an absolute path. Choosing an online locator would make relevance output depend on
  which drive happens to be mounted and would turn one indexed query into per-hit filesystem work.
- **The gap:** The public hit shape required one `file` string but did not define how to select it for multi-locator photos.
- **The reach:** The label is stable and cheap but is descriptive, not a promise that this locator is currently online; `show` keeps
  ownership of actual source resolution.
- **Verdict:** **Sound.** It preserves bounded search and avoids leaking host paths while giving humans a recognizable filename.
- **Confidence:** High.

### Slice 08c2 — Masked controls extend the one native grade in tonal order

- **When:** Slice 08c2 masked-operator implementation, 2026-09-05.
- **The choice:** The existing native scene-linear grade remains the sole pixel owner. It now applies shadows, highlights,
  saturation, then vibrance after the primary controls. Highlights and shadows derive smooth masks from Rec.2020 luminance and
  apply scalar stop gains, preserving chromaticity and unclamped working samples.
- **The gap:** The plan named each operator and its masks, but did not pin their relative order beyond the existing fixed pipeline.
- **The reach:** Every in-memory and artifact-backed caller receives identical deterministic ordering without a second evaluator;
  later curve and local operators inherit one explicit insertion point.
- **Verdict:** **Sound.** Tonal selection precedes colorfulness changes, and the shared owner keeps the module seam narrow.
- **Confidence:** Medium; the delegated mask constants still need broader photographic tuning.

### Slice 08c2 — Skin protection classifies hue after converting working primaries

- **When:** Slice 08c2 vibrance implementation, 2026-09-05.
- **The choice:** Vibrance converts Rec.2020 samples to linear-sRGB primaries only to classify hue, then attenuates the color boost
  in a smooth warm-hue band. The operator remains color-only and deterministic; it does not claim face or semantic skin detection.
- **The gap:** The plan required skin-hue protection but did not define the hue coordinate system or require a learned detector.
- **The reach:** Working-space math stays Rec.2020 while the familiar hue classification avoids interpreting Rec.2020 channel
  angles as sRGB hues. The protection can also affect warm non-skin colors, a deliberate limitation of this portable slice.
- **Verdict:** **Sound.** This is the smallest portable interpretation of hue protection and leaves semantic masking to later owners.
- **Confidence:** Medium; equal-saturation tests pin behavior, while visual portrait acceptance remains open for lack of a fixture.

### Slice 10a — Graph-only revisions inherit the complete layer snapshot

- **When:** Slice 10a immutable document writer, 2026-09-05.
- **The choice:** A caller that changes only the graph may omit `layers`; the writer then copies every row from the active
  revision into the new immutable snapshot. Passing `layers:[]` is different and explicitly clears the active stack. For example,
  a metadata-independent base edit cannot accidentally make two subject layers disappear merely because that caller predates the
  layer commands, while `layer clear` can still say exactly what it means. When the inherited stack is empty, changing either
  `base` or `output` advances both typed roots; once layers exist, the explicit composite projection keeps them distinct. The alternative
  required every graph caller to read and echo the stack even when it was not changing it, creating many places that could silently
  drop a row.
- **The gap:** The plan requires complete snapshots but did not define whether unchanged callers must resubmit them.
- **The reach:** Every future graph mutation inherits layers safely by default; commands that reorder, rename, disable, remove, or
  clear layers must submit the complete replacement snapshot so the transaction can validate its exact composite projection.
- **Verdict:** **Sound.** Inheritance preserves immutable state while an explicit empty list keeps clear/removal unambiguous.
- **Confidence:** High.

### Slice 10a — Vacancy is the only role that may point at another layer

- **When:** Slice 10a layer identity validation, 2026-09-05.
- **The choice:** A vacancy is the hole left by moving a subject, so it must store `of_layer` pointing to a `subject` identity in
  the same photo. Subject, reimagine, and retouch identities must leave `of_layer` empty. Thus a future fill can follow a vacancy
  back to the subject whose original silhouette it preserves, while ordinary layers do not acquire vague parent relationships.
  The alternative allowed arbitrary layer-to-layer links that no current command could explain or render.
- **The gap:** The schema named `of_layer` and required legal role pairings but did not enumerate the pairing table.
- **The reach:** Move/fill owns one precise relationship; adding another relationship later requires deliberately widening this
  validation rather than teaching every reader to interpret an unconstrained graph.
- **Verdict:** **Sound.** It constrains persistence to the only relationship in the current product contract.
- **Confidence:** Medium because a later retouch workflow may justify a separately named relationship.

### Slice 10a — Permanent masks are zero-input artifact pins

- **When:** Slice 10a graph branch vocabulary, 2026-09-05.
- **The choice:** A permanent manual or SAM selection is represented by a deterministic `mask` node whose parameter is the full
  canonical mask-artifact hash and which has no graph input. In plain terms, the node says “this exact saved coverage image,” not
  “run segmentation again.” Transform and resample nodes may then derive new mask branches from that immutable pin. The alternative
  stored brush prompts or model inputs and made evaluation regenerate a selection that was already accepted and saved.
- **The gap:** The plan named a typed deterministic mask node but not its recipe parameters or arity.
- **The reach:** Slice 10b2 must make the typed mask artifact reader/evaluator honor this pin; later segment commands publish the
  artifact before committing the node. Retention reads the pinned hash directly from the mask recipe, because a permanent pin does
  not need a `node_executions` row merely to stay live. The revision writer refuses a snapshot if any permanent mask pin in its mask
  branch is not published and available. Mask identity remains stable across rename, reorder, and content refresh.
- **Verdict:** **Sound.** It makes the accepted mask bytes, rather than a replayable procedure, the permanent editing fact.
- **Confidence:** Medium until 10b2 wires the evaluator and typed media contract.

### Slice 10a — UUID layer identities are allocated only inside the revision transaction

- **When:** Slice 10a document writer, 2026-09-05.
- **The choice:** New layers receive UUIDs after the expected active revision has been locked and checked, inside the same database
  transaction that stores graph nodes, the complete stack, and the new active revision. A stale caller therefore leaves no visible
  identity behind; a successful retry receives the identity from the successful revision. The alternative allocated and inserted
  identities before compare-and-swap, leaving unattached rows when two agents edited the same photo concurrently.
- **The gap:** The plan required stable full IDs and atomic failure but did not choose their format or allocation point.
- **The reach:** Prefix lookup follows the same 36-character UUID vocabulary as photos, while names remain freely revisioned
  presentation. Future commands must reference the writer-returned identity rather than manufacture a name-derived ID.
- **Verdict:** **Sound.** It reuses the catalog identity convention and makes the transaction boundary enforce the no-orphan rule.
- **Confidence:** High.

### Slice 10a — Delta recipes reuse the develop dictionary over one RGB input

- **When:** Slice 10a graph branch vocabulary, 2026-09-05.
- **The choice:** A deterministic `delta` node consumes one RGB node and stores the same sparse, validated operator dictionary used
  by develop nodes. For example, exposure compensation can be `{exposure:0.5}` without inventing a second spelling or range; the
  node means “apply this compensation to these already-generated pixels.” The alternative introduced a parallel adjustment schema
  that would have to remain synchronized with Slice 08's operator owner.
- **The gap:** The plan named the delta node and its purpose but left its exact recipe shape and arity to implementation.
- **The reach:** Slice 10b3 can derive compatible compensation from the one develop-operator table and persist it without a schema
  translation. If compensation later needs provenance beyond operator values, that belongs in a separate field rather than a
  duplicate operator vocabulary.
- **Verdict:** **Sound.** One input and the existing validated dictionary are the narrowest shape the described operation needs.
- **Confidence:** Medium until 10b3 exercises every Tier-1 operator.

### Slice 10a — Relative transforms pre-multiply the current base-space matrix

- **When:** Slice 10a pure transform contract, 2026-09-05.
- **The choice:** An absolute request compiles directly to one scale-then-rotate-then-translate matrix about its resolved anchor and
  replaces the prior matrix. A relative request compiles the same way and pre-multiplies the stored matrix: `next = nudge × current`.
  Applying the result to a point is therefore the same as applying the old edit first and the new base-space nudge second. The
  alternative post-multiplied the nudge, making translation rotate or scale in the layer's already-transformed local axes.
- **The gap:** The plan fixed absolute versus relative behavior and S→R→T order but did not state which coordinate frame relative
  composition uses or name the combined horizontal-and-vertical flip value.
- **The reach:** Layer commands can retry absolute placement idempotently and use relative movement in the oriented base coordinate
  system. The pure owner also snaps quarter-turn sine/cosine values so exact geometry does not inherit floating-point near-zero.
- **Verdict:** **Sound.** Base-space nudges match the global coordinate contract and the documented command meaning.
- **Confidence:** Medium; 10c1's real command ergonomics will confirm the relative-frame choice.

### Slice 10a — Opacity snapshots preserve recipe-number precision

- **When:** Slice 10a immutable layer persistence review, 2026-09-05.
- **The choice:** PostgreSQL stores opacity as double precision, matching JavaScript and JSON recipe numbers. A value such as
  `0.123456789` therefore survives a snapshot reload exactly enough for a rename-only revision to prove that the unchanged
  composite-v2 recipe still projects the layer rows. The alternative `real` column rounded to float32 on write while the recipe
  retained the original number, giving one immutable edit two identities depending on whether it had crossed the database seam.
- **The gap:** The plan constrained opacity to `[0,1]` but did not choose a database precision or a separate canonical quantization.
- **The reach:** Snapshot reloads, recipe equality, render hashes, and future opacity commands use one numeric representation.
- **Verdict:** **Sound.** Persistence must not silently change an identity-bearing recipe parameter.
- **Confidence:** High.

### Slice 10b1 — Resampling maps pixel centers and widens Lanczos support when reducing

- **When:** Slice 10b1 native resample/transform implementation, 2026-09-05.
- **The choice:** A destination pixel maps from its center to the corresponding source-pixel center. Affine transforms pass that
  center through the canonical base-image edge-coordinate matrix before converting back to a sample index. Bilinear preview reads clamp
  at the source edge. Lanczos3 widens its radius-three sampling footprint in proportion to any reduction, including reduction caused
  by a layer's uniform transform matrix, then normalizes the contributing weights. For example, shrinking a four-pixel row to two
  pixels integrates a wider neighborhood instead of choosing two sharp point samples; enlarging retains ordinary radius-three
  Lanczos. Transform taps outside the source contribute zero, so a partially overlapping footprint fades continuously and a fully
  outside footprint returns zero. An integral lattice transform such as a flip or quarter-turn copies the exact source sample and
  bypasses every filter.
- **The gap:** The plan selected bilinear, Lanczos3, and exact right-angle geometry but did not define pixel-center mapping, edge
  behavior, transform-edge coverage, or how the Lanczos footprint changes during reduction.
- **The reach:** Preview, provider normalization, and future RGB/mask layer callers share one coordinate convention. Downscaled
  layers anti-alias; exact flips and quarter-turns remain bit-identical; translated empty space stays empty for later composition.
- **Verdict:** **Sound.** Center mapping is symmetric, scaled support prevents avoidable aliasing, and the integer fast path makes
  the exactness requirement structural rather than tolerance-based.
- **Confidence:** High for the pinned asymmetric grids and integer identities; medium for later mask-edge treatment, which 10b2
  must judge with its explicit coverage contract.

### Slice 10b1 — Native resampling preserves caller sample depth and bounds full-raster admission

- **When:** Slice 10b1 N-API and preview integration, 2026-09-05.
- **The choice:** Float layer resample/transform copies JavaScript's typed array once, then runs on a native worker and resolves a
  new typed array. Display-preview resampling instead borrows the caller's 8- or 16-bit typed array for the duration of a synchronous
  native call and allocates only the final-sized output. The generic layer route retains Float32 because scene-linear RGB and future
  masks require it. Sharp decodes the selected preview region and encodes the already-final-sized JPEG, but never receives a resize
  instruction. Imported preview decode admits at most one full raster at a time even though the surrounding import pipeline prepares
  four candidates; the cheap rendered-view path crops and downsamples its existing U16 raster before 8-bit conversion. The file
  decoder preserves its 16-bit display contract through the same typed native bilinear owner before color conversion.
- **The cache boundary:** Derived-view recipe version 2 identifies the Rust bilinear pixel algorithm, so version-1 artifacts made
  by Sharp are not reused after upgrade. Full-frame masters retain their render-hash identity because they are not downsampled.
- **The gap:** The plan assigned pixel ownership to Rust but did not specify scheduling or the typed-array safety/memory boundary.
- **The reach:** Float worker inputs cannot race JavaScript mutation; borrowed display inputs finish before control returns to
  JavaScript. Preview resampling adds no full-raster transport copy or Float32 expansion, concurrent import preparation retains at
  most one decoded preview raster, and future scene-linear layer operations have an asynchronous Float32 seam without another pixel
  implementation.
- **Verdict:** **Sound.** Ownership and admission are explicit, and each caller pays only for the precision its contract needs.
- **Confidence:** High; the production preview regression observes zero Sharp resize calls and exact equality with the native
  output on pixels where Sharp's default differs.

### Slice 10b3 — Layer compatibility is reconstructed from immutable graph lineage

- **When:** Slice 10b3 develop compensation implementation, 2026-09-05.
- **The choice:** Before planning a develop change, photoctl walks each layer content branch from its retained develop ancestor
  through every persisted delta node and reconstructs the develop state those pixels actually represent. It plans and reports each
  stable layer identity independently, including disabled layers. A Tier-2 edit adds no node, so a later edit still compares against
  the branch's last represented state rather than the newer base state. The alternative remembered only the preceding global edit,
  which could append a Tier-1 delta to an already-stale branch and falsely report it synchronized.
- **The gap:** The plan required stale branches to remain bound to their exact ancestor but introduced no mutable stale flag and did
  not specify how later develop commands recover that status.
- **The reach:** Staleness survives process restarts and arbitrary numbers of revisions without duplicating identity in a column;
  a branch becomes current only when its lineage can be compensated to the requested base state or a later provider refresh rebinds
  it. Future layer transforms must retain the content ancestry so this reconstruction remains valid.
- **Verdict:** **Sound.** The immutable DAG is already the authority for what pixels mean, and deriving status prevents a second
  state owner from drifting away from it.
- **Confidence:** High for the linear content chains produced through this slice; 10c1 must retain the same first-input ancestry
  convention when it adds layer transforms.

### Slice 10b3 — Delta planning refuses transitions that cannot compose exactly

- **When:** Slice 10b3 independent review, 2026-09-05.
- **The choice:** A layer at identity may receive the complete Tier-1 dictionary once. Later single-operator compensation uses the
  operator's composition law: additive controls use a difference, saturation uses a gain ratio, and black point composes its affine
  pivot. Large representable changes split into schema-valid nodes without changing that composition. Saturation from zero chroma,
  repeated vibrance, mixed active controls, and other order-dependent transitions are reported stale instead of receiving an
  approximate delta. The 300 K white-balance boundary and all Tier-2 membership still come from the single develop-operator owner.
- **The gap:** The plan named Tier-1 controls but did not define inverse/composition behavior after a layer had already accumulated
  adjustments. Raw parameter subtraction is not valid for multiplicative or lossy operators and could claim a match while producing
  visibly different pixels.
- **The reach:** `delta_applied` means the persisted operation has a defensible scene-linear composition, while conservative cases
  remain available unchanged and emit `layers_stale`. Supporting more combinations later requires adding a proven composition rule,
  not weakening the result meaning.
- **Verdict:** **Sound.** A conservative stale result preserves pixels and truthfully exposes the need for refresh; a false success
  would silently corrupt the user's edit semantics.
- **Confidence:** High for exposure and the composition identities pinned by tests; medium for expanding safe combinations after
  real provider-generated layer workflows exist.

### Slice 10b2 — Canonical masks use a profile-free Float32 TIFF contract distinct from RGB

- **When:** Slice 10b2 mask artifact implementation, 2026-09-05.
- **The choice:** A mask is an uncompressed little-endian single-channel IEEE Float32 TIFF with black-is-zero photometry, no
  color profile, finite coverage samples constrained to `[0,1]`, and the dedicated media type
  `image/vnd.photoctl.mask+tiff`. Publication and restore reconciliation validate that contract rather than accepting any TIFF
  whose dimensions happen to match.
- **The gap:** The plan fixed the semantic sample type and required a distinct deterministic artifact contract, but did not choose
  its exact byte layout or media-type spelling.
- **The reach:** Artifact hashes, node pins, evaluator dispatch, restore repair, and later manual/SAM producers all share one
  unambiguous mask identity without allowing RGB artifacts to pose as coverage.
- **Verdict:** **Sound.** The layout is minimal and deterministic, and the distinct media type keeps the storage boundary typed.
- **Confidence:** High; exact-byte round trips and wrong-type/corruption regressions cover publication and restore.

### Slice 10b2 — Mask transforms clamp filtered coverage and composition skips zero alpha

- **When:** Slice 10b2 native transform/composite implementation, 2026-09-05.
- **The choice:** Mask transforms reuse the canonical Lanczos3 coordinate owner used by RGB, then clamp filter ringing to legal
  coverage `[0,1]`. Normal composition calculates effective alpha from coverage and opacity, but skips the write entirely when
  alpha is zero so the accumulated base sample retains its exact Float32 bits.
- **The gap:** The plan required one transform matrix, legal mask coverage, and exact pixels outside the effective mask, but did
  not state how a signed resampling kernel's overshoot is reconciled with coverage or how exactness survives arithmetic.
- **The reach:** Lifted RGB and active masks stay geometrically aligned; transparent areas of later layers cannot perturb or erase
  earlier results in the ordered composite-v2 fold.
- **Verdict:** **Sound.** Clamping belongs at the mask boundary, and the zero-alpha branch makes the exactness invariant structural.
- **Confidence:** High; asymmetric transform and bit-level composite regressions pin both behaviors.

### Slice 10b2 — A corrupt permanent mask pin is made unavailable on its first evaluator read

- **When:** Slice 10b2 independent review, 2026-09-05.
- **The choice:** If evaluator validation rejects a permanent mask's pinned bytes, it clears that artifact's availability before
  returning the corruption error, matching restore reconciliation instead of repeatedly trusting the stale catalog claim.
- **The gap:** The artifact owner defined repair and restore behavior, but the zero-input mask evaluator path could be the first
  process to discover corruption after startup.
- **The reach:** Subsequent evaluation and retention see truthful availability, and a later deterministic republication can repair
  the same hash without a separate restore cycle.
- **Verdict:** **Sound.** Discovery of invalid canonical bytes must update the catalog fact owned by the artifact boundary.
- **Confidence:** High; a first-read corruption regression proves both the error and availability transition.

### Slice 08d3 — Geometry projects base-space requests through one affine owner

- **When:** Slice 08d3 geometry implementation, 2026-09-05.
- **The choice:** A crop is first resolved in the photo's oriented, uncropped base coordinate system.
  An optional aspect ratio keeps the largest centered rectangle inside that crop. Photoctl then maps
  that continuous rectangle onto the nearest whole-pixel output, applies an exact clockwise quarter-turn,
  and finally straightens around the new center. Straighten returns the largest centered rectangle that
  fits inside the rotated pixels, avoiding empty black corners. The same composed matrix maps a base-space
  `show --region` request into the developed raster and maps clicks back; the caller's original base-space
  request, not the internal projected rectangle, remains the view-hash identity. When only a smaller embedded
  or pinned source is available, catalog-space crop coordinates scale to that source before the same plan runs.
  Canonical TIFF geometry stays in the native transform worker, which patches canonical dimensions and releases
  its input frame before encoding output bytes; the persistent JavaScript daemon never walks full-frame samples.
- **The gap:** The plan fixed the coordinate space, operator order, and exact rotations, but did not choose
  fractional crop rasterization, aspect anchoring, straighten canvas bounds, or whether projected cache
  identity should expose internal output coordinates.
- **The reach:** Develop, canonical artifact dimensions, online and offline previews, view-cache reuse, and
  future mask/layer consumers inherit one geometry plan. A request wholly outside developed pixels is a
  usage error; a partial request reports the actual base-space intersection.
- **Verdict:** **Sound.** Centered maximal crops are deterministic and reversible in the dictionary, trimming
  prevents synthetic borders, and keeping base-space view identity preserves the public coordinate contract.
- **Confidence:** Medium; exact grids and the production RAW crop are green, while later manual crop UX can
  revisit aspect anchoring without changing the geometry owner.

### Slice 08d3 — Invalid crops fail before immutable state commits

- **When:** Slice 08d3 command integration, 2026-09-05.
- **The choice:** If a batch asks to crop past a photo edge, that photo returns a `usage` failure before a new
  document revision is written, while independent photos in the same batch can continue. Deferring the check
  until `show` or export would leave a valid-looking active revision that cannot render.
- **The gap:** The plan constrained coordinates but did not name whether crop bounds are checked at mutation
  time or evaluation time.
- **The reach:** Offline metadata edits remain possible because dimensions live in the catalog, and every later
  renderer can assume the active crop intersects and stays inside the oriented base raster.
- **Verdict:** **Sound.** The catalog already owns the dimensions needed for deterministic validation, so invalid
  immutable state never becomes active.
- **Confidence:** High.

### Slice 08d4 — A present B&W dictionary activates monochrome mode

- **When:** Slice 08d4 filter and B&W implementation, 2026-09-05.
- **The choice:** A photo enters monochrome mode whenever its develop state contains a `bw` object,
  even if the only stored control is zero. For example, `{bw:{intensity:0}}` still converts the color
  frame to neutral Rec.2020 luminance; intensity zero means neutral B&W density, not “blend zero percent
  toward B&W.” Removing the whole `bw` object restores color. The alternative is a separate enable flag
  or treating intensity as a color-to-monochrome blend, neither of which exists in the public dictionary.
- **The gap:** The plan named four B&W controls and their ranges but did not define which value activates
  monochrome mode.
- **The reach:** Presets, `--set`/`--unset`, copy-edits, hashes, and future interfaces all inherit one
  unambiguous activation rule without adding a fifth hidden control.
- **Verdict:** **Sound.** Object presence is already durable state and makes zero a useful neutral setting;
  users can reverse the mode by unsetting `bw`.
- **Confidence:** Medium; the API stays minimal, but a later UI may prefer an explicit B&W toggle and can
  map that toggle to adding or removing the same object.

### Slice 10c1 — Manual masks use pixel-center coverage and clip at the oriented base frame

- **When:** Slice 10c1 manual segmentation integration, 2026-09-05.
- **The choice:** A box is half-open: its left and top edges are included and its right and bottom edges are excluded. A pixel is
  selected when its center falls inside that box. A brush is treated as a closed polygon and uses the even-odd fill rule at the
  same pixel centers. Coordinates outside the image are harmlessly clipped by rasterization, while `--norm` requires every supplied
  number to stay between zero and one before scaling to the oriented, uncropped photo dimensions. The alternative was to round
  coordinates into inclusive integer endpoints or reject any shape that crosses the image edge, both of which make fractional and
  normalized selections depend on ad-hoc boundary cases.
- **The gap:** The plan required exact brush round-trips, box masks, normalized coordinates, and the global oriented coordinate
  space, but did not define edge inclusion, polygon fill, or partial out-of-frame behavior.
- **The reach:** Manual selections, later model-returned polygons, mask bounding boxes, and transform anchors inherit one raster
  convention. A box `x=1,w=2` covers the two pixel centers at 1.5 and 2.5, never a third endpoint pixel.
- **Verdict:** **Sound.** It reuses the graph's existing pixel-center geometry and makes clipping deterministic without changing the
  requested shape's stored bounds.
- **Confidence:** Medium; the math is stable, while a future interactive brush may choose a stroked-path vocabulary rather than a
  filled polygon.

### Slice 10c1 — A manual subject stays lazy by referencing the immutable base branch

- **When:** Slice 10c1 segment and composite integration, 2026-09-05.
- **The choice:** Segmenting does not render and save a second RGB image. The new subject layer points its content at the current
  immutable base-output node and pairs that branch with the newly published permanent mask. When `show` or export eventually asks
  for pixels, the evaluator renders the base branch and the mask clips it during composition. The unbuilt alternative was to add a
  new kind of RGB pin or constant node and eagerly lift selected pixels into it, which would invent graph vocabulary that no current
  artifact contract honestly represents.
- **The gap:** The plan required permanent mask publication and lazy mutation, but did not name the initial subject content recipe.
- **The reach:** Manual segmentation creates no node execution or preview and remains compatible with later transforms. Slice 10c2
  may build vacancy behavior from this content branch, but must not overload the mask pin as an RGB artifact.
- **Verdict:** **Sound.** Existing base, mask, transform, and composite owners express the selection without a second pixel owner or
  eager work.
- **Confidence:** High.

### Slice 10c1 — Layer transforms replace geometry beneath retained develop deltas

- **When:** Slice 10c1 transform integration, 2026-09-05.
- **The choice:** A develop delta is an immutable color compensation already attached to a layer branch. When an absolute transform
  replaces that layer's geometry, photoctl walks through the delta nodes, replaces or inserts the one transform beneath them, then
  rebuilds those same delta recipes above the new transform. In shorthand, `delta → old transform → content` becomes
  `delta → new transform → content`. If a relative transform uses the default centroid anchor, the original mask centroid is first
  mapped through the current matrix, so rotating a moved subject keeps its visible center fixed. An explicit `x,y` anchor remains a
  coordinate in the global oriented base frame.
- **The gap:** The plan required preserving 10b3 lineage and relative transform composition, but did not specify transform placement
  among retained delta nodes or whether the word “centroid” meant the original or currently visible center.
- **The reach:** Staleness reconstruction can continue walking the same first-input ancestry after arbitrary layer moves, and a
  photographer can move then rotate a subject without it orbiting its old location.
- **Verdict:** **Sound.** It keeps the immutable compensation meaning intact and makes the default anchor follow the layer users can
  currently see.
- **Confidence:** High for lineage; medium for explicit-anchor ergonomics until an interactive client exercises them.

### Slice 10c1 — Numeric reorder positions are one-based and z increases toward the front

- **When:** Slice 10c1 layer command integration, 2026-09-05.
- **The choice:** `layer reorder --to 1` moves a layer to the back. The highest valid position moves it to the front, matching
  `--back` and `--front`; persisted `z` remains zero-based internally and increases toward the front. The alternative exposed the
  database's zero-based index directly, making the first user-visible layer “position zero” while the command vocabulary and
  existing examples speak in numbered layers.
- **The gap:** The plan named `--to N` and the directional forms but did not define whether N starts at zero or one.
- **The reach:** Scripts and future UI clients inherit the position convention; the response still exposes canonical zero-based `z`
  for exact stack inspection.
- **Verdict:** **Sound.** Human-facing ordinals start at one while storage retains the established z contract.
- **Confidence:** Medium.

### Slice 10c1 — Normalized transform displacements are signed image fractions

- **When:** Slice 10c1 transform command integration, 2026-09-05.
- **The choice:** With `--norm`, an anchor remains an ordinary point whose x and y each run from zero to one. A displacement is a
  vector rather than a point, so `dx=-0.25` means one quarter of the oriented image width to the left and `dy=0.5` means half its
  height downward; each component is bounded to minus one through plus one. Without `--norm`, both anchors and displacements remain
  base-image pixel values. The alternative applied the point-only zero-to-one rule to displacement vectors, which made normalized
  left and upward movement impossible.
- **The gap:** The global contract says normalized coordinates use zero to one, but does not distinguish positions from signed
  translation amounts.
- **The reach:** CLI scripts and later move controls can express direction symmetrically while sharing the same oriented base
  dimensions. Scale and rotation are dimensionless and therefore never change under `--norm`.
- **Verdict:** **Sound.** Signed fractions are the direct normalized form of a displacement and retain the documented point range
  for actual coordinates.
- **Confidence:** Medium.

### Slice 10c2 — Vacancy pixels have their own deterministic RGB recipe

- **When:** Slice 10c2 vacancy integration, 2026-09-05.
- **The choice:** A vacancy's magenta content is a zero-input `solid` recipe at version 1. Its parameters carry oriented width,
  height, the scene-linear Rec.2020 space, and one RGB triplet; evaluation allocates the pixels asynchronously in the native image
  owner. It is not disguised as provider output, a mask artifact, markup, or a special composite role.
- **The gap:** The plan required deterministic RGB vacancy content, but the graph had no honest artifact pin or constant-image node.
- **The reach:** Solid images now have a canonical hashable graph identity and remain lazy until show or export. Future constant
  backgrounds can reuse this vocabulary without teaching composite what a vacancy means.
- **Verdict:** **Sound.** One explicit versioned node keeps pixel generation, graph identity, and layer semantics in their existing
  owners.
- **Confidence:** High.

### Slice 10c2 — Repeated moves preserve one original vacancy identity

- **When:** Slice 10c2 move integration, 2026-09-05.
- **The choice:** The first move creates one vacancy identity for the subject; later moves reuse it even if a prior revision removed
  it. A partial unique database index enforces that invariant. Each active revision places the vacancy immediately behind its
  subject and renumbers the whole stack contiguously. `--to` translates the current visible mask centroid while preserving existing
  scale and rotation; `--by` adds a vector in oriented base-image coordinates. Because a second vacancy identity would violate this
  contract, `layer duplicate` rejects vacancy layers as a usage error.
- **The gap:** The plan required a stable original vacancy and repeat moves, but did not define reactivation after removal, exact
  stack placement, or whether `--to` discarded existing linear transforms.
- **The reach:** History always refers to the same logical hole, scripts do not accumulate vacancy identities, and repeated moves
  keep the subject's current shape while relocating it.
- **Verdict:** **Sound.** The database enforces the identity rule, while direct adjacency makes subject/vacancy order predictable
  without adding a group abstraction.
- **Confidence:** Medium; the identity and coordinate rules are strong, while a future UI may want vacancy grouping rather than
  adjacency as presentation policy.

### Slice 10c2 — Vacancy content never receives develop compensation or stale state

- **When:** Slice 10c2 develop-lineage integration, 2026-09-05.
- **The choice:** Develop changes plan deltas and staleness only for photographic layers. A vacancy retains its exact solid content
  chain, never appears in `delta_applied` or `stale`, and is reported separately as `vacancy_unfilled` only while enabled in the
  active revision. Show and export derive both warnings from the same active document snapshot.
- **The gap:** The plan required real stale IDs and a vacancy warning, but did not say whether the deliberately synthetic placeholder
  should inherit ordinary photographic develop policy.
- **The reach:** Editing exposure cannot tint the warning placeholder or make one vacancy count as two problems. Historical and
  disabled vacancy rows remain retained without warning current commands.
- **Verdict:** **Sound.** Vacancy state is workflow state, not photographic compatibility, so its warning and develop behavior stay
  separate.
- **Confidence:** High.

## Needs user

### Slice 10c2 — The provisional vacancy color is full scene-linear Rec.2020 magenta

- **When:** Slice 10c2 vacancy rendering, 2026-09-05.
- **The choice:** The `solid` v1 vacancy recipe stores exactly `rgb:[1,0,1]` in scene-linear Rec.2020 with white level 1. It renders
  as a deliberately unmistakable saturated magenta and is replaced later by provider-backed fill content. Alternatives include a
  display-referred sRGB magenta converted into the working space or a less saturated checker pattern.
- **The gap:** The plan named “magenta” but did not define exact samples, working-space interpretation, or visual intensity.
- **The reach:** Recipe hashes, exported warning images, screenshots, and any future color-picker representation inherit these exact
  values until the single solid-node parameter changes in a replacement revision.
- **Verdict:** **Needs-user.** The value is deterministic and conspicuous, but its visual character is a product choice that the
  blocked workbench screenshot gate could not validate in this environment.
- **Confidence:** Low until the workbench and real photographic composites are reviewed visually.

### Slice 10b2 — Morphology uses a square footprint and feather uses three bounded box passes

- **When:** Slice 10b2 mask-kernel implementation, 2026-09-05.
- **The choice:** Dilation and erosion use a zero-padded square footprint implemented as separable monotonic-window passes.
  Feather approximates a Gaussian with three zero-padded separable box passes. Both reject radii above 4,096 pixels so hostile
  parameters remain bounded while ordinary kernel work stays linear in image size.
- **The gap:** The plan named morphology and feather operations but did not choose circular versus square morphology, an exact
  Gaussian definition, edge treatment, or a maximum useful radius.
- **The reach:** Corners enter a one-pixel dilation, image-edge coverage fades against transparent space, and extremely large
  selections fail validation instead of monopolizing a native worker. Later manual and SAM masks inherit this silhouette feel.
- **Verdict:** **Needs-user.** The implementation is deterministic, fast, and isolated, but footprint and feather character are
  visible product choices that should be revisited with real photographic masks.
- **Confidence:** Medium for the bounded algorithm; low for the preferred visual character before the 10c2 visual gate.

### Slice 10b1 — Lanczos transforms reject kernels above 4,096 source taps per output sample

- **When:** Slice 10b1 independent review, 2026-09-05.
- **The choice:** A reducing affine transform widens Lanczos3 support for antialiasing, but rejects a request when the resulting
  two-dimensional kernel exceeds 4,096 source taps per output sample. This keeps a tiny positive scale from occupying a native
  worker effectively forever. The caller receives a validation error instead of a lower-quality silent fallback.
- **The gap:** The plan requires positive transform scales and scaled Lanczos support but does not bound the minimum useful scale,
  kernel work, or define a multistage reduction strategy.
- **The reach:** Extreme layer reductions must be expressed as a bounded resize plus transform in a later renderer, or rejected;
  routine reductions through one-eighth scale remain supported by the direct transform kernel.
- **Verdict:** **Needs-user.** The cap is isolated and reversible; replace it with a measured limit or a multistage affine path if
  real layer workflows need smaller direct scales.
- **Confidence:** Medium. The independent review caught the unbounded-work failure and the regression pins prompt rejection, but
  production image-size benchmarks should select the long-term limit.

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

### Slice 10c1 — Automatic layer names use stack-local English labels

- **When:** Slice 10c1 command integration, 2026-09-05.
- **The choice:** A new manual selection is named `Segment N`, where N is one more than the current stack size. Duplicating a layer
  appends ` copy`; if the source already occupies the 256-character name limit, its tail is shortened so the suffix remains visible.
  Names are presentation, not identity, so removing layers and adding another can produce duplicate display names while their UUIDs
  remain distinct. The alternatives were to expose UUID fragments as names, maintain a separate never-reused sequence, or require a
  name on every segment command.
- **The gap:** The plan required names to survive snapshots and allowed rename/duplicate, but did not specify automatic user-facing
  names or collision policy.
- **The reach:** CLI output and future layer panels display these labels by default; automation must address layers by stable ID,
  not assume a generated name is unique.
- **Verdict:** **Needs-user.** Keep the reversible labels because they are readable and require no new persistence. If the product
  wants localized or unique defaults, change the single naming policy before UI clients treat these strings as durable copy.
- **Confidence:** Low; this is product language rather than a technical invariant.

### Slice 08 — Selective color interpolates named bands in working-space hue

- **When:** Slice 08 selective-color closeout, 2026-09-05.
- **The choice:** The seven schema names are centers on the scene-linear Rec.2020 RGB hue wheel, with red wrapping at zero and
  smooth interpolation between neighboring centers. Achromatic pixels have no hue and remain unchanged. The alternative was a
  hard nearest-band selection or a second perceptual-color conversion outside the existing native owner.
- **The gap:** The schema fixes the band names and bounded controls, but not their hue coordinate or boundary behavior.
- **The reach:** Every selective-color recipe inherits continuous band transitions and working-space hue semantics.
- **Verdict:** **Sound.** It is deterministic, portable, continuous at every band boundary, and adds no render seam.
- **Confidence:** Medium; future reference-image evidence could justify a perceptual hue coordinate behind the same schema.

### Slice 08 — Selective color stays in the finishing sequence before vignette

- **When:** Slice 08 selective-color closeout, 2026-09-05.
- **The choice:** Selective color follows global and local corrections, then precedes vignette, B&W, named filters, and geometry.
  Its out-of-gamut target blends toward the original color at the same luminance rather than clipping channels or discarding
  chroma. The alternative was to append it after filters or introduce a separate gamut/resample stage.
- **The gap:** The plan requires one fixed native operator order and geometry last, but does not place selective color among the
  already implemented finishing operators or define safe working-gamut behavior.
- **The reach:** Mixed develop recipes, canonical hashes, layer stale-state behavior, and exported pixels inherit this ordering
  and gamut policy.
- **Verdict:** **Sound.** The choice retains the existing owner, exact luminance invariant, and continuous photographic output.
- **Confidence:** Medium; the first production probe exposed and corrected the naive clipping/desaturation alternatives.

### Slice 11a — An incomplete model release is represented, not counterfeited

- **When:** Slice 11a keyless runtime checkpoint, 2026-09-05.
- **The choice:** `fixtures/models.json` pins the real Hugging Face revision and the exporter-owned opsets, but carries
  `status:"awaiting_export"` and null artifact hashes until the pinned exporter actually produces the files. Fetch, Docker's
  opt-in `models` target, and `doctor --fetch-models` refuse that state. New libraries store `models_base_url:null`; old libraries
  with no row read identically. The alternative was to invent digests or a release URL merely to make setup appear complete.
- **The gap:** The slice names a David-hosted release that does not exist yet and supplies no exported bytes or hashes.
- **The reach:** Keyless development and deterministic runtime tests remain possible, while no machine can mistake test models or
  upstream PyTorch weights for the production ONNX release.
- **Verdict:** **Needs-user.** David must host the two exported files, populate the manifest by running the exporter, and set the
  library base URL before the live gate.
- **Confidence:** High.

### Slice 11a — SAM uses a centered rounded letterbox and strict-positive mask threshold

- **When:** Slice 11a coordinate/runtime implementation, 2026-09-05.
- **The choice:** Scale the longer edge to 1024, round the shorter edge to the nearest pixel, and split odd padding with the extra
  pixel on the bottom or right. Decoder samples map through that exact transform; bilinear logit values strictly greater than zero
  become mask value 1, while zero and negative values become 0. The CPU sessions use one intra-op and one inter-op thread so
  concurrent daemon work remains bounded; the encoder cache deduplicates promises by `(photo id, render tier)` and delegates actual
  eviction to the existing render/cache owner.
- **The gap:** The spec fixes the input size, interpolation, threshold, and cache identity but not padding alignment, rounding,
  equality at the threshold, or ONNX Runtime thread counts.
- **The reach:** Prompt coordinates, edge pixels, repeatability, and daemon CPU contention inherit these conventions.
- **Verdict:** **Needs-user.** These are isolated reversible policies; validate edge quality and timing with the real weights before
  treating them as release-tuned defaults.
- **Confidence:** Medium until the live G6 and visual gate run.

### Slice 11b — One text command commits all matched masks in one revision

- **When:** Slice 11b keyless command checkpoint, 2026-09-05.
- **The choice:** Suppose text grounding finds three people. The command first asks local segmentation for all three masks, then
  adds the three subject layers in one document revision. A revision is the catalog's atomic snapshot of an edit: either all three
  layers become active together, or none do. The alternative was three sequential revisions, which could leave only the first one
  or two people selected if a later mask or database write failed.
- **The gap:** The slice required one layer per instance but did not say whether a multi-instance command was one edit or several.
- **The reach:** Undo, render hashes, graph inspection, and later person-move operations see one coherent text-selection action.
- **Verdict:** **Sound.** It preserves the existing immutable-document owner and prevents partial multi-instance edits.
- **Confidence:** High.

### Slice 11b — Grounding fan-out is provisionally capped at 100 instances

- **When:** Slice 11b keyless command checkpoint, 2026-09-05.
- **The choice:** A structured model controls how many matching boxes it returns. The adapter accepts at most 100, so one crowded
  or malformed answer cannot launch unlimited local decoder work or create an unbounded layer snapshot. A legitimate empty answer
  remains a successful no-op. The alternative was no cap, letting an external response decide the command's CPU and catalog growth.
- **The gap:** The plan required every returned instance to become a layer but supplied no maximum result count.
- **The reach:** Text segmentation latency, maximum layers added by one command, and provider response validation inherit this
  bound. Raising or lowering the single adapter constant changes both its JSON request schema and response validator together.
- **Verdict:** **Needs-user.** Keep 100 as a reversible safety ceiling aligned with existing graph page bounds; tune it after real
  crowded-frame use if photographers need a different maximum.
- **Confidence:** Medium until tested on representative group photographs.

### Slice 11b — Dry runs and committed segmentation share one instance response

- **When:** Slice 11b keyless command checkpoint, 2026-09-05.
- **The choice:** Both modes return ordered instances with labels, base-coordinate mask bounds, and covered-pixel counts. A dry run
  carries null layer, artifact, revision, and render identities because it wrote nothing; a committed run fills those identities.
  The alternative was unrelated preview and commit shapes, forcing an agent to translate between two contracts before deciding
  whether to persist a selection.
- **The gap:** The spec required dry-run to create zero rows but did not define its JSON shape or how it relates to the commit result.
- **The reach:** CLI agents and future workbench clients can compare a previewed selection with the resulting persisted layers by
  instance order while still distinguishing non-mutating output explicitly.
- **Verdict:** **Sound.** One response vocabulary makes mutation state explicit without claiming an artifact exists before commit.
- **Confidence:** Medium; a later visual client may justify adding confidence/source fields without changing these identities.

### Slice 12b — Cached density artifacts are bound to one generation and selected deterministically

- **When:** Slice 12b density-planner implementation, 2026-09-05.
- **The choice:** A cached upscale names the generation artifact it came from. The planner rejects a cache entry from another
  generation instead of silently borrowing its pixels. When several cached artifacts all cover the requested width and height,
  it chooses the one with the fewest pixels, breaking an exact tie by artifact ID. For example, an unordered cache containing both
  a sufficient 2× result and a 4× result always reuses the 2× result; the alternative was to let database row order choose, which
  could change the plan between otherwise identical runs.
- **The gap:** The plan required reuse of a sufficient pre-resize artifact, but did not define how the planner proves lineage or
  resolves several sufficient cache hits.
- **The reach:** Refresh, retry, and later transform-driven density maintenance inherit a stable rule that cannot mix outputs from
  different external executions.
- **Verdict:** **Sound.** Explicit lineage protects image identity, while smallest-sufficient selection minimizes deterministic
  downsampling work without changing output-density truth.
- **Confidence:** High.

### Slice 12b — A provider with no valid output falls back to the usable generation

- **When:** Slice 12b density-planner implementation, 2026-09-05.
- **The choice:** Suppose every advertised upscale would exceed the provider's input-pixel, output-pixel, or edge limit. There is
  then no legal paid request to make, so the plan uses the already successful generation as its input, performs the one exact
  deterministic resize, reports `density_satisfied:false`, and emits `upscale_resolution_limited`. The alternative was to fail
  planning even though usable generated pixels already exist, or knowingly schedule a request outside the adapter contract.
- **The gap:** The plan said to use the largest valid provider output when limits stop short, but did not define the zero-valid-scale
  case.
- **The reach:** Tiny provider ceilings and oversized inputs remain soft density outcomes; generation stays the successful boundary
  for the later Slice 12c executor.
- **Verdict:** **Sound.** It preserves usable work and reports the sampling deficit honestly without inventing an invalid call.
- **Confidence:** High.

### Slice 12b — Fractional advertised scales must still land on whole pixels

- **When:** Slice 12b density-planner implementation, 2026-09-05.
- **The choice:** Supported scale factors may be fractional because the provider contract models them as numbers, but applying a
  factor must produce whole, safe pixel dimensions for both axes. A 1.5× scale is valid for a 1000×800 artifact and plans
  1500×1200; the same factor on dimensions that produce half pixels is rejected loudly. Restricting every adapter to integer
  factors was the unbuilt alternative.
- **The gap:** The plan required supported uniform scales and loud invalid-input handling without saying whether a scale itself had
  to be an integer or only its resulting raster dimensions did.
- **The reach:** Future adapters may advertise fractional native scales without making executor geometry ambiguous.
- **Verdict:** **Sound.** It follows the existing numeric provider seam while preserving the integer raster contract.
- **Confidence:** Medium; the current fake adapter advertises only integer scales, so the first fractional live adapter should
  confirm its rounding convention matches this exact-output rule.

### Slice 12c1 — Enablement records intent separately from whether execution can proceed

- **When:** Slice 12c1 keyless policy implementation, 2026-09-05.
- **The choice:** `enabled` answers whether policy requested upscaling, while `action` answers what the caller can do now. For
  example, default `auto` with an unavailable or unconfigured selected adapter returns `enabled:true`,
  `action:"preserve_generation"`, and `upscale_unconfigured`; an explicit `off` returns `enabled:false` with the same preserve
  action and no warning. The alternative was to collapse both situations into `enabled:false`, losing the difference between a
  user opting out and a requested service being unavailable.
- **The gap:** The result contract names both `enabled` and `executed`, but this pure pre-execution checkpoint needed a stable way
  to represent consent before any adapter call exists.
- **The reach:** Slice 12c2 can report and retry unavailable policy without guessing whether the user disabled upscaling, and UI or
  agent clients can explain why generated pixels were preserved.
- **Verdict:** **Sound.** Separating policy intent from executable action preserves both user choice and honest partial-success
  reporting.
- **Confidence:** Medium; the command response integration must keep `executed:false` distinct from both fields.

### Slice 12c2 — Retry recognizes one canonical fill branch, not arbitrary ancestry

- **When:** Slice 12c2 execution integration, 2026-09-05.
- **The choice:** Upscale retry and cached reuse inspect only the active layer's immediate canonical
  generate → optional upscale → Lanczos3 resample/place → zero-feather mask-composite branch. Exact generation execution identity is
  reusable when the instruction matches; an upscale cache additionally requires the current adapter/version, model, and guarded-prompt
  ID/version/text. A retry restores the composite's original base input rather than editing the already-composited layer.
- **The gap:** The plan required exact generation reuse after an upscale failure but did not define how broadly to search history or
  which output-recipe fields distinguish a Photoctl fill from a user-authored graph with the same rough topology.
- **The reach:** Retrying cannot reinterpret arbitrary generate ancestors, stack the same fill repeatedly, or reuse pixels produced by
  a stale adapter/prompt contract. A changed upscale contract can still reuse the paid generation and retry only the upscaler.
- **Verdict:** **Sound.** Narrow structural recognition preserves the successful paid boundary without introducing general ancestry
  rewriting ahead of Slice 12d.
- **Confidence:** High; focused negative tests reject changed instructions, noncanonical composite settings, and stale adapter versions.

### Slice 12c2 — `executed` describes the active graph path; execution records disclose reuse

- **When:** Slice 12c2 command response integration, 2026-09-05.
- **The choice:** `upscale.executed` is true whenever the committed fill graph uses an upscale node, including a matching cached node.
  The corresponding `executions[].reused` field distinguishes a cached pinned execution from a provider call made by this command.
- **The gap:** The response named `executed` but did not say whether it meant “called during this request” or “present in the resulting
  image path.”
- **The reach:** Clients can tell both what pixels the active result uses and whether the current request incurred external work without
  inferring either fact from node IDs.
- **Verdict:** **Sound.** Graph truth and request activity are separate facts and now have separate fields.
- **Confidence:** High.

### Slice 12d — Affine resample matrices map source edges forward into the base canvas

- **When:** Slice 12d affine-resample foundation, 2026-09-05.
- **The choice:** A resample matrix maps the intrinsic source raster forward into the oriented base canvas using pixel-edge
  coordinates. For example, `[1,0,0,1,8,6]` places the source's top-left edge at base position `(8,6)`, and
  `[2,0,0,2,8,6]` doubles its size around that same edge before placement. The native evaluator inverts this matrix only while
  sampling destination pixel centers. The alternative was to store the inverse destination-to-source transform or define
  translation around pixel centers, either of which would make graph recipes disagree with the existing layer-transform owner.
- **The gap:** The slice fixed the six affine values and source-to-base mapping but did not state whether stored matrices were
  forward or inverse, or whether their translations referred to pixel centers or raster edges.
- **The reach:** Refresh and transform-driven density maintenance can compose placement directly with the established native
  transform contract; quarter-turns remain exact, off-canvas pixels remain zero, and recipe hashes have one coordinate meaning.
- **Verdict:** **Sound.** It reuses the existing forward affine owner instead of introducing a second matrix convention at the
  graph boundary.
- **Confidence:** High.

### Slice 12d preview foundation — Reusing a valid preview artifact repairs its cache accounting

- **When:** Slice 12d preview-cache foundation, 2026-09-05.
- **The choice:** A display master is the full-frame JPEG from which smaller inspection views are cropped. When `show` finds that
  JPEG and its integrity sidecar valid, it reads it under the same path lease used by writers and cache pruning, then upserts its
  byte count and last-used time before deriving the overview. If a crash left the JPEG complete but its cache-index row missing,
  this read repairs the row. The alternative was only updating an existing row, which would leave that valid orphan invisible to
  storage accounting and eligible to survive outside the configured cache budget.
- **The gap:** The plan required validated reuse, prune safety, and post-access grace, but did not say whether reuse should repair a
  missing cache-index row left by an interrupted prior materialization.
- **The reach:** Every future consumer that reuses a preview artifact through the coordinator inherits one race-free validation and
  accounting boundary; cache pruning sees the bytes that `show` can actually return.
- **Verdict:** **Sound.** Repairing accounting from the already validated file restores the cache invariant without rendering or
  inventing a second source of pixel truth.
- **Confidence:** High.

### Slice 12d provider runtime — Runtime registry instances share one provider-owned roster

- **When:** Slice 12d provider-runtime foundation, 2026-09-05.
- **The choice:** When a fill command or the workbench needs to discover upscalers, it asks the provider package to create a fresh
  registry populated with the release roster. A registry is only an in-memory list of available adapters; it does not mean the
  user allowed any adapter to receive pixels. The command separately reads the library's persisted consent and calls the listed
  fake adapter only when its exact ID is marked configured. The unbuilt alternative was one mutable process-global registry,
  which would let test or future runtime registration leak between independent commands.
- **The gap:** The pass required one shared factory and continued registry injection, but did not specify whether the factory should
  return a process singleton or a new registry for each consumer.
- **The reach:** Fill and workbench cannot drift on which built-in adapters exist, while future callers and tests can still inject an
  isolated registry without mutating production discovery. A later live adapter joins this single provider-owned roster but still
  cannot bypass purpose-scoped consent.
- **Verdict:** **Sound.** A fresh lightweight registry keeps discovery deterministic and avoids hidden global mutation without
  weakening the separately persisted consent gate.
- **Confidence:** High.

### Slice 12d1 — A failed explicit upscale refresh preserves the active upscale

- **When:** Slice 12d1 refresh implementation, 2026-09-05.
- **The choice:** An upscale refresh starts from a branch that already has usable generated and upscaled pixels. If the new provider
  attempt fails or returns invalid pixels, the command keeps the previously pinned upscale as the active placement input and reports
  `upscale_failed`; it does not replace a sharper active result with the lower-density generation merely because a refresh attempt
  failed. The alternative was to make the older generation active, matching a first-time fill failure but degrading an image that was
  already complete before this request.
- **The gap:** The plan defined first-time upscale failure and later transform-rescale failure, but not failure while explicitly
  refreshing an already successful upscale.
- **The reach:** Refresh, retry, and later density maintenance share the rule that a failed attempt cannot discard a better usable paid
  artifact. Ordered execution records mark the retained provider result as reused, so the response does not imply that the failed call
  created those pixels.
- **Verdict:** **Sound.** Preserving the best valid pinned output follows the later transform-failure rule and avoids destructive
  quality regression while exposing the failure as a warning.
- **Confidence:** Medium; a future product decision could instead make explicit refresh failure hard, but that would change the
  established soft-success contract for usable generated pixels.

### Slice 12d1 review — Generation refresh refuses pre-fill transform geometry until affine rebasing exists

- **When:** Slice 12d1 independent review, 2026-09-05.
- **The choice:** A layer can be transformed before fill, making that transform part of the base pixels and mask coordinates sent to
  generation. Refreshing such a branch directly from the current untransformed document base would apply the stored crop and mask to
  the wrong location. This checkpoint detects that ancestry and refuses before calling the model or changing the revision. Transforms
  added after fill remain outside the paid branch and are rebuilt normally. The alternative was to silently produce misplaced pixels,
  or to implement affine crop/mask rebasing inside this bounded refresh pass.
- **The gap:** The refresh plan required generation to bind directly to the current develop root, while transform-driven branch
  reconstruction was assigned to the remaining 12d work; it did not define the safe interim behavior for transform-before-fill.
- **The reach:** The public command is conservative for one valid branch shape rather than corrupting coordinates. Slice 12d2 must
  replace this refusal by rebasing the stored transform, crop, and mask together before it can claim complete transformed ancestry.
- **Verdict:** **Sound as a bounded checkpoint.** Refusal is truthful and reversible, and it keeps affine geometry under one later
  owner instead of introducing a point implementation here.
- **Confidence:** High; the public regression proves no paid call and no revision, while the remaining limitation is named in 12d2.

### Slice 12d provider runtime — The fake image path is authorized by a safe local profile, not a gateway claim

- **When:** Slice 12d provider-runtime foundation, 2026-09-05.
- **The choice:** A keyless fill test names a reserved concrete image model. Photoctl maps that model locally to an
  instruction-and-composite adapter: it asks for replacement pixels without sending a native mask, then applies the resulting
  pixels through Photoctl's strict compositor, which copies every pixel outside the mask from the original input. Merely pointing
  the gateway URL at the fixture does nothing; the ordinary live model still stops before network I/O because its native-mask
  polarity has not been verified. The unbuilt alternative was to trust a fixture hostname, response header, or capability probe
  and let that remote claim bypass the native-mask gate.
- **The gap:** The slice said deterministic fake-gateway runs were unaffected by the live polarity gate, but it did not define how
  the built CLI distinguishes that fake without turning an arbitrary URL into authority.
- **The reach:** Functional and agent-journey tests can exercise the production CLI, HTTP transport, immutable execution
  provenance, and strict composite without pretending to prove a live provider's mask convention. A spoofed fixture response can
  still change only the region the fill operation authorized; aspect and reported whole-frame failures remain atomic.
- **Verdict:** **Sound.** Safety follows from not sending a native mask and from the local compositor, so it does not depend on a
  remote server honestly identifying itself.
- **Confidence:** High.

### Slice 12d workbench fill — Inspection may materialize deterministic nodes only from cached lineage

- **When:** Slice 12d workbench-fill checkpoint, 2026-09-05.
- **The choice:** When a human opens a fill report before the active layer composite has been rendered, the workbench may execute the
  graph's deterministic steps, such as exact resampling and strict mask compositing. A deterministic step always produces the same
  pixels from the same inputs. The source input is reconstructed by following the fill execution's exact input hashes back to its
  cached, content-hashed source artifact. Paid generate or upscale nodes can only load the exact output pinned in their immutable
  execution record. If that cache is missing,
  the report refuses. The unbuilt alternative was to reopen the original photo or construct provider clients, either of which would
  turn visual inspection into new external work and make an offline report depend on mutable inputs.
- **The gap:** The checkpoint required existing artifacts and prohibited provider execution, but did not say whether a report could
  materialize lazy deterministic descendants or must fail until another command had rendered them.
- **The reach:** Workbench inspection remains useful immediately after a lazy fill commit and while the original volume is offline,
  without creating a second external execution. It can add only reproducible canonical artifacts and execution rows already implied
  by the committed graph.
- **Verdict:** **Sound.** It preserves the DAG's lazy deterministic contract while making the provider boundary mechanically
  unreachable from the workbench.
- **Confidence:** High.

### Slice 12d workbench fill — Cyan marks the canonical mask edge without obscuring its texture

- **When:** Slice 12d workbench-fill checkpoint, 2026-09-05.
- **The choice:** The fourth comparison panel copies the current native-detail crop and changes only pixels on the inside edge of the
  stored mask to bright cyan. The other three panels remain untouched, so a reviewer can inspect real texture first and then use the
  cyan trace to find the exact seam. The unbuilt alternatives were a translucent filled overlay, which hides texture across the whole
  edited region, or no overlay, which makes an irregular boundary hard to locate.
- **The gap:** The plan required the same mask boundary before and after but did not choose its display color or overlay style.
- **The reach:** Every fill report uses one legible edge convention; changing the taste later affects only workbench presentation and
  never graph data or image artifacts.
- **Verdict:** **Needs-user.** The provisional cyan inside-edge trace is high contrast on typical photographs and reversible after the
  photographic screenshot gate if it distracts or disappears against real subjects.
- **Confidence:** Medium; this is a visual taste call that synthetic fixtures cannot settle.

### Slice 12d workbench fill — Refuse transformed branches until crop coordinates can follow them

- **When:** Slice 12d workbench-fill checkpoint, 2026-09-05.
- **The choice:** The report accepts a canonical fill whose active mask is still the strict composite's mask. If a later move, rotate,
  flip, or scale has transformed that mask, the report refuses instead of placing the old base-space crop and boundary over transformed
  current pixels. The unbuilt alternative was to show those mismatched coordinate spaces as though they were comparable.
- **The gap:** The checkpoint asked for one exact crop and boundary but transform-driven branch rebasing remains explicit 12d2 work.
- **The reach:** Reports stay trustworthy for the completed strict-fill checkpoint; transformed fills become reportable when 12d2 owns
  a canonical mapping for the crop, generated placement, current result, and mask.
- **Verdict:** **Sound.** A clear refusal preserves evidence integrity and matches the existing bounded transform refusal.
- **Confidence:** High.

### Slice 12d2 — Generation recipes retain later density intent

- **When:** Slice 12d2 transform-density implementation, 2026-09-05.
- **The choice:** Every new fill generation recipe stores whether automatic upscaling is enabled plus the exact adapter, model, and
  guarded-prompt identity, even when the first generated raster already has enough density and no upscale node is created. The
  alternative was inferring future policy from an optional active upscale child, which loses the user's intent on the no-call path.
  When an otherwise identical refill changes only this intent, a new immutable generation recipe pins the existing artifact and
  provider provenance; it does not call generation again.
- **The gap:** The earlier recipe recorded an upscale only after external execution; it did not preserve enough information to decide
  whether a later layer enlargement should call one.
- **The reach:** Later transforms can reevaluate density from pinned generation pixels without source access. Historical reuse remains
  strict to the current adapter version and stored model/prompt identity, so an adapter upgrade is paid at most once per sufficient
  direct child.
- **Verdict:** **Sound.** Durable intent belongs with the immutable generation recipe, while paid generation reuse remains governed
  by generation inputs rather than downstream upscale policy.
- **Confidence:** High.

### Slice 12d2 — One affine rebuild owns generated placement and mask alignment

- **When:** Slice 12d2 transform-density implementation, 2026-09-05.
- **The choice:** The shared fill branch descriptor reduces old and new ancestry to one intrinsic-generation placement and current
  layer matrix. One rebuilder composes those values into resample-v2 and applies the same current matrix to the permanent mask.
  Generation refresh reconstructs both base and mask in the original generation-input space before cropping. This supersedes 12d1's
  temporary transformed-input refusal.
- **The gap:** Transform, refresh, and pre-fill transform ancestry previously expressed geometry in different node shapes, so cloning
  recipes could silently pair pixels and masks from different coordinate spaces.
- **The reach:** Move, flip, quarter-turn, scale, refresh, and an intrinsic-size change now share one forward-matrix convention;
  strict composite alignment no longer depends on duplicating an ancestry parser at each command seam.
- **Verdict:** **Sound.** Geometry has one parser and one reconstruction owner, with paid nodes left as immutable pixel sources.
- **Confidence:** High.

### Slice 12d2 — Failed density growth preserves the best valid external artifact

- **When:** Slice 12d2 transform-density implementation, 2026-09-05.
- **The choice:** A transform that needs a larger upscale always calls from the original pinned generation. If that call fails, the
  transform still commits using the largest valid matching direct upscale child, or the generation when none exists, and reports
  `density_satisfied:false` with `upscale_failed`. No node or execution represents the failed attempt.
- **The gap:** The plan required soft failure after usable generated pixels exist, but did not spell out which historical raster wins
  when several insufficient candidates remain.
- **The reach:** Repeated transforms never compound pixels through upscale/resample/composite ancestry, never discard a sharper prior
  paid result, and remain usable offline when provider consent or availability disappears.
- **Verdict:** **Sound.** The rule maximizes usable density while preserving lineage and atomic graph truth.
- **Confidence:** High.

### Slice 13a — Reimagine and fill share one external generation-and-density owner

- **When:** Slice 13a keyless reimagine implementation, 2026-09-05.
- **The choice:** The fill pipeline and full-frame reimagine projection call the same generation publication, provenance, density
  planning, upscale execution, and fallback owner. Reimagine owns only its full-frame request shape and layer projection.
- **The gap:** Slice 13 required reusing Slice 12's DAG planner, while the first implementation draft copied that planner into a
  second module. Keeping the copies would let provider and failure semantics drift.
- **The reach:** Fill and reimagine now agree on successful partial generation, explicit upscaler consent, exact final resampling,
  execution records, and warnings. Later relight can use the same bounded owner without cloning it again.
- **Verdict:** **Sound.** The shared unit follows the paid external boundary; command-specific layer geometry remains outside it.
- **Confidence:** High.

### Slice 13a — Strength is provider guidance plus exact whole-frame blend coverage

- **When:** Slice 13a keyless reimagine implementation, 2026-09-05.
- **The choice:** `--strength` is bounded to `0..1` and defaults to `1`. A versioned prompt tells the provider how much source
  composition and identity to preserve, while a permanent constant mask applies the same value as exact whole-frame composite
  coverage. The alternative was a decorative flag that only changed an irrelevant feather parameter on an all-ones mask.
- **The gap:** The gateway image adapter has no portable native strength control, but the public option still needs deterministic
  pixel semantics independent of whether a provider follows prose perfectly.
- **The reach:** Provider requests, graph identity, and rendered pixels all record the user's strength. A future adapter-native
  control requires a prompt-recipe version change but cannot silently remove the compositor guarantee.
- **Verdict:** **Sound.** Provider guidance influences generation; the graph-owned blend makes the public contract observable.
- **Confidence:** High.

### Slice 13a — Reimagine uses the edit model and non-authoritative progress

- **When:** Slice 13a keyless reimagine implementation, 2026-09-05.
- **The choice:** Full-frame reimagine resolves the library's `models.edit` purpose because it sends source pixels through the image
  edit endpoint; `models.generate` remains for standalone generation. During its potentially long generation/upscale sequence it
  emits five-second progress heartbeats, but progress delivery is best-effort and cannot turn an already committed revision into a
  reported command failure.
- **The gap:** Using the standalone generation setting could select a model without image-edit support. Without heartbeats, the
  daemon client's idle timeout could retry a still-running paid mutation; treating the advisory frame as authoritative after commit
  creates the inverse failure.
- **The reach:** Model selection matches the request shape, and healthy daemon connections remain alive without making telemetry
  part of revision atomicity.
- **Verdict:** **Sound.** Provider work and the graph commit remain authoritative; progress only describes them.
- **Confidence:** High.

### Slice 13a — Require a dimension-retaining current base before provider work

- **When:** Slice 13a keyless reimagine implementation, 2026-09-05.
- **The choice:** Reimagine accepts a full oriented source and dimension-preserving develop roots. If geometry changes the frame, it
  returns a usage error before any provider call or document revision. A smaller pinned source fallback is also refused because the
  generated base-size layer would not match the active base raster. It does not guess a transform into the current composite.
- **The gap:** Catalog dimensions describe the oriented base, while a cropped/rotated develop node renders another frame. The layer
  model does not yet retain a durable mapping that would place a full-frame generated result back into that changed frame honestly.
- **The reach:** Current keyless reimagine is safe and predictable; supporting developed geometry or offline low-resolution bases
  later requires one explicit current-frame dimension/mapping contract rather than a reimagine-only workaround.
- **Verdict:** **Sound but intentionally narrow.** A pre-provider refusal preserves atomicity and avoids corrupt composites.
- **Confidence:** High.

### Slice 13d — Public repair extent and native reconstruction neighborhood remain separate

- **When:** Slice 13d keyless retouch implementation, 2026-09-05.
- **The choice:** `radius` always describes the permanent circular repair mask. With `--norm`, an explicit radius is a fraction of
  the oriented long edge, just like the default two-percent extent. Resolved pixel geometry is canonicalized to nine decimal places
  so an equivalent normalized and absolute retry has one identity. The versioned heal recipe separately records a fixed three-pixel
  neighborhood, 512-iteration ceiling, and eight-million masked-pixel update budget for the project-owned deterministic
  fast-marching fill with harmonic refinement. The recipe names that method directly rather than
  claiming canonical Telea behavior.
- **The gap:** The plan named Telea and a public target radius but did not define whether the same number controlled the inpaint
  sampler, nor how normalized radius should scale. Coupling the values would make a larger selected defect silently change the
  algorithm instead of only changing its extent.
- **The reach:** Retouch identity, exact retry reuse, and mask composition remain stable if a later recipe version replaces or tunes
  the native reconstruction algorithm. Normalized retouch geometry also stays independent of portrait/landscape orientation.
- **Verdict:** **Sound.** One value belongs to the user-visible edit; the other belongs to a reproducible pixel recipe.
- **Confidence:** High.

### Slice 13b — Preview statistics have one explicit transfer-space and quantile convention

- **When:** Slice 13b auto-enhance implementation, 2026-09-05.
- **The choice:** Preview bytes are treated as encoded sRGB. Rec.709 luminance and the gray-world RGB mean are computed after the
  sRGB transfer function is decoded to linear light; the mean is converted through the standard sRGB-to-XYZ matrix and McCamy's
  correlated-color-temperature estimator. Saturation remains encoded-sRGB HSV saturation. Percentiles use type-7 linear
  interpolation, and clipping counts exact black and white luminance endpoints. The alternative was to leave transfer space and
  boundary quantiles implicit, making the same pixels produce implementation-dependent prompt data.
- **The gap:** C4 named the statistics but did not define their transfer space, quantile convention, saturation model, or the
  temperature estimator.
- **The reach:** The seven-field C4 input is deterministic across future implementations. Neutral gray estimates the D65 neighborhood
  at 6504 K through the named estimator, while a chroma-free black frame uses D65 as the defined fallback.
- **Verdict:** **Sound.** The conventions are standard, deterministic, and pinned by a deliberately non-boundary percentile fixture.
- **Confidence:** High.

### Slice 13b — The C4 proposal contract owns narrower ranges before ordinary develop mutation

- **When:** Slice 13b auto-enhance implementation, 2026-09-05.
- **The choice:** A versioned strict structured schema accepts a non-empty subset of the eight C4 adjustment paths. Provider numbers
  are clamped by the C4 range table—most notably exposure to `[-2,2]`—and serialized as one ordinary develop `--set` batch. The
  alternative was to inherit the wider manual develop ranges or duplicate develop parsing and graph mutation inside auto-enhance.
- **The gap:** The slice required clamping but did not name the owner or say whether a provider must return every adjustment.
- **The reach:** Prompt wording, JSON schema, and clamping share one provider-owned contract while all final type/range validation,
  graph changes, layer compensation, and staleness remain under the existing develop owner.
- **Verdict:** **Sound.** Partial conservative proposals are useful, and the narrower automated policy cannot widen manual editing.
- **Confidence:** High.

### Slice 13b — Undo is a versioned active-revision transition, including no-op proposals

- **When:** Slice 13b auto-enhance implementation and independent review, 2026-09-05.
- **The choice:** Auto-enhance writes a versioned operation discriminator, `develop_before_auto`, and structured execution provenance
  in generic revision metadata in the same transaction as its immutable revision. `--undo-auto` accepts only that active
  discriminated revision and always creates a new revision without the marker, even when the restored dictionary is byte-for-byte
  identical. A later manual edit therefore makes the older marker ineligible. The alternative was a mutable photo-level snapshot,
  which could erase newer edits, or a no-op shortcut that left undo repeatable forever.
- **The gap:** The slice required storing and restoring `develop_before_auto` but did not define marker identity, lifetime, or no-op
  consumption.
- **The reach:** Provider/schema failures leave the active pointer unchanged; successful no-op proposals remain auditable; one undo
  consumes exactly one active automatic edit without affecting historical provenance.
- **Verdict:** **Sound.** The behavior follows the existing immutable revision and compare-and-swap ownership model.
- **Confidence:** High.

### Slice 13b — Model input reuses the current preview owner and records available execution identity

- **When:** Slice 13b auto-enhance implementation and independent review, 2026-09-05.
- **The choice:** Auto-enhance obtains its 1024-pixel-long-edge JPEG through the existing `show` preview path and threads the shared
  preview coordinator so concurrent requests join the same materialization. The revision records adapter id/version, fixed model,
  provider request id, attempt count, prompt version, dimensions, and exact stats. It does not invent cost or duration fields the
  structured adapter does not return. The alternative was a second render path or misleading placeholder provenance.
- **The gap:** The slice named current/lazy rendering and provider provenance but did not define the internal preview seam or fields
  unavailable from the structured adapter.
- **The reach:** Existing current-source fallback, graph evaluation, cache identity, and daemon single-flight semantics apply unchanged;
  later adapter telemetry can extend the versioned metadata contract without changing develop mutation.
- **Verdict:** **Sound.** One preview owner avoids semantic drift, and recorded provenance stays truthful to the available boundary.
- **Confidence:** Medium; the structured adapter may later grow shared duration and cost telemetry.

### Slice 13a relight — Lighting intensity is both C3 guidance and exact blend coverage

- **When:** Slice 13a keyless relight implementation, 2026-09-05.
- **The choice:** `--intensity` is bounded to `0..1`, appears literally in the versioned C3 provider instruction, and also becomes
  the permanent full-frame mask coverage used by the compositor. At zero, photoctl still records the requested provider operation
  as a removable layer but renders the current pixels exactly; at one, the generated lighting result has full coverage. The
  alternative was to make intensity prompt-only, leaving rendered strength entirely to a provider's interpretation.
- **The gap:** C3 described light intensity “of 1” but did not define a provider-independent pixel meaning. The first deterministic
  full-coverage fixture also showed why an opaque provider result is not useful evidence by itself: it replaced the entire frame
  with the fake model output instead of expressing a controllable lighting change.
- **The reach:** Reimagine strength and relight intensity now share one observable guidance-plus-blend rule in the full-frame owner.
  Future live providers may interpret C3 differently, but they cannot silently remove the graph-owned intensity effect.
- **Verdict:** **Sound.** One user control affects both nondeterministic guidance and deterministic composition, matching the
  established reimagine contract.
- **Confidence:** High.

### Slice 13a relight — Public lighting controls use physical domains and a shared response shape

- **When:** Slice 13a keyless relight implementation, 2026-09-05.
- **The choice:** The command requires all three controls, accepts azimuth from 0 through 360 degrees, elevation from -90 through
  90 degrees, and intensity from 0 through 1, and rejects non-finite or out-of-range values before opening a provider request. Its
  response reuses the reimagine generation, source-density, upscale, execution, layer, revision, and render fields, replacing only
  reimagine's `strength` field with flat `azimuth`, `elevation`, and `intensity` values. The alternative was an unbounded numeric
  surface or a second near-copy of the provider response contract.
- **The gap:** The original command spelling named the controls but not their allowed domains or response schema.
- **The reach:** Agents receive the exact accepted lighting request alongside the same provenance and density facts as reimagine;
  later prompt versions can change wording without changing the public units or duplicating the full-frame result schema.
- **Verdict:** **Sound.** The angle ranges cover a full horizontal turn and all vertical light directions, while the normalized
  intensity matches C3's documented “of 1” language.
- **Confidence:** Medium; azimuth 0 and 360 are equivalent but both remain accepted for direct physical input.
