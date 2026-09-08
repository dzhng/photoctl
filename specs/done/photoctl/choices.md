# Implementation choices

This is photoctl's decision ledger: every material choice an implementing agent
made on the user's behalf that the spec did not already settle, written so it
can be judged without reading the code, the diff or any session transcript.

Entries are grouped by verdict and, inside each group, least-confident first.
**Needs-user** entries are decisions only the user can make; each one records a
reversible provisional call so nothing is blocked waiting for an answer.
**Unsound** entries, if present, name decisions still requiring correction. **Sound**
entries are the architecture the user now owns — they are not skippable.

Evidence, test counts, run chronology and pass/fail narration deliberately do
not live here; they live in the linked review assets. The mapping from the
previous ledger's headings into these entries is
[`assets/choices-consolidation-review.md`](assets/choices-consolidation-review.md).

**Review these first — the three least-confident choices overall:**

1. **U2 — The release-default upscaler is a deterministic fake.** A stock install
   has no configured live upscaling adapter, so `auto` density work cannot
   execute on a stock install.
2. **U3 — Unfilled canvas is opaque black plus a warning.** Predictable and
   cheap, and possibly the wrong thing to hand a photographer in an export.
3. **U4 — The vacancy placeholder colour is full scene-linear magenta.** A
   conspicuous "unfinished" signal that may alarm a photographer in a preview.

---

## Needs-user — decide

These entries expose product tradeoffs with reversible recommendations. They do
not grant approval, change acceptance requirements or make every preference a
release blocker. The spec's remaining requirements retain their own status.

### U2 — The release-default upscaler is a deterministic fake

- **When:** Slice 09a fixed-model table; unchanged since.
- **The choice:** An upscaler here is a purpose-built external service that
  synthesizes extra pixels — distinct from the general image gateway, and
  reached through its own `UpscaleAdapter` boundary. With no library override,
  the upscale purpose resolves to `photoctl/fake-upscale-v1`, the only adapter
  in the release roster. It is deterministic fixture behavior, and it still
  requires explicit per-model consent, so `auto` density work on a stock install
  reports `upscale_unconfigured` and preserves the generated pixels rather than
  silently synthesizing anything. There is no registered live upscaling service.
  Explicitly configuring the fake can run fixture behavior; that is not
  photographic upscaling support.
- **The gap:** The slice required a fixed release default and a complete fake
  contract while explicitly leaving the first live adapter, its model and its
  creativity/resemblance values to a later spike that has never had configured
  credentials.
- **The reach:** Model selection, `doctor`, settings and cost reporting all have
  a concrete non-magical identifier to name today. Any downstream code that
  mistook the fake for a shippable model would expose fixture pixels as product
  output.
- **Verdict:** **Needs-user.** Provisional call: keep the fake as the placeholder
  release default. Reverse by registering an evidenced live adapter and changing
  one entry in the release model table.
- **Confidence:** Low by design — only live visual and cost evidence can pick a
  real default.
- **Owner:** `packages/providers/src/table.ts`,
  `packages/providers/src/upscale/{adapter,registry,fake,runtime}.ts`.

### U3 — Unfilled canvas is opaque black with a structural warning, and viewports survive support removal

- **When:** Outpaint viewport and lifecycle checkpoints, 2026-09-06; implemented.
- **The choice:** Three linked rules govern what a picture looks like where no
  pixels exist. (1) Crop into an added border at `[-20,100,60,80]`, then remove
  every border: the view keeps its 60×80 size and its position, the 20 columns
  that the border used to supply become opaque scene-linear black, and `show`
  and `export` report `canvas_uncovered`. Even a fully unsupported crop keeps
  its dimensions. (2) Add an outer border B around a picture that already has
  border A, then remove A: B stays where it was authored, the area A supplied
  goes black and warns, and the renderer neither moves B nor buys replacement
  pixels. (3) "Uncovered" means *structural* support, not visible colour: fading
  a border to zero opacity does not warn, while moving or removing support does
  warn even when an ordinary painted layer happens to cover the hole. The
  immutable output plan records whether the final viewport lacks
  original-admissible or enabled-border support, and `show`/`export` read that
  snapped plan before any cached preview can bypass rendering. The alternatives
  were clipping the crop back to available pixels (which silently rewrites the
  photographer's later editing intent, and leaves nothing defined when the
  intersection is empty), or detecting black RGB (which cannot tell a deliberate
  black subject from a hole).
- **The gap:** Source-only crop validation could not represent a viewport that
  was valid when it was authored and lost its support afterwards, and an opaque
  image format needs a deliberate policy for holes — zero-initialized memory is
  not a product decision.
- **The reach:** Extent and visible colour are permanently distinct concepts in
  the output planner. Original bytes and paid border artifacts are unchanged
  either way, and re-enabling a border restores the picture with no provider
  work. Changing the product meaning of the warning later means rederiving
  warning identity from the plan, not inspecting pixels.
- **Verdict:** **Needs-user.** Provisional call: keep black plus the warning and
  keep viewport retention. Both avoid automatic paid regeneration and preserve
  absolute editing intent; both reverse as planner policy without a schema
  change or any rewrite of stored geometry.
- **Confidence:** Low — predictable geometry competes directly with the visual
  inconvenience of black areas in a delivered file.
- **Owner:** `packages/render/src/graph/{canvas,canvas-support}.ts`,
  `packages/protocol/src/envelope.ts`.

### U4 — The vacancy placeholder colour is full scene-linear magenta

- **When:** Slice 10c2 vacancy rendering.
- **The choice:** Move a person out of a frame and the hole they left is filled
  by a constant-colour node storing exactly `rgb:[1,0,1]` in the scene-linear
  working space at full white level — a deliberately unmistakable saturated
  magenta, so an unfilled hole cannot be mistaken for a plausible black shadow.
  It is replaced later by provider-backed fill content. The alternatives were a
  display-referred magenta converted into the working space, or a less saturated
  checkerboard.
- **The gap:** The plan said "magenta" but defined neither the exact samples, the
  working-space interpretation, nor the visual intensity.
- **The reach:** Recipe hashes, exported images that still contain a warning
  placeholder, screenshots and any future colour-picker representation inherit
  these exact values until the single node parameter changes in a replacement
  revision — and changing it affects only newly created vacancies.
- **Verdict:** **Needs-user.** Provisional call: keep the conspicuous magenta as
  an "unfinished" signal. Reversible, since it is one recipe parameter.
- **Confidence:** Low — deterministic and conspicuous, but a photographer may
  find it alarming in a delivered preview, and the blocked workbench screenshot
  gate could not validate its visual character in this environment.
- **Owner:** `packages/render/src/layers/operations.ts`.

### U5 — Graph inspection uses provisional response bounds

- **When:** Slice 08a2 graph inspection.
- **The choice:** `graph show` returns at most 100 nodes per page (50 by
  default) and at most 32 ordered inputs in a node summary; `graph node`
  includes at most 64 inputs, consumers and executions plus 64 KiB of parameter
  JSON, always reporting exact counts and explicit truncation flags. A very wide
  composite or a heavily reused node therefore needs follow-up tooling to see
  every record, while ordinary lineage pagination stays complete.
- **The gap:** The contract required bounded records and pagination but set no
  product-facing numbers.
- **The reach:** These bounds keep any single response far below the daemon's
  16 MiB frame ceiling, which never grows to accommodate history.
- **Verdict:** **Needs-user.** Provisional call: keep 32/64/100. Reversible —
  they are isolated constants, and representative large edited libraries should
  decide the usability/performance tradeoff before release.
- **Confidence:** Low until measured on a real edited library.
- **Owner:** `packages/render/src/graph/inspection.ts`.

### U6 — `export --on-collision skip` is a successful no-write result carrying the attempted state

- **When:** Slice 05 export protocol.
- **The choice:** `client.jpg` already exists and the caller asked to skip. The
  item returns success with `skipped:true`, the existing file's dimensions and
  byte count, and the render hash — a fingerprint of the edit state — that *this
  command* snapshotted. That hash identifies what the command would have
  written; it is not proof that the pre-existing file contains those pixels. No
  export-history row is inserted, because this invocation wrote nothing. The
  alternatives were reporting skip as a failure, omitting the required hash, or
  adding a second nullable provenance field that existing files cannot supply.
- **The gap:** The plan defined the skip policy and required a render hash on
  every successful item, but not whether skipping is success, nor what the hash
  means when no artifact was created.
- **The reach:** Scripts can distinguish completed writes from harmless skips and
  keep batch retries idempotent; they must not read a skipped item's hash as
  verified provenance for the file already on disk.
- **Verdict:** **Needs-user.** Provisional call: keep it. Change the protocol
  before release if `render_hash` must always certify bytes rather than identify
  the attempted state.
- **Confidence:** Low.
- **Owner:** `packages/render/src/export/run.ts`,
  `packages/commands/src/handlers/export.ts`.

### U8 — An ambiguous photo prefix reuses `not_found` with an explicit reason

- **When:** Slice 01b library pass.
- **The choice:** Two photo IDs begin with `0199a7c2`. `photoctl show 0199a7c2`
  must not silently pick whichever row sorts first, so the library refuses with
  the existing data-error code `not_found` plus `reason:"ambiguous"`; a longer
  prefix then resolves normally. The clearer alternative — adding an
  `ambiguous_id` member — expands a public error-code union the plan declared
  closed, without the plan ever naming that code.
- **The gap:** The plan requires unambiguous prefixes but defines neither the
  ambiguous response nor a dedicated code.
- **The reach:** Every verb that accepts a photo ID exposes this shape, so
  scripts may branch on the code plus reason rather than the code alone.
- **Verdict:** **Needs-user.** Provisional call: keep the closed code list and
  exit 65. Add `ambiguous_id` before release if callers should distinguish
  ambiguity at the top-level code.
- **Confidence:** Low.
- **Owner:** `packages/library/src/locators.ts`.

### U9 — Tag input is trimmed at its boundaries and otherwise preserved exactly

- **When:** Slice 02 integration review.
- **The choice:** `tag <id> --add "  Ceremony  "` stores `Ceremony`: surrounding
  whitespace is removed, a whitespace-only tag is rejected, and case plus
  Unicode spelling are preserved exactly. Repeating the padded or unpadded form
  is the same idempotent request. The alternatives were preserving invisible
  accidental differences, or imposing case folding and Unicode normalization
  before the product's search and XMP behavior have been exercised.
- **The gap:** The plan required exact idempotent tag values but did not define
  user-input normalization.
- **The reach:** Cull filters, the XMP keyword union, the search index and human
  tables all inherit tag identity from this one command boundary.
- **Verdict:** **Needs-user.** Provisional call: trim boundaries only. Change
  the single command boundary before release if tags should be case-insensitive
  or Unicode-normalized.
- **Confidence:** Low.
- **Owner:** `packages/commands/src/handlers/tag.ts`.

### U10 — Automatic layer names are stack-local English labels

- **When:** Slice 10c1 command integration.
- **The choice:** A new manual selection is named `Segment N`, where N is one
  more than the current stack size; duplicating a layer appends ` copy`, and if
  the source already fills the 256-character name limit its tail is shortened so
  the suffix stays visible. Names are presentation, not identity: removing
  layers and adding another can produce two layers displaying the same name
  while their UUIDs stay distinct. The alternatives were exposing UUID fragments
  as names, maintaining a never-reused sequence, or requiring a name on every
  segment command.
- **The gap:** The plan required names to survive snapshots and allowed
  rename/duplicate, but specified neither automatic names nor a collision policy.
- **The reach:** CLI output and any future layer panel display these labels by
  default; automation must address layers by stable ID and must not assume a
  generated name is unique.
- **Verdict:** **Needs-user.** Provisional call: keep the labels. If the product
  wants localized or guaranteed-unique defaults, change the one naming policy
  before UI clients treat these strings as durable copy.
- **Confidence:** Low — this is product language, not a technical invariant.
- **Owner:** `packages/render/src/layers/operations.ts`.

### U11 — The workbench fill report traces the mask edge in cyan

- **When:** Slice 12d workbench-fill checkpoint.
- **The choice:** The fourth comparison panel of the developer fill report
  copies the current native-detail crop and recolours only the pixels on the
  inside edge of the stored mask to bright cyan; the other three panels are
  untouched, so a reviewer inspects real texture first and then uses the trace
  to find the exact seam. The alternatives were a translucent filled overlay,
  which hides texture across the whole edited region, or no overlay at all,
  which makes an irregular boundary hard to locate.
- **The gap:** The checkpoint required the same mask boundary before and after
  but chose neither display colour nor overlay style.
- **The reach:** Every fill report uses one legible edge convention; changing the
  taste later affects only the developer report, never graph data or image
  artifacts.
- **Verdict:** **Needs-user.** Provisional call: keep the cyan inside-edge trace;
  reverse it after the photographic review if it distracts or disappears against
  real subjects.
- **Confidence:** Low — a visual taste call that synthetic fixtures cannot settle.
- **Owner:** `apps/workbench/`.

### U17 — Mask morphology is a square footprint and feather is three box passes

- **When:** Slice 10b2 mask-kernel implementation.
- **The choice:** Growing or shrinking a mask (dilation and erosion) uses a
  zero-padded *square* footprint, implemented as separable sliding-window passes;
  feathering approximates a Gaussian blur with three zero-padded separable box
  passes. Both reject radii above 4,096 pixels. In practice a one-pixel dilation
  therefore squares off corners, and coverage at the image edge fades against
  transparent space rather than being extended.
- **The gap:** The plan named morphology and feather operations but chose neither
  circular versus square morphology, an exact Gaussian definition, edge
  treatment, nor a maximum radius.
- **The reach:** Later manual and model-produced masks inherit this silhouette
  feel; extremely large selections fail validation instead of occupying a native
  worker indefinitely.
- **Verdict:** **Needs-user.** Provisional call: keep the square footprint and
  three-pass feather. Footprint and feather character are visible product
  choices that should be revisited against real photographic masks; a disc
  footprint or true Gaussian changes only newly created artifacts.
- **Confidence:** Medium for the bounded algorithm; low for the preferred visual
  character.
- **Owner:** `packages/render/src/mask-kernels.ts`,
  `crates/photoctl-image/src/mask.rs`.

### U12 — Canvas growth has source-size-aware raster ceilings

- **When:** 12f2 deterministic core maintenance checkpoint.
- **The choice:** A 32-megapixel source may legitimately ask for a 60-megapixel
  exterior view after outpainting, but a billion-pixel crop must be rejected
  before any allocation. The render frame owner allows at most 64,000,000 pixels
  and 16,384 per edge, and raises each ceiling to the catalog source size when
  that is larger — so a 100-megapixel original can still be cropped, reset and
  rotated at its own size. Provider work must additionally satisfy its own
  adapter limits. **These are not the only 64-megapixel numbers in the tree, and
  they are not the same contract:** the fake upscaler advertises 64 MP as its
  capability, `generate --size` refuses larger standalone rasters, and the markup
  text rasterizer bounds its own allocation. Each has a different owner and a
  different reason to change; they coincide numerically today and must not be
  collapsed into one shared constant on that basis.
- **The gap:** Canvas growth needed a render-side safety policy independent of
  any provider's capability.
- **The reach:** This is a growth limit, not a memory guarantee, not stored
  checkpoint policy, and not a user setting. Raising it later does not rewrite
  authored geometry.
- **Verdict:** **Needs-user.** Provisional call: keep the ceiling. Representative
  hardware evidence or a different product limit replaces it without a schema
  change.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/graph/frame.ts` (canvas growth only).

### U13 — Outpaint expands the currently visible picture, symmetrically, onto an exact integer raster

- **When:** Outpaint planning checkpoint, 2026-09-06; implemented.
- **The choice:** After cropping and straightening a photo, `fill --outpaint
  --px 100` adds 100 pixels around the picture *currently visible* — it does not
  restore the source content the crop excluded. An aspect request uses the
  smallest containing integer raster with the exact requested ratio, so a 10×7
  picture expanded to 3:2 becomes 12×8. Growth is split between opposite edges,
  and an odd pixel goes right or bottom so existing pixels never move by half a
  pixel. Requesting the aspect the picture already has does nothing and makes no
  paid request. The alternatives were expanding the uncropped original,
  anchoring growth at the top-left, or resampling to obtain perfect symmetry. A
  one-axis ceiling was rejected because repeated identical requests would
  alternately grow width and height; exact-ratio integer dimensions make the
  second request a no-op.
- **The gap:** The original outpaint requirement chose neither the expansion
  frame, nor the anchor, nor the rounding.
- **The reach:** These determine output dimensions and the meaning of repeated
  expansion. Original-base coordinates and source dimensions are unchanged; the
  graph represents visible extent rather than asking callers to reinterpret
  stored positions.
- **Verdict:** **Needs-user.** Provisional call: expand the current visible
  picture with integer centered placement. A different answer changes the
  planner before new canvas authoring, not existing photo records.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/fill/outpaint.ts`,
  `packages/render/src/graph/canvas.ts`.

### U14 — Authored crop boundaries belong to the borders that are enabled, not to the source

- **When:** Outpaint lifecycle planning, 2026-09-06; implemented.
- **The choice:** Crop a picture, add border A, crop it further, then add border
  B. Each enabled border retains the visible frame it was authored around.
  Clearing a later viewing crop reveals that authored canvas — not the content
  that was excluded before the border existed. Removing B withdraws B's
  boundary; removing every border lets ordinary develop controls operate on the
  original again. A later border inherits earlier exclusions rather than merely
  its input rectangle: if its interior contains an earlier generated strip,
  removing that strip cannot reveal hidden original pixels while the later
  boundary survives. Reordering layers changes paint order, never authoring
  chronology.
- **The gap:** The plan did not distinguish cropping performed before a border
  was authored from viewing changes made afterwards.
- **The reach:** Immutable graph intent encodes those authored frames without a
  second mutable geometry table and without permanently discarding source
  pixels. This is what makes generated borders reproducible and removable.
- **Verdict:** **Needs-user.** Provisional call: retain visible-input boundaries
  only while their owning borders are enabled. A different product preference
  must say explicitly what happens to already-authored boundaries; original
  source data is untouched either way.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/graph/{canvas,geometry-intent}.ts`,
  [layer-state review](assets/outpaint-state-review.md).

### U15 — Moving a border moves the border, not the photograph

- **When:** Outpaint lifecycle recon, 2026-09-06; implemented.
- **The choice:** Moving an outpaint layer moves its generated pixels, its edit
  mask and its extent together. The source area that was excluded when the
  border was authored stays excluded while its boundary is active; other borders
  keep their own authored positions. Reordering changes paint order only, and
  duplicating creates another copy at the same footprint rather than another
  canvas expansion. Holes produced by the move follow the black-plus-warning
  policy above rather than triggering generation.
- **The gap:** Ordinary layer operations were required, but their effect on
  authored canvas extent was unspecified.
- **The reach:** Border transforms remain local paint edits, unlike develop
  rotation which turns the whole picture. A whole-canvas transform would be a
  separate product operation, never an implicit side effect of moving a layer.
- **Verdict:** **Needs-user.** Provisional call: preserve the existing meaning of
  layer transforms as local operations. A different preference must preserve the
  meaning of already-authored layer placement.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/layers/operations.ts`,
  `packages/render/src/fill/outpaint.ts`.

### U16 — Fill edge softness is measured in absolute base pixels, from magnitudes nobody chose

- **When:** Fill fitting, slices 12e1–12f; current code.
- **The choice:** `--fit` chooses how a selection becomes the coverage the fill
  actually paints: `strict` thresholds at half coverage, `expand=N` thresholds
  then dilates by N base pixels, `free` keeps fractional selection coverage.
  `--strength` is a feather — a soft edge — and *not* provider denoising. Its
  mapping is `feather_px = round(strength × 64)`, applied after that mode's
  threshold and expansion, in **every** mode: `--fit strict --strength 0.5`
  really does produce a 32-pixel soft edge. The defaults are likewise invented
  magnitudes: `--remove` defaults to `strict`; a prompted fill defaults to
  `expand=24`; `free` with no explicit strength feathers 24 pixels. Because the
  scale is absolute base pixels rather than a fraction of the long edge (unlike
  retouch's radius), the same `--strength 0.5` covers a much larger fraction of
  a small JPEG than of a 33-megapixel RAW. Expansion is separately bounded to
  4,096 base pixels.
- **The gap:** The plan named hard/expanded/free fits and the half-coverage
  threshold; it never chose the feather scale, the two 24-pixel defaults, or
  whether feathering belongs to one mode.
- **The reach:** Every judgement about fill edge quality is made against these
  numbers, and they are recipe parameters — changing them changes the fill
  recipe hash, so new fills differ while existing ones keep their identity and
  cached pixels. Exterior protection never depends on them: every sample outside
  the deterministic effective mask is copied from the base by the strict
  compositor regardless of fit mode.
- **Verdict:** **Needs-user.** Provisional call: keep the current constants; this
  is photographic taste that synthetic fixtures cannot settle. Reverse by
  bumping the recipe version, which changes new fills without rewriting history.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/fill/fit.ts`,
  `packages/render/src/mask-operations.ts`,
  `packages/commands/src/handlers/fill.ts`.

### U18 — Extreme reductions are rejected above 4,096 source taps per output pixel

- **When:** Slice 10b1 independent review.
- **The choice:** A reducing transform widens its Lanczos sampling footprint to
  avoid aliasing, which means a very small scale factor makes each output pixel
  read from an enormous neighbourhood. The transform rejects any request whose
  two-dimensional kernel would exceed 4,096 source taps per output sample, so a
  tiny positive scale cannot occupy a native worker effectively forever. The
  caller receives a validation error rather than a silent lower-quality fallback.
- **The gap:** The plan requires positive transform scales and scaled Lanczos
  support but bounds neither the minimum useful scale nor the kernel work, and
  defines no multistage reduction strategy.
- **The reach:** Routine reductions through roughly one-eighth scale remain
  supported by the direct kernel. More extreme reductions must be expressed as a
  bounded resize followed by a transform, or rejected.
- **Verdict:** **Needs-user.** Provisional call: keep the cap. Replace it with a
  measured limit, or with a multistage affine path, if real layer workflows need
  smaller direct scales.
- **Confidence:** Medium.
- **Owner:** `crates/photoctl-image/src/resample.rs`.

### U19 — Text grounding accepts at most 100 instances

- **When:** Slice 11b keyless command checkpoint.
- **The choice:** `segment --text "person"` asks a structured model how many
  matching boxes exist, and the model controls that number. The adapter accepts
  at most 100, so one crowded or malformed answer cannot launch unlimited local
  decoder work or create an unbounded layer snapshot. A legitimately empty
  answer remains a successful no-op.
- **The gap:** The plan required every returned instance to become a layer but
  supplied no maximum.
- **The reach:** Text-segmentation latency, the maximum layers one command can
  add, and provider response validation all inherit this bound. Changing the one
  adapter constant changes both the JSON request schema and the response
  validator together.
- **Verdict:** **Needs-user.** Provisional call: keep 100, aligned with the
  existing graph page bounds. Tune it after real crowded-frame use.
- **Confidence:** Medium until exercised on representative group photographs.
- **Owner:** `packages/providers/src/adapters/structured.ts`.

### U20 — SAM's letterbox, threshold and thread policy are implementer conventions

- **When:** Slice 11a coordinate/runtime implementation.
- **The choice:** To segment, the photo is scaled so its longer edge is 1,024
  pixels, the shorter edge is rounded to the nearest pixel, and odd padding is
  split with the extra pixel on the bottom or right. Decoder samples map back
  through that exact transform, and a bilinear logit value **strictly greater
  than zero** becomes mask value 1 while zero and negative values become 0 —
  there is no tunable threshold. The CPU sessions use one intra-op and one
  inter-op thread so concurrent daemon work stays bounded, and the encoder
  feature cache deduplicates work by `(photo id, render tier)` while delegating
  eviction to the existing cache owner.
- **The gap:** The spec fixed the input size, interpolation, threshold concept
  and cache identity, but not padding alignment, rounding, equality at the
  threshold, or runtime thread counts.
- **The reach:** Prompt coordinates, edge pixels, repeatability and daemon CPU
  contention inherit these conventions; changing the threshold or the letterbox
  changes mask identity for every future selection.
- **Verdict:** **Needs-user.** Provisional call: keep them. Validate edge quality
  and timing against the real weights before treating them as release-tuned.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/sam2-frame.ts`,
  `crates/photoctl-image/src/sam2.rs`.

### U22 — Outpaint refresh replays the predecessors captured at authoring time

- **When:** 12f3 preparation, 2026-09-06.
- **The choice:** After a crop and border A, author border B, change exposure,
  then add more local paint. Refreshing B uses today's exposure and the
  currently enabled versions of the layers that existed when B was authored, in
  their current order. Removing A removes A's contribution. Moving the later
  paint below B does *not* admit that paint into B's regeneration. B's authored
  frames and exterior-only ring stay fixed, and a density-only retry keeps the
  pinned original generation instead. The rejected alternative — "everything
  currently below B in the stack" — would admit later paint after a reorder and
  could feed B's own descendants back into it.
- **The gap:** Ordinary fill refresh adopts current source edits, but never
  defined membership for a generation input containing several earlier
  photographic layers.
- **The reach:** Membership is immutable request intent; predecessor *appearance*
  is read from current state on explicit refresh. The policy can change before
  new borders are authored, but existing requests must not silently change
  meaning. Refresh never adds new expansion.
- **Verdict:** **Needs-user.** Provisional call: preserve captured membership
  rather than the current stack prefix.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/fill/outpaint.ts`,
  `packages/render/src/full-frame-refresh.ts`.

### U24 — The white-balance eyedropper reads the editable base, beneath user grading

- **When:** Slice 08g eyedropper pass, 2026-09-06.
- **The choice:** Clicking a gray patch samples the photographic input that sits
  *beneath* the editable develop adjustments. The camera's as-shot processing has
  already happened, and existing purchased processing beneath develop is
  retained, but a tint the user added, a generated layer, or a red annotation
  cannot change which correction the same click resolves — so repeating a click
  does not compound the correction. Sampling the displayed composite instead
  would let annotations or prior grading change the inferred colour of the light.
- **The gap:** The original eyedropper requirement did not name the sampling
  stage. The owning slice retains this provisional base-sampling policy; it is
  not a new closeout approval requirement.
- **The reach:** Resolved values use the ordinary develop shape and undo. A later
  composite policy changes the sampling stage; it does not add a second stored
  white-balance model. The response names which stage it sampled.
- **Verdict:** **Needs-user.** Provisional call: keep the pre-develop base
  policy; it is reversible at the sampling owner.
- **Confidence:** Medium.
- **Owner:** `packages/render/src/develop/`.

### U26 — Actual public model and package publication remains unverified

- **When:** Slice 11a model manifest; slice 14 release workflow; reconciled
  2026-09-08.
- **The choice:** The model manifest pins the upstream SAM 2.1 revision, the
  exporter-owned opsets and per-file SHA-256 values; a manifest without real
  hashes is a parse error, not a state. Earlier builds carried an
  `awaiting_export` status with null hashes that every consumer refused; once
  the real export landed nothing produced that state, so the closeout review
  deleted the status field and its dormant refusal branches rather than keep a
  second manifest shape alive. Publication
  itself is automated by pushing a version tag, which builds packages, assembles
  a GitHub release with the model files and hashes, re-downloads them from the
  public URL to verify, then publishes to npm. Actual public publication remains
  unverified, and a tag must never be pushed as a diagnostic experiment.
- **The gap:** The slice named a David-hosted release; only the user can
  authorize the publication that would prove it works end to end.
- **The reach:** Until a real release runs, "the release pipeline works" is a
  configuration reading, not an executed fact. `doctor --fetch-models` defaults
  to the installed version's release URL — never a moving "latest" — with
  `models_base_url` as an explicit mirror override.
- **Verdict:** **Needs-user.** Provisional call: leave publication unexercised
  and unclaimed. Only the user can decide to cut a real release.
- **Confidence:** High in the representation; the outstanding item is authority,
  not design.
- **Owner:** `fixtures/models.json`, `.github/workflows/publish.yml`,
  `scripts/{fetch-models.mjs,verify-release-models.mjs}`,
  [release ownership](README.md#release).

### U27 — Review findings left in place at closeout

- **When:** Whole-spec review, 2026-09-08, after the last slice closed.
- **The choice:** Three read-only review passes produced forty-odd findings.
  The confirmed user-facing defect (S96) and every mechanical consolidation
  with one obvious owner were applied and are covered by the existing suites.
  The rest were deliberately left: a second Lanczos edge semantic in the
  native resampler, collapsing twenty-one migrations and the hand-mirrored schema
  roster into one baseline, three writers of setting defaults, a locator
  fallback that only the test resolver can reach, the `migrate_required`
  code name, message-text error classification and `usage`/`provider_busy`
  catch-alls in a few handlers, three budget parsers, seven copies of the
  advisory-progress policy, `show`'s SQL-literal fast path, a test fixture
  imported across a package boundary because the tidy home would create a
  dependency cycle, and the harness's fabricated stream envelope. The closed
  spec's "Review debt" section names each with its owner.
- **The gap:** The plan required a whole-spec review and its fixes but never
  said which findings an unsupervised closeout may land without the user.
- **The reach:** Nothing user-visible changes until one of these is taken up;
  merging the resampler edge semantics changes evaluated pixels and belongs
  behind the renderer semantic revision rule. Confirmed disagreement between
  a generated original and its saved recipe is a correctness defect, not
  deferred product discretion.
- **Verdict:** **Needs-user.** Provisional call: leave the remaining choices;
  revisit one finding at a time with behavior-specific evidence. A change to
  evaluated resampling semantics needs a semantic-revision bump.
- **Confidence:** Medium — the list is complete for the three reviewed areas;
  `apps/cli` argument parsing and the Swift helper were read only in passing.
- **Owner:** the files named in the closed spec's review-debt section.

---

## Sound — the architecture now owned

These are settled. They are listed so the user knows what they own, because
future work inherits every one of them as a given.

### S94 — v1 selection is an initial SAM mask plus manual correction on the same layer

- **When:** Slice 11 segmentation and the selection/redo pass; accepted by the user on 2026-09-08.
- **The choice:** Point `segment` at a person's hair, or at a wire crossing the
  sky. The mask that comes back follows the coarse body of the subject
  correctly and matches the upstream reference implementation numerically, but
  its fine edges miss the strands and the wire, and tuning the local mask
  kernel to rescue wires makes foliage worse. Instead of a second refinement
  model or an alpha-matting pass, the product treats SAM as the starting point:
  `segment <photo> --layer <layer> --operation add|subtract|replace` with
  `--box` or a `--brush` polygon corrects the *same* layer's retained coverage
  in base-photo coordinates, an empty selection is a legal refillable state,
  and `undo`/`redo` walk a stored revision path so an over-correction is
  reversible without another model call. Corrections apply where a moved or
  scaled subject now sits.
- **The gap:** The spec promised "selection" and a fine-edge quality target but
  never named a numeric edge tolerance, nor what should happen when the model
  simply misses.
- **The reach:** Edits that consume a selection, such as masked fill and a
  selected-person move, inherit whatever boundary the user or agent has
  corrected to. The correction vocabulary must remain available if an automatic
  refiner is ever added; a refiner would be an additional stage, not a
  replacement for these controls.
- **Verdict:** **Sound.** The user confirmed that automatic fine-edge quality
  is not a v1 requirement because the manual override exists for agents and
  users. The photographic edge evidence stays recorded as a known limitation,
  not a failed gate.
- **Confidence:** High on the contract; the automatic edge limitation itself is
  documented, not resolved.
- **Owner:** `packages/commands/src/handlers/segment.ts`,
  `packages/commands/src/segment-refinement.test.ts`,
  `packages/render/src/layers/operations.ts`, `crates/photoctl-image/src/sam2.rs`,
  [segmentation invariants](README.md#segmentation),
  [the selection rationale](README.md#the-reasons--why-it-works-this-way).

### S95 — The contact sheet shows membership as kind/role/state pills and a labelled primary pill

- **When:** Pairing presentation checkpoint, accepted by the user on 2026-09-08.
- **The choice:** A photo card on the `wb sheet` report shows, beside the RAW
  filename, one pill reading `Primary online` or `Primary offline` — the public
  top-level `online` field, which the slice defines as the primary original's
  state — and, under an "Originals" heading on its own line, one pill per
  original reading kind, role and state (`RAW · Primary · Offline`, `JPEG ·
  Online`) with a green or grey dot and a dimmed dashed border when offline. The
  culling row holds only rating, flag and label. Members are not named: the
  public `list` row's `originals` entries carry `id`, `kind` and `online`, and
  the sheet renders exactly that. No "partially available" summary exists; a
  reader combines the primary pill with the member pills. The unprimed critique
  had asked for member filenames (a public list-shape extension), a
  partial-availability summary, and restyled sheet chrome that predates this
  slice; the user accepted the card as shown.
- **The gap:** The slice required list/show and the workbench to agree on one
  photo and its membership, with the top-level state describing the primary and
  membership reporting each original separately, without saying how the card
  distinguishes scope or whether members are named.
- **The reach:** The primary pill and the `RAW · Primary` member pill state the
  same fact twice by design. Naming members later would change the public
  `list` row, which every agent consumer reads, not just the sheet.
- **Verdict:** **Sound.** User-accepted on the captured evidence.
- **Confidence:** High.
- **Owner:** `apps/workbench/src/sheet.ts`,
  [layout evidence](assets/paired-layout/README.md).

### S96 — Daemon liveness is a transport keepalive, not handler progress

- **When:** Whole-spec closeout review, 2026-09-08.
- **The choice:** While a request is queued or executing, the daemon writes a
  small `keepalive` frame every second on that request's socket. The
  client treats any frame as proof of life and declares the daemon dead only
  after ten seconds of total silence, or the foreground queue budget plus one
  second if that is longer. Handlers still emit `progress` events for the user,
  but nothing about liveness depends on whether a verb happens to emit them.
  Before this, liveness rode on handler heartbeats and a hand-maintained list
  of "long-running" verbs in the client; the two had drifted, and `fill`
  generation, `layer refresh` and `develop --auto-enhance` — the verbs that
  spend money — emitted nothing and were on no list, so thirty-one seconds of
  provider silence returned `daemon_unavailable` ("outcome unknown") while the
  daemon committed the paid layer. The alternatives were adding those verbs to
  the list (a third owner that would drift again) or wrapping every handler in
  a progress heartbeat (progress frames with nothing to report).
- **The gap:** The plan said long previews refresh the idle deadline through
  the progress heartbeat and never named which verbs qualify.
- **The reach:** Total silence is bounded by the greater of ten seconds and
  the queue budget plus one second (thirty-one by default); the import verb's
  private ten-minute ceiling is gone because keepalives cover it. Keepalive
  frames run on the daemon's JavaScript thread, so a handler that blocks that
  thread longer than the client's idle ceiling would still be misreported — the existing
  rule that pixel work runs off the JS thread is what keeps this safe.
  If the caller disconnects during a paid request, transport timers stop;
  timer cleanup itself does not cancel a purchase or replay it. Handlers retain
  their existing progress and stream failure behavior. The connection owns its
  timer until response or closure, so a closed socket cannot accumulate periodic writes.
- **Verdict:** **Sound.** One owner for liveness at the seam that actually
  knows whether work is in flight.
- **Confidence:** High.
- **Owner:** `apps/daemon/src/server.ts` (`KEEPALIVE_INTERVAL_MS`),
  `packages/commands/src/daemon-client.ts` (`IDLE_CEILING_MS`, `requestTimeout`),
  `packages/protocol/src/frames.ts`, `apps/daemon/src/server.test.ts`.

### S93 — Five operating numbers nobody chose, one of them not settable

- **When:** Slices 01a/01b/04, carried forward unchanged.
- **The choice:** Five values bound work and latency and were picked by the
  implementer. Import prepares four files concurrently; `list` pages 64 photos
  at a time; an active import may go ten minutes without output before the
  daemon client declares it hung (ordinary commands use a 31-second idle cap);
  the daemon exits after fifteen idle minutes (`daemon_idle_ms=900000`, seeded
  at `init`); and when photoctl must *render* a JPEG — a rotated image, or the
  pinned 1616-pixel import preview — it encodes at quality 88. None of them
  changes ordering, stored results or pixels except the last, which trades file
  size against visible loss. Note that `daemon_idle_ms` is stored per library
  but is **not** accepted by `settings set|reset`: changing it today is a code
  edit, not a configuration change. Delivery quality is separately owned by the
  slice-05 export presets, so 88 now governs only preview and fallback encodes.
- **The gap:** The slices delegated scan concurrency, page size, idle ceilings
  and encoder quality without naming values, and the planning map called fifteen
  minutes a proposal rather than a decision.
- **The reach:** Peak import memory, filesystem parallelism, first-row latency,
  hung-daemon detection, cold-start cadence and offline preview appearance all
  inherit these numbers.
- **Verdict:** **Sound as delegated operating defaults.** Keep the current values
  and tune from concrete poor behavior, not speculative performance work or a
  new camera/platform gate. The user delegated ordinary tuning and released the
  camera; these values do not require fresh approval. Exposing daemon idle as a
  setting would be a separate public-interface choice.
- **Confidence:** Low for the exact operating numbers; this does not require new drive access.
- **Owner:** `packages/commands/src/handlers/import.ts`,
  `packages/commands/src/daemon-client.ts`, `packages/library/src/open.ts`,
  `packages/render/src/preview.ts`.

### S1 — Gateway transport retries throttling only, briefly, and classifies every other failure

- **When:** Slice 09a provider transport.
- **The choice:** The gateway answers HTTP 429 (rate limited). photoctl makes at
  most three attempts in total, waiting 100 then 200 milliseconds, or honouring a
  valid `Retry-After` value capped at two seconds; each attempt aborts at 30
  seconds. Nothing else is retried, because the contract does not prove any other
  failure is safe to repeat: 401/403/404 map to a shared
  credential/model/endpoint configuration error, while 400 and every other status
  plus transport failures map to a temporary per-request provider failure — so a
  single malformed image can fail without invalidating the rest of a batch. An
  image returned by URL gets the same 30-second ceiling and a 64 MiB streaming
  cap, and the fake gateway separately rejects request bodies above 32 MiB so a
  malformed fixture cannot consume unbounded memory.
- **The gap:** The slice delegated the retry policy and required only that
  rate-limit retries be bounded.
- **The reach:** All four OpenAI-compatible routes share these ceilings and
  attempt provenance. A real deployment under sustained throttling will fail
  sooner than a vendor SDK would.
- **Verdict:** **Sound.** Brief throttling gets a chance to recover without
  hiding prolonged unavailability or repeating unspecified failures.
- **Confidence:** Low to medium — no live gateway has ever exercised these
  numbers, and real error bodies may justify different ceilings or classification.
- **Owner:** `packages/providers/src/gateway.ts`,
  `packages/providers/src/adapters/image.ts`.

### S2 — Render-owned failures are still classified by message text at the command seam

- **When:** Slices 12 and 13; narrowed at the 2026-09-08 closeout.
- **The choice:** Where `packages/render` raises a plain error, the command
  handler decides the public code by inspecting the message: retouch maps a
  `Retouch ` prefix to `usage`; fill and layer map `not present` to
  `not_found` and a fixed set of render prefixes (`Layer position`, `Transform
  scale`, `Ambiguous refresh node prefix`, …) to `usage`; segment maps
  `Segment`/`Manual mask`/`Mask` prefixes; graph and presets map cursor,
  revision and `Preset not found:` messages. Every message a render owner
  actually raises lands in the intended class today. Failures the commands
  package itself raises — argument parsing in `segment`, the missing-layer and
  non-refreshable-branch cases in `fill`, the exact `fill --move requires a
  subject layer` message — are now thrown as typed `PhotoctlError`s and no
  longer round-trip through prose; the closeout review removed those matches.
- **The gap:** The closed `ErrorCode` union and its exit mapping are owned by
  `packages/protocol`; nothing said how a domain package signals *which* code
  it means when it is not already raising a typed error.
- **The reach:** Rewording a render error message moves a user error into a
  different exit class without a type error. The direction that removes this
  is for render to raise typed errors the handler maps by class; that change
  touches exit classes and is listed in U27 for the user.
- **Verdict:** **Sound today** — the mappings are correct — with the remaining
  message coupling recorded as a maintenance weakness rather than a defect.
- **Confidence:** Medium: high that today's behavior is right, low that a
  reader would expect prose to be load-bearing.
- **Owner:** `packages/commands/src/handlers/{retouch,fill,layer,segment,graph,presets}.ts`,
  `packages/render/src/{retouch,layers/operations}.ts`.

### S3 — Photo identity is a sampled key, promoted to a full hash only when it collides

- **When:** Slice 01b identity, slice 04 collision audit, and the post-02/07a
  wavefront audit.
- **The choice:** Import opens each file once and reads a fixed head-and-tail
  sample plus size and modification time from that single descriptor, checking
  size and mtime again before returning — so a file still being copied fails
  rather than combining the beginning of one state with the end of another. That
  sample is the content key. When a second file shares the key, both files are
  fully hashed, the hashes are stored on the colliding photos, and only that
  bucket pays for cryptographic equality; if the existing file is offline and has
  never been promoted, import refuses to attach the newcomer rather than guessing.
  A second path with the same sample reuses an existing photo only when the old
  path is gone on the *same confirmed-mounted* volume — the explicit rename case;
  an offline or unknown old volume refuses. At the exact same locator, an
  unchanged stored mtime is idempotent while a changed mtime refuses an
  unpromoted match, since the middle bytes may differ. Touching a file's
  timestamp never changes identity: export re-derives the content key and a
  merely touched original still supplies its full-resolution pixels instead of
  being downgraded to a cached preview. Promoting a sampled identity to a
  verified full hash changes no pixels, so cached views stay valid.
- **The gap:** The plan required a full hash "on collision" without saying where
  it is stored or what happens when the old source is unreadable, and the rename
  contract and the collision-safety rule pulled in opposite directions.
- **The reach:** Rescans, reconnects, XMP targeting, disk removal and export all
  consult this one owner. Large-drive import keeps its sampled-hash speed while
  database identity stays collision-safe and repeatable.
- **Verdict:** **Sound.** The inference is no broader than the explicit
  relocation contract, and every other uncertainty fails closed.
- **Confidence:** Medium — a same-volume delete followed by an adversarial
  sampled collision is indistinguishable without an always-full-hash policy.
- **Owner:** `packages/library/src/{identity,locators}.ts`,
  `packages/commands/src/image-source.ts`.

### S4 — Library-owned copies have a catalog-local volume identity and an on-disk layout

- **When:** Slice 04 copy/import integration.
- **The choice:** `import --copy` stores originals at
  `<library>/originals/<capture-date|undated>/<name>` under the reserved volume
  UUID `photoctl-library`, resolved relative to the current library root — so
  moving the whole library keeps every locator valid and no test volume mapping
  is needed, while macOS still resolves the physical mount before choosing a
  Trash. If the preferred name is taken, the copy gets a `_<last-8-of-original-id>`
  suffix. If that destination is *also* occupied, photoctl compares the existing
  file's identity: the sampled content key, plus the full hash when one is
  stored. A match reuses the file; a mismatch fails that item with
  `volume_readonly` rather than overwriting. If the source already sits in the
  very directory the copy would target, no copy is made and the file is not
  duplicated.
- **The gap:** Library files have no hardware UUID, and the plan named neither
  the on-disk layout, the collision suffix, nor the already-in-place case.
- **The reach:** Copy import, offline source removal, display, export and
  volume-aware Trash share one locator rule. The date/name/suffix scheme is now
  a de facto storage contract that users will see and scripts may depend on.
  Note what the occupied-destination check is *not*: it is sampled identity plus
  a stored full hash, never an unconditional byte-for-byte comparison of the
  whole file.
- **Verdict:** **Sound.** The identity is stable where it must be and
  deliberately local where a global UUID would be misleading.
- **Confidence:** Medium — the layout itself was never surfaced for approval.
- **Owner:** `packages/commands/src/handlers/import.ts`,
  `packages/library/src/locators.ts`.

### S6 — Batch envelope codes depend on the set of outcomes, never on argument order

- **When:** Slice 01b export review; shared batch owner from slice 06.
- **The choice:** A batch verb resolves each target, encloses each one's own
  work, and aggregates: if every item fails with the same code, the envelope
  keeps that code; if the codes differ, or successes and failures are mixed, the
  aggregate code is `partial` while every item retains its own typed result.
  Reversing two IDs therefore never changes the process exit or an agent's retry
  decision. The shared owner also fixes classification: an invalid requested
  value is a per-item `usage`, malformed stored graph state is
  `catalog_unreadable`, and a concurrent revision change is retryable
  `library_locked` with `reason:"revision_conflict"`. The rejected alternative
  took the first failed item's code.
- **The gap:** A6 defined mixed success as partial but not the all-failed,
  heterogeneous case, and the batch contract named no existing codes for graph
  validation or a revision race.
- **The reach:** Every future batch verb inherits one permutation-invariant
  aggregation rule and one envelope implementation instead of another near-copy.
  Multi-photo scripts keep ordered outcomes and can retry a raced photo without
  replaying successful items.
- **Verdict:** **Sound.** Aggregate meaning follows outcomes, and the
  classifications keep the closed protocol intact while separating corrupt
  durable state from transient write contention.
- **Confidence:** Medium — a dedicated revision-conflict code would be clearer if
  the public error vocabulary is ever widened.
- **Owner:** `packages/commands/src/batch.ts`.

### S8 — A paired photo has at most one original of each kind

- **When:** Paired-originals checkpoint and reviews, 2026-09-06.
- **The choice:** A camera writes a RAW and a JPEG for the same exposure; same
  folder, same stem, they become one logical photo with two originals. Importing
  another folder containing the same RAW bytes and a *different* JPEG adds
  neither a third original nor a replacement — another location of the same JPEG
  is just another copy of one original. Pairing is *vetoed*, never driven, by
  capture facts: differing capture time or camera make/model rejects the group,
  missing values prove nothing, and differing resolution or orientation are
  expected (a real retained pair has a reduced RAW and a full-resolution JPEG).
  An ambiguous group fails while its neighbours import, and explicit RAW-only
  import still admits the RAW even when two JPEG companions exist, because that
  command does not need to choose a companion. Availability describes the
  *primary*: when the RAW disappears the photo shows its RAW filename and an
  offline primary state while its member list separately reports the JPEG online
  — calling the whole photo online would imply ordinary RAW-led processing still
  has its source.
- **The gap:** The pairing contract required content-aware grouping without
  fixing multiplicity, the veto fields, or what "online" means for a photo with
  two different originals.
- **The reach:** The fresh schema enforces one original per kind, so a future
  alternate-rendition feature needs an explicit selection and ownership contract
  rather than accidental extra rows. Metadata never pairs files across folders or
  overrides name ambiguity.
- **Verdict:** **Sound.** The user's one-RAW/one-JPEG model is enforced where it
  is decided, and the veto protects obvious mismatches without conflating the
  JPEG's processing choices with the RAW's geometry.
- **Confidence:** High on multiplicity; medium on which capture fields suffice.
- **Owner:** `packages/importer/src/companions.ts`,
  `packages/commands/src/handlers/import.ts`,
  [paired-import review](assets/paired-import-review.md).

### S9 — Camera-JPEG renditions share the renderer's cache invalidation and do not gain offline fallback

- **When:** Paired-originals source and scope reviews, 2026-09-06.
- **The choice:** A native colour or sampling correction changes rendered pixels,
  so both document views and camera-JPEG views must stop reusing images produced
  by the old renderer. The JPEG rendition hashes its original identity and
  geometry through the *same* renderer-revision owner as document hashes, rather
  than getting a second version number somebody would have to remember to bump.
  Separately: once a camera JPEG original becomes unavailable, explicit
  camera-JPEG `show`/`export` report it unavailable even if a derived view of it
  is still cached. Ordinary RAW viewing may still use its separately pinned
  preview; substituting that RAW preview for the JPEG would be incorrect.
- **The gap:** A source-specific cache key distinguished JPEG from RAW but did
  not itself account for later changes to pixel processing, and the contract
  required honest unavailability without promising offline camera-JPEG delivery.
- **The reach:** No synthetic render node, document mutation or second version
  setting exists. Promoting a sampled identity to a verified full hash does not
  change the original's pixels and therefore does not invalidate its views. A
  future offline-JPEG extension must preserve original-specific cache provenance
  and cannot reuse the RAW fallback.
- **Verdict:** **Sound.** One pixel-semantics revision invalidates both families,
  and the source boundary stays explicit rather than quietly widened.
- **Confidence:** High on invalidation; medium that cached offline JPEG viewing
  remains a useful follow-up.
- **Owner:** `packages/render/src/preview.ts`, `packages/commands/src/handlers/show.ts`.

### S10 — Case-only sidecar collisions refuse both operations

- **When:** Independent paired-originals review, 2026-09-06.
- **The choice:** Two separate photos named `frame.ARW` and `FRAME.JPG` would
  both write the sidecar `frame.xmp` on a camera card or an ordinary Mac volume,
  where filenames are case-insensitive. photoctl compares existing sidecar
  targets without letter case and refuses both the write and the read before
  changing anything. On a genuinely case-sensitive disk this also refuses two
  distinct sidecars that could have coexisted; the alternative would require
  filesystem-specific identity probing before every write.
- **The gap:** Shared-target protection needed a case policy that works across
  volume formats.
- **The reach:** `xmp write` and `xmp sync` share the conservative check. No
  alternate sidecar filenames, volume-capability cache, or automatic metadata
  reconciliation is introduced.
- **Verdict:** **Sound.** A reversible refusal is safer than overwriting another
  photo's metadata.
- **Confidence:** Medium — explicitly accepted as conservative on case-sensitive
  volumes.
- **Owner:** `packages/library/src/xmp/`.

### S11 — Disk removal verifies the original before touching it and stages reversible receipts

- **When:** Slice 04 removal implementation; final pairing correctness review,
  2026-09-08.
- **The choice:** `remove --from-disk` requires explicit `--yes`, including for
  one photo, as the original safety decision prescribed. Without confirmation it
  refuses before opening the library. A confirmed request on a photo whose filename now holds a
  *different* image removes the requested catalog entry, leaves the current file
  untouched, and explains it through the existing `source_offline` warning — as
  in source reads, that means the catalogued original is unavailable even though
  some bytes exist at its old address. A file that *does* match the stored
  identity (sampled content key and size, plus the full hash when one is stored)
  moves to Trash first and returns a rollback receipt; cache paths follow; only
  then does the catalog transaction delete the photo. A pre-commit failure
  restores receipts in reverse order, and a failed restore becomes a typed
  unavailable error listing every unrestored path rather than being swallowed.
  After the database commits, cleanup failure cannot roll the catalog backward.
- **The gap:** A filesystem move and a PGlite transaction cannot be one atomic
  act, and removal never specified what to do about a reused filename. A filename
  alone cannot authorize moving unrelated bytes.
- **The reach:** The catalog commit is the only irreversible boundary, and reads
  and removal share one identity owner. This adds no full-hash-at-import
  requirement and no defence against a concurrent external writer replacing the
  file between the check and the move.
- **Verdict:** **Sound.** The unrelated file is preserved while the explicit
  catalog cleanup still succeeds, with the partial disk effect visible in the
  result.
- **Confidence:** High for preserving the file; medium for reusing the offline
  warning instead of adding a new public warning code.
- **Owner:** `packages/commands/src/handlers/cull.ts`, `packages/library/src/trash.ts`.

### S12 — Deliveries are published before they are recorded, and never clobber by accident

- **When:** Slice 05 delivery export and closeout review; original-overwrite
  protection, 2026-09-06.
- **The choice:** An export crosses two durable systems that cannot share a
  transaction: the filesystem holding the JPEG/PNG/TIFF, and the database
  recording its history. photoctl writes and fsyncs the complete file, installs
  it with an atomic no-replace rename, and only then inserts the history row — so
  a database failure leaves a valid but unrecorded delivery, never a durable
  history row pointing at a partial or missing file. Only `--on-collision
  overwrite` may replace an existing name; filesystems lacking the no-replace
  primitive fail closed after removing the unpublished sibling temporary, so a
  reader observes either no destination or the complete fsynced file. An
  overwrite aimed outside the currently configured volume map additionally checks
  *historical* mount paths and refuses if a recorded original occupies that
  canonical path or its leaf is missing — history may reserve a destination, it
  may never identify a source. An unrelated absent mount is ignored, while a
  permission or I/O failure is not proof of absence and refuses publication.
  TIFF regains its `Artist` and `Copyright` fields by an in-process rewrite of
  the image-file directory after the encoder drops them, rather than shelling out
  to a separately installed metadata tool. Library presets shadow package presets
  of the same name, command-line values win over both, and `--iptc` overrides
  merge field by field so one override cannot erase an unrelated preset value.
- **The gap:** The plan required durable output, history and no unasked
  clobbering, but no shared transaction exists; skip semantics, stale-mount
  interaction and encoder metadata loss were all unspecified.
- **The reach:** Export retries may discover an unrecorded file and apply the
  requested collision policy, but catalog history never promises a delivery that
  had not yet been published. Canonical path checks handle file/directory
  aliases but are not an adversarial transaction against concurrent renames.
- **Verdict:** **Sound.** The recoverable orphan beats a false durable claim, and
  uncertain replacement is refused rather than guessed.
- **Confidence:** High; medium on preferring original safety over delivery
  availability when a permission error makes absence unprovable.
- **Owner:** `packages/render/src/export/{run,preset}.ts`,
  `packages/commands/src/handlers/export.ts`.

### S13 — Offline export reuses a retained render only with proof of intent *and* source quality

- **When:** Retained-output integration, 2026-09-06; slice 05/08a2 evaluator
  review.
- **The choice:** A user edits online, inspects the result, then unplugs the
  drive and exports. photoctl tries the live original first; failing that, it may
  reuse an already-rendered canonical output, but only when that output's stored
  renderer identity matches today's recipe semantics. Among valid candidates it
  prefers greater original-source sampling, then full file over embedded JPEG
  over pinned preview, then greater output sampling; two candidates that tie on
  all of that but came from different automatic decoder choices are separated by
  stable execution identity rather than by whichever ran last. Candidates are
  validated in bounded metadata pages using each candidate's own coordinate
  frame, so an obsolete or corrupt output cannot hide a valid one or force a paid
  request to be replayed. Failure kinds stay distinguishable: source bytes that
  will not decode raise their own evaluator error so export can fall back to the
  pinned preview and warn, while a graph node whose pixel operation has not
  shipped stays `decoder_unavailable` and never masquerades as an offline source.
- **The gap:** Immutable edit-node identity alone names neither the renderer
  version nor the quality of the source that execution used, and the evaluator
  did not distinguish failing to decode a source from failing to evaluate the
  graph above it.
- **The reach:** Reconnect promotion, warnings and exit classes stay truthful
  without a second cache or source-selection owner. A future explicit
  decoder-preference contract must constrain retained-output eligibility, not
  merely change which decoder new work uses.
- **Verdict:** **Sound.** Reuse requires evidence about the actual execution
  rather than a guess from age or dimensions.
- **Confidence:** High; medium on the tie-break, which a user-facing decoder
  preference would supersede.
- **Owner:** `packages/commands/src/handlers/export.ts`,
  `packages/render/src/export/`.

### S14 — `xmp write` targets exactly one verified locator and publishes without a lost update

- **When:** Slice 06 XMP implementation, 2026-09-05.
- **The choice:** One photo can have several locators — catalog records pointing
  at identical original bytes on different volumes. With the camera card offline
  and a library copy online, `xmp write` walks the locators in catalog order,
  verifies that an online file still has the catalogued content identity, and
  writes one sidecar beside the first match; it does not fan the write out to
  every copy, and `xmp sync --read` picks its sidecar by the same rule so read
  and write cannot silently target a path whose bytes were replaced after import.
  Publication then protects the only irreplaceable state — the existing sidecar.
  photoctl merges catalog fields into memory, writes a uniquely named sibling,
  preserves the old permission mode, fsyncs it, and re-reads the target,
  comparing file identity, permissions/owner, size, nanosecond modification time
  and a SHA-256 digest. It atomically displaces the current file to a private
  sibling and validates those displaced bytes against the snapshot; if another
  editor replaced the sidecar in that tiny interval, photoctl restores the
  replacement and retries from it, up to three times, before refusing that item.
  On success it hard-links the prepared file into the now-vacant name — hard-link
  creation is atomic and refuses to overwrite a file another editor just created
  — then fsyncs the directory, and only then does the database record the
  observation. If a second editor makes restoration impossible, the displaced
  bytes are left at a named recovery path with a typed failure rather than either
  version being deleted.
- **The gap:** The plan required parse-merge and read-only-volume behavior but
  chose neither a crash boundary, a publication mechanism, nor which locator wins.
- **The reach:** Every future XMP field inherits no-partial-file and
  no-known-lost-update, including the post-verification race. A filesystem
  without same-volume hard links refuses the write rather than falling back to a
  clobbering rename. A caller who wants another copy's sidecar must make that
  locator the first verified online source; there is no replication protocol.
- **Verdict:** **Sound.** Ordering preserves the existing sidecar until a
  complete replacement is durable, without a second journal or schema.
- **Confidence:** High on the conflict-preservation ordering; medium on the
  unmeasured three-attempt budget and on failing closed without hard links.
- **Owner:** `packages/library/src/xmp/`, `packages/commands/src/handlers/xmp.ts`.

### S15 — Sidecar content mirrors only what the catalog actually owns

- **When:** Slice 06 parse-merge and doctor integration, 2026-09-05.
- **The choice:** The catalog stores flat tag strings, not Lightroom's keyword
  tree, so a write replaces both the flat and the hierarchical keyword properties
  with one `dc:subject` bag containing exactly those flat strings — a deleted tag
  cannot reappear on the next import, and a hierarchy discarded at import cannot
  be reconstructed. Rating, colour label and the photoctl flag are the other
  owned properties. Every unrelated XML node stays byte-for-byte in place, and
  Lightroom hierarchy is removed only when the `lr` prefix really denotes
  Lightroom's namespace: namespace validation follows XML scope through ancestor
  elements, and if a document rebinds a standard prefix such as `rdf`, `xmp`,
  `dc` or `photoctl` to a different URL, the merge refuses that item instead of
  shadowing the binding and reinterpreting preserved XML. Item-local filesystem
  shapes map to existing codes — a disappearing path to `file_offline`,
  permission and read-only failures to `volume_readonly`, an XMP pathname that is
  a directory to `unsupported_file` — while database and programming errors stay
  unwrapped and abort normally. Divergence is reported by `doctor` as one
  `xmp:{stale:N}` count plus a single soft warning, scanned 128 catalog rows at a
  time, with `list --xmp-stale` as the per-photo surface.
- **The gap:** The plan named the round-tripped values and required foreign-node
  preservation, but defined neither hierarchy rewriting, prefix shadowing, POSIX
  error shapes, nor doctor's response nesting and scan bound.
- **The reach:** One malformed sidecar cannot starve later items; monitoring
  reads one bounded health metric; callers needing IDs use the already-paged list
  command instead of expanding doctor output.
- **Verdict:** **Sound.** The serialized form matches the information the catalog
  owns, and refusal is safer than assigning new meaning to preserved foreign XML.
- **Confidence:** High; medium that `unsupported_file` is the right code for
  path-shape faults.
- **Owner:** `packages/library/src/xmp/`,
  `packages/commands/src/handlers/{xmp,cull}.ts`.

### S19 — Cache identity is portable, and prune claims a path before deleting it

- **When:** Slice 03a cache lifecycle and integration review; slice 01a cache
  override.
- **The choice:** The cache index stores `view/<photo>/<render>/<artifact>`
  relative to the *active* per-library cache root, and `PHOTOCTL_CACHE=/tmp/cache`
  selects a base directory — the library ID is still appended, exactly as it is
  under the default macOS cache directory — so two libraries cannot overwrite
  each other and a restored catalog carries no machine-specific path. Files
  abandoned under an old override simply stop being managed until that root is
  selected again. Pruning takes one clock snapshot, pages the oldest rows in
  bounded least-recently-used order, asks the shared preview coordinator for an
  exclusive lease on each path, and deletes the database row only if `last_used`
  is still older than the snapshot's 30-minute cutoff: if a concurrent `show`
  validated and touched that preview after the list was captured, the condition
  fails and the file stays; if prune claims first, a waiting materializer
  regenerates rather than receiving a disappearing path. A filesystem failure
  restores that row, records the first error, and continues with later candidates
  so one permanently bad entry cannot starve every newer one. The result reports
  artifacts removed, bytes freed, bytes still indexed and the requested maximum,
  and `--max 0B` is a legitimate "remove every eligible derived artifact" that
  still spares pinned, recently used and leased files.
- **The gap:** The plan named leases, a captured prune time and a budget flag,
  but chose neither the database/filesystem ordering, the failure isolation, nor
  whether zero is a valid budget.
- **The reach:** Agents can inspect a returned preview path without a concurrent
  cleanup invalidating it, and backup/restore never bakes one machine's cache
  directory into the catalog.
- **Verdict:** **Sound.** The lease closes the file race, the conditional claim
  closes the stale-query race, and per-item isolation preserves forward progress.
- **Confidence:** Medium.
- **Owner:** `packages/library/src/cache-index.ts`,
  `packages/importer/src/cache-prune.ts`,
  `packages/commands/src/handlers/cache.ts`.

### S21 — Search is a local-first hybrid with an optional vector arm

- **When:** Slice 09c schema and search implementation and its review.
- **The choice:** A photo's searchable words live in child tables — paths in one,
  tags in another — which PostgreSQL cannot query from a generated column. So a
  database trigger refreshes a plain `photos.search_text` string whenever a file
  or tag row changes, and `photos.searchable` is the generated tokenized search
  document indexed for fast lookup; importing `weddings/first-look.ARW` and
  adding the tag `ceremony` rebuilds that string from all current paths and tags
  automatically. Duplicating refresh calls in import, tag, XMP, restore and every
  future writer would make one missed caller silently stale the index. Both
  documents and queries use PostgreSQL's `english` configuration with the same
  punctuation stripping, so ordinary inflections match; a punctuation-only query
  becomes no document and returns nothing. The optional vector arm materializes
  the embeddings for the *requested model* and sorts them exactly rather than
  using the approximate index, whose ordering domain spans model generations and
  would underfill the current-model arm during a partial backfill. Each arm
  supplies at least 50 and normally four times the requested count, never more
  than 200 candidates, before reciprocal-rank fusion combines them into a page of
  at most 50. Every hit is labelled with the basename of its lexicographically
  first stored relative path — deterministic, no per-hit filesystem probe, and
  not a claim that this copy is online. Provider failures — configuration, auth,
  rate limit, timeout, outage, malformed success JSON — drop only the vector arm
  with a warning, while local index and fusion failures stay hard errors.
- **The gap:** The plan required a generated search value over normalized child
  tables, a shape PostgreSQL cannot express as one formula, and fixed the public
  page limit and fusion constant but not the text configuration, the candidate
  window, the label rule, or the degradation boundary.
- **The reach:** Keyless retrieval is intentionally English-oriented — other
  languages tokenize but receive no stemming — and changing that later means
  rebuilding the generated column and its index. Catalog search stays usable
  during provider incidents without misrepresenting local corruption as an
  optional-service warning.
- **Verdict:** **Sound.** Synchronization lives where the facts change, model
  isolation beats claiming an index whose ordering domain is too broad, and the
  vector arm enriches recall without owning availability.
- **Confidence:** Medium — English-only stemming and the 200-candidate window are
  unevaluated against a real library.
- **Owner:** `packages/library/src/search/`,
  `packages/commands/src/handlers/search.ts`, slice 09c migration.

### S23 — Library configuration replaces one validated setting at a time

- **When:** Public-settings completion pass, 2026-09-07.
- **The choice:** `settings get|set|reset` takes a setting name and a JSON value
  and replaces that *whole* value — setting `models` to one purpose override
  removes the previous overrides rather than silently merging them, and `reset`
  restores the normal defaults. Dotted paths are refused; library identity and
  internal navigation state are not user settings; no credentials are stored.
  Saving configuration performs no download and makes no foreground provider
  request, though explicitly enabling automatic embedding grants the
  already-defined background consent. A developer can therefore point a library
  at a model mirror without editing the database or being handed arbitrary SQL.
- **The gap:** The original plan promised saved preferences but left their public
  editing interface to a later slice that never supplied one; a dotted-path patch
  language or per-preference flags were the alternatives.
- **The reach:** One typed registry governs validation and defaults for both the
  existing readers and the new writer, and there is no database schema change.
  Not every stored value is exposed — see S93 for the daemon idle timeout.
- **Verdict:** **Sound.** Whole-setting replacement is small, explicit and
  retry-safe.
- **Confidence:** Medium for whole-object JSON ergonomics; high for shared
  validation and for keeping identity and private state outside the API.
- **Owner:** `packages/library/src/settings.ts`,
  `packages/commands/src/handlers/settings.ts`.

### S24 — `show` selects by path only through the existing locator, and never guesses

- **When:** Existing-photo path lookup and its review, 2026-09-06.
- **The choice:** `show abcdef` is treated as an ID prefix exactly as before; an
  agent that means a file named `abcdef` writes `show ./abcdef`. A path argument
  is resolved against the client's working directory, checked first against
  library-local file identity, then handed to the existing volume resolver, and
  the resulting volume-plus-relative-path pair is looked up in the catalog's
  unique file index. An unindexed file returns `not_found`: inspection never
  imports it and never searches for a same-content photograph elsewhere. A
  missing path returns `file_offline` and tells the agent to use the photo ID,
  which can still show the cached image — photoctl deliberately does *not* join a
  remembered mount name to a relative path, because a different drive may now
  occupy that name. Path identity and pixel availability stay separate: a mounted
  path can identify the catalogued photo even when its bytes cannot be read, and
  ordinary `show` then handles source availability and returns a cached preview
  with a warning. `show` is the only verb that accepts a path.
- **The gap:** The original `show <id|path>` syntax did not define ID-like
  filenames, how a missing path identifies a volume, or whether the path selects
  an indexed location, searches by content, or opens a new image; the initial
  documentation also used "inaccessible" for both failed resolution and unreadable
  bytes.
- **The reach:** No additional index, persistence field, hashing pass or response
  schema exists. Extending path selection to other single-target verbs would mean
  giving each of them the resolver and the client working directory. A superficially
  similar historical-mount join *does* exist nearby, but it belongs to the export
  collision guard (S12) and is never used for selection.
- **Verdict:** **Sound.** The existing locator is the canonical relationship
  between a path and a photo; reuse it rather than adding a second identity owner.
- **Confidence:** Medium on the ID-versus-path precedence rule; high on the
  locator lookup itself.
- **Owner:** `packages/library/src/locators.ts`,
  `packages/commands/src/handlers/show.ts`.

### S27 — Upscaling is an explicit external adapter with balanced guarded semantics

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** A dedicated `UpscaleAdapter` sits *outside* gateway transport
  and owns its own display colour conversion, supported scale factors, pixel and
  edge limits, optional provider-native tiling, and a reversible frame mapping. A
  release pins a default; a library override wins over that; a per-command
  override wins over both. `auto` runs only after that adapter has been
  explicitly configured. Its default aesthetic is balanced-creative — medium
  detail synthesis, high resemblance — expressed as a versioned *guarded* prompt
  that uses the original generation intent as context while forbidding a repeat
  of the replacement operation that produced the pixels; both the original and
  the derived prompt are retained as provenance.
- **The gap:** The gateway's four general routes cannot represent every
  purpose-built upscaling service, while silently routing to a second vendor
  would violate user intent and make behavior unreproducible.
- **The reach:** Provider selection, consent, `doctor`, settings, events, cost
  and any future hosted or local implementation share one stable boundary, with
  no runtime capability guessing.
- **Verdict:** **Sound.** External differences stay at the external boundary.
- **Confidence:** Medium until a live model and its control values are measured.
- **Owner:** `packages/providers/src/upscale/`,
  `packages/providers/src/prompts/upscale.ts`.

### S28 — No native mask is ever sent live; exterior protection is local

- **When:** Slice 12 mask-polarity work; slice 12d provider runtime.
- **The choice:** "Mask polarity" is the question of whether a provider treats
  white as the area to edit or the area to protect — getting it backwards would
  repaint the photograph and preserve the blemish. Every gateway image adapter is
  constructed with polarity `unverified`, so an edit that would send a native
  mask throws `provider_unverified_mask` (exit 69) before any network I/O. The
  keyless path instead names a reserved fixture model that photoctl maps
  *locally* to an instruction-and-composite adapter: it asks for replacement
  pixels without sending a mask at all, then applies the returned pixels through
  photoctl's strict compositor, which copies every pixel outside the mask from
  the original input. Merely pointing the gateway URL at a fixture proves
  nothing — safety comes from not sending a mask and from the local compositor,
  not from a server identifying itself honestly. The evidence path is a separate
  explicitly keyed probe that makes exactly one request for one named model and
  polarity candidate using synthetic rectangles rather than a private photo,
  saves the outgoing mask and the uncomposited return with hashes, and *always*
  leaves polarity unverified for human review; its prompt asks both rectangles to
  change while the mask protects one, so prompt obedience cannot masquerade as
  mask enforcement.
- **The gap:** The spec required live polarity evidence but defined neither the
  probe's consent, fixture, request budget nor acceptance mechanism, and did not
  say how the built CLI recognizes the fake without turning an arbitrary URL into
  authority.
- **The reach:** Functional and agent-journey tests exercise the production CLI,
  real HTTP transport, immutable execution provenance and the strict composite
  without pretending to prove a live provider's convention. A spoofed fixture
  response can still change only the region the fill authorized. Native-mask
  polarity remains a genuinely open gate that blocks live masked fill entirely.
- **Verdict:** **Sound.** Transport success is not a mask-quality verdict, and
  provider-specific encoding has one owner without changing the compositor's
  internal white-means-edit convention.
- **Confidence:** High on the safety property; medium that the eventual live
  evidence will be read correctly, which is why it requires independent visual
  review.
- **Owner:** `packages/providers/src/adapters/image.ts`,
  `crates/photoctl-image` strict composite.

### S29 — Provider dialects terminate at the adapter boundary

- **When:** Slice 09a adapter implementation; slice 13a visual gate correction.
- **The choice:** A structured model returns `box_2d:[120,300,480,700]`. The
  adapter reads that as the vendor's `[top,left,bottom,right]` order on a 0–1000
  scale and rounds it into integer `[x,y,w,h]` pixels against the first supplied
  image, so callers only ever see canonical geometry. The image adapter captures
  the original encoded response and produces a PNG at its actual returned
  dimensions; it does not resize it to the requested dimensions. An unexplained
  aspect-ratio change is refused as `provider_whole_frame`. Later working-image
  conversion expands display-sRGB bytes across the full 16-bit range before
  scene-linear conversion: 128 becomes 32896, not a near-black 128 in a 16-bit
  container. Deterministic sizing belongs to the render graph and its shared
  native resampler, independently of adapter normalization.
- **The gap:** The contract assigned frame conversion and adapter-internal colour
  conversion but never spelled out coordinate order, rounding, or sample depth.
- **The reach:** Generate, fill, reimagine and every future external-image
  consumer share correct brightness and colour scaling; a non-Gemini structured
  provider will need its own coordinate converter. Previously generated near-black
  artifacts remain immutable evidence of the old execution.
- **Verdict:** **Sound.** Provider conventions stop at the provider boundary and
  the repository keeps one resize kernel.
- **Confidence:** Medium — geometry is fixture-pinned; live colour and sample
  evidence remain outstanding.
- **Owner:** `packages/providers/src/adapters/{structured,image}.ts`,
  `packages/render/src/fill/external-pixels.ts`.

### S30 — Upload sampling is capped and clipped, and never decides where pixels land

- **When:** Slice 12e2 fill input-size pass; initial cropped-frame fill correction.
- **The choice:** A fill covering a 2048×32 crop sends a 1536×24 image and mask
  by default — the long edge is capped, the short side rounds to the nearest
  whole pixel with a minimum of one, and both uploads share those dimensions —
  while the returned pixels still occupy the full 2048×32 base region. `--full-res`
  skips the reduction. A provider still receives its crop in original coordinates
  even when the available photo is rotated, cropped, or only a reduced offline
  preview: the native sampler borrows the existing buffer, maps each requested
  output sample into it and interpolates, and context the current view cannot
  show is black with zero edit coverage — it never reconstructs a full
  original-sized image merely to make a bounded upload. Visibility is decided at
  pixel centres: a selection pixel is visible when its centre maps inside the
  evaluated frame, a partial intersection succeeds with `mask_clipped`, and a
  wholly invisible selection is a usage error *before* any provider call or new
  revision. After downsampling, the wire mask is clipped again at its own sample
  centres so interpolation cannot mark black padding as editable. The generation
  request stores the sent dimensions, the full-resolution intent and the actual
  sampling map, independently of the placement crop.
- **The gap:** The plan fixed the cap and base-coordinate placement but not
  integer rounding, mask filtering, the subpixel visibility rule, or where to
  retain sampling intent for a later refresh.
- **The reach:** Provider bandwidth and final output geometry have distinct
  owners, so limiting an upload cannot shrink the document or misrepresent
  generated sampling density. Refresh reuses the stored intent; a new fill with
  changed intent cannot reuse the old execution; older recipes without the field
  keep their original full-size sampling.
- **Verdict:** **Sound.** The rule matches the native sampler's own
  inside/outside decision, and original-coordinate placement stays stable without
  pretending unavailable pixels were present.
- **Confidence:** High for coordinates and memory ownership; medium for
  photographic quality at thin mask edges, which needs live evidence.
- **Owner:** `packages/render/src/fill/{external-pixels,mask,pipeline}.ts`.

### S31 — Selection intent and fill coverage are different graph values

- **When:** Slice 12e1 effective-mask integration; slice 12 refresh correction.
- **The choice:** A subject's original selection stays an immutable mask
  ancestor; a derived recipe computes the *expanded or feathered* coverage the
  fill will paint. The explicit fill compositor uses that fractional coverage
  once, while the outer layer uses its binary support — every nonzero sample
  becomes one — so a half-covered edge yields half-strength paint rather than a
  quarter from applying alpha twice. Positioning and the hole left by a moved
  subject use the original selection; coverage and support follow their separate
  ancestry. Relatedly, when a crop hides half a selection, fill edits only the
  visible half and stores that restriction in its effective mask; clearing the
  crop alone does not invent edits in the hidden half, but an explicit
  *regeneration* returns to the original selection intent, can fill both halves,
  and replans the provider crop from the newly visible coverage and the stored
  padding.
- **The gap:** The previous layer and fill compositors used the same mask, which
  hard selections hid; existing refresh requirements did not define partially
  invisible selections.
- **The reach:** Refresh, repetition and transforms recover original intent
  instead of repeatedly expanding a prior result. Old requests without a stored
  padding amount keep their recorded rectangle, enlarged only enough to contain
  refreshed support, rather than guessing a new padding preference.
- **Verdict:** **Sound.** Each mask has one meaning, and transformation must
  precede support derivation so resampling cannot reintroduce fractional coverage
  at the outer compositor.
- **Confidence:** High for the mask split; medium that a regeneration
  deliberately enlarging the edited area after an uncrop is what a user expects.
- **Owner:** `packages/render/src/fill/mask.ts`,
  `packages/render/src/layers/operations.ts`.

### S33 — Paid pixels and the graph revision commit together, and the node pins its execution

- **When:** Slice 12a strict-fill implementation; slice 09a provenance; slice 13a
  standalone generation; combined move/scale pass.
- **The choice:** A provider returns bytes. They are normalized and published
  into the content-addressed artifact store first; then the artifact row, the
  immutable generate execution, the canonical descendants, the replacement layer
  snapshot and the output root all enter the catalog in **one** revision
  transaction, and the prepared execution must be reachable from the resulting
  document roots — retaining an inactive node elsewhere is not enough. A
  malformed or structurally invalid response therefore leaves no catalog
  execution and no new undo state. The generate recipe stores its execution ID,
  so later `show` and `export` reuse those exact pixels and never silently call
  the provider again; a missing generated artifact fails closed rather than
  manufacturing different pixels under the same graph. Standalone `generate`
  extends the same discipline to catalog creation: photo row, locator, the
  `generated` tag, artifact and execution registration, and the first revision
  all commit or vanish together inside the ordinary import transaction, with
  generated locators rooted at the portable library volume. External facts extend
  the *existing* execution record as one nullable, object-constrained JSON column
  holding a bounded whitelist — transport, debug and auth fields are stripped at
  ingestion, and missing or recipe-mismatched provenance prevents a
  generate/upscale success from committing. A combined move that needs new
  density may finish an external upscale before the graph changes; the move
  writer then activates pixels, subject geometry and vacancy together against one
  expected parent revision, and if another edit wins it keeps the returned
  original bytes in the attempt journal and rejects activation rather than
  publishing half a move.
- **The gap:** The graph store previously committed deterministic nodes and
  revisions separately from provider execution recording, the evaluator could
  select an execution only when a caller supplied one, and composing density with
  movement needed an ownership boundary.
- **The reach:** Fill, refresh and every future paid mutation inherit a
  transaction boundary that cannot expose a paid node without its exact output or
  activate a replacement layer piecemeal. Transport credentials are excluded from
  structured provenance; user-authored prompts remain stored as requested. Future
  provenance additions must fit the bounded whitelist rather than create
  another execution identity.
- **Verdict:** **Sound.** Publication stays content-addressed and recoverable
  while all catalog-visible state is atomic.
- **Confidence:** High; medium only in that a byte-identical generated result is
  refused inside the transaction rather than given a distinct duplicate result
  code.
- **Owner:** `packages/render/src/fill/generation.ts`,
  `packages/render/src/graph/store.ts`,
  `packages/commands/src/handlers/generate.ts`.

### S35 — Refresh selects the paid stage to retry and never downgrades a better result on failure

- **When:** Pre-slice-12 unknowns walk; slices 12c2, 12d1, 12d2; outpaint
  refresh/retry follow-up; full-frame pass B.
- **The choice:** A fill's upscale failed, so the branch is active at generation
  density with an `upscale_failed` warning and no failed node in the graph.
  Retrying inspects only the active layer's canonical branch — generate, optional
  upscale, exact resample/place, zero-feather mask composite — and reuses the
  exact generation execution when the instruction matches; an upscale cache
  additionally requires the current adapter, version, model and guarded-prompt
  identity to match, and the retry restores the composite's original base input
  rather than editing the already-composited layer. If an *explicit upscale*
  refresh then fails, the layer keeps its previous, sharper purchase rather than
  reverting to the smaller generation, and the response marks the retained result
  as reused so it never implies the failed call produced those pixels.
  Generation refresh instead rebinds to the current develop root and rebuilds
  descendants, so a brightness change followed by regenerate is visible to the
  provider; one affine rebuilder composes generation placement and the permanent
  mask into one coordinate space, which **supersedes** the earlier bounded
  refusal of transform-before-fill ancestry. Full-frame refresh reuses an
  unchanged viewport recipe verbatim so verified retained pixels stay reachable,
  and only normalizes geometry when the crop actually moved. Compatible later
  develop changes may add deterministic compensation to old generated branches;
  incompatible ones make the old lineage explicitly stale. `executed` describes
  whether the committed graph path uses an upscale node, while
  `executions[].reused` says whether this request paid.
- **The gap:** A flat refresh record cannot express which expensive stage to
  rerun; the plan defined first-time and transform-driven upscale failure but not
  failure while refreshing an already successful upscale; and it never said how
  broadly to search history or which recipe fields distinguish a photoctl fill
  from a user-authored graph with similar topology.
- **The reach:** Retrying cannot reinterpret arbitrary generate ancestors, stack
  the same fill repeatedly, or reuse pixels produced by a stale adapter or prompt
  contract. Failure recovery, cost, stale warnings, undo and strict compositing
  all become precise. Mask exactness is proved at the mask-composite boundary
  against that node's base input, not against a final output that may contain
  later global edits.
- **Verdict:** **Sound.** The system retains paid successful work without
  claiming a failed enhancement happened.
- **Confidence:** High; medium only that a future product decision might make
  explicit refresh failure hard, which would change the established
  soft-success contract.
- **Owner:** `packages/render/src/fill/{refresh,reuse,branch}.ts`,
  `packages/render/src/full-frame-refresh.ts`.

### S36 — Full-frame verbs share one external owner, and their controls are guidance *and* exact coverage

- **When:** Slice 13a reimagine and relight; per-command override completion,
  2026-09-08.
- **The choice:** `reimagine` and `relight` call the same generation publication,
  provenance, density planning, upscale execution and fallback owner as `fill`;
  each owns only its own request shape and layer projection, so provider and
  failure semantics cannot drift between copies. `reimagine` resolves the
  library's *edit* model purpose — not the standalone generate purpose — because
  it posts source pixels to the image-edit route. `--strength` is bounded to
  `0..1` (default 1) and does two things at once: it appears literally in the
  versioned prompt telling the provider how much composition and identity to
  preserve, and it becomes the coverage of a permanent whole-frame mask in the
  compositor, so the pixel effect is observable even if the model ignores the
  prose. `relight` reuses that entire response shape, replacing `strength` with
  azimuth (0–360°), elevation (−90–90°) and intensity (0–1), all validated before
  a request is opened; at intensity zero photoctl still records the requested
  provider operation as a removable layer while rendering the current pixels
  exactly. During a long generation-and-upscale sequence both emit five-second
  progress heartbeats that are best-effort and can never turn a committed
  revision into a reported command failure. All four generative verbs — `fill`,
  `generate`, `reimagine`, `relight` — now accept `--upscale`, `--no-upscale` and
  `--upscale-model`, forwarding request intent into the shared density policy;
  contradictory flags are a usage error before the library opens. Standalone
  `generate` remains deliberately opt-in rather than `auto`, because a source-less
  generation has no destination density to match.
- **The gap:** The first implementation draft copied the fill planner into a
  second module; the gateway image route has no portable native strength control,
  yet the public option still needs deterministic pixel semantics; and the global
  rule stated the upscale precedence without naming which verbs carry the flags.
- **The reach:** Provider requests, graph identity and rendered pixels all record
  the user's control values. A future adapter-native strength control requires a
  prompt-recipe version change but cannot silently remove the graph-owned blend.
  Adding the per-command flags introduced no new provider, schema or consent
  mechanism — request precedence and configured-provider consent stay with the
  existing fill policy.
- **Verdict:** **Sound.** Provider guidance influences generation; the graph-owned
  blend makes the public contract observable; and one shared owner keeps failure
  semantics identical across the verbs.
- **Confidence:** High; medium that both azimuth 0 and 360 remain accepted as
  equivalent physical inputs.
- **Owner:** `packages/render/src/reimagine.ts`,
  `packages/commands/src/handlers/{reimagine,relight,generate,full-frame-generation}.ts`,
  `packages/providers/src/prompts/{reimagine,relight}.ts`.

### S37 — Full-frame refresh may run entirely on retained pixels when the source is gone

- **When:** Full-frame pass B, 2026-09-06.
- **The choice:** The original file disappears, but a small pinned preview and a
  previously rendered full-resolution version of the same photographic input
  remain. Generation prefers the verified native retained render over the smaller
  preview; with no decodable source at all it may use that exact retained input;
  reconnecting tries the live original first. Because the new combined output has
  never been rendered, `show` and `export` get one final evaluation policy after
  their normal source attempts fail: reuse verified retained executions at their
  exact graph nodes, then run only the deterministic descendants such as
  compositing — using a node's own saved result means earlier layers are not
  applied twice. A missing *paid* result is an error, not permission to invoke
  its provider. Missing or corrupt pinned execution bytes report `file_offline`
  with a structured `retained_artifact_unavailable` reason, reusing the
  established unavailable exit class rather than misreporting a decoder failure
  or a data lookup failure.
- **The gap:** The spec required the complete retained-only lifecycle, but the
  existing reader could reuse only a finished current output and could not create
  the first new composite without descending to the unavailable original;
  retained-only support also never said how it ranks against a usable but smaller
  pinned fallback.
- **The reach:** This is an explicit policy on the existing evaluator, not a
  second evaluator or source type; its public entry accepts no source or provider
  callbacks. The exact execution source tier travels with the pixels into preview
  metadata, so retained *generated* detail can never claim the original source
  was native. Missing or corrupt retained input cannot authorize a replacement
  purchase.
- **Verdict:** **Sound.** The existing registry, cache identity, frame validation
  and store own every evaluation; only the permitted source of reusable
  deterministic inputs changes.
- **Confidence:** Medium for the retained-graph evaluation policy; high for the
  fallback ranking and the typed unavailable error.
- **Owner:** `packages/render/src/full-frame-refresh.ts`,
  `packages/commands/src/graph-source.ts`.

### S39 — Auto-enhance is a clamped structured proposal, not a second editing engine

- **When:** Slice 13b auto-enhance implementation and independent review.
- **The choice:** `develop --auto` fetches a 1024-pixel-long-edge JPEG through
  the ordinary `show` preview path — joining the same single-flight
  materialization as any other request rather than opening a second render path —
  and computes seven statistics with pinned conventions: preview bytes are
  treated as encoded sRGB, luminance and the gray-world mean are computed after
  decoding that transfer function to linear light, the mean goes through the
  standard matrix and a named correlated-colour-temperature estimator, saturation
  stays encoded-sRGB HSV, percentiles use type-7 linear interpolation, and
  clipping counts the exact black and white endpoints. It then asks a structured
  model for a non-empty subset of eight develop paths; the numbers are clamped by
  the narrower automatic range table (exposure to `[-2,2]`, most notably) and
  serialized as one ordinary develop `--set` batch, so all final validation,
  graph mutation, layer compensation and staleness stay with the existing develop
  owner and automation can never widen manual editing. The revision records
  adapter identity and version, the fixed model, the provider request ID, attempt
  count, prompt version, dimensions and the exact statistics — and does not invent
  cost or duration fields the structured adapter does not return. `--undo-auto`
  accepts only the active revision carrying its versioned marker and *always*
  authors a new revision without the marker, even when the restored dictionary is
  byte-for-byte identical, so a later manual edit makes an older marker
  ineligible and one undo consumes exactly one automatic edit. Undoing from C to
  an auto-enhanced B and then invoking `--undo-auto` produces a new revision D
  and clears the redo path to C, while C's history and purchased artifacts stay
  retained; ordinary `undo` can then undo D.
- **The gap:** The proposal contract named the statistics but not their transfer
  space, quantile convention, saturation model or temperature estimator, and
  required storing and restoring the pre-automatic state without defining marker
  identity, lifetime or no-op consumption.
- **The reach:** The seven-field input is deterministic across future
  implementations. Provider or schema failures leave the active revision pointer
  unchanged; successful no-op proposals stay auditable; this introduces no second
  history engine.
- **Verdict:** **Sound.** Partial conservative proposals are useful, the narrower
  automated policy cannot widen manual editing, and the behavior follows the
  existing immutable-revision and compare-and-swap ownership.
- **Confidence:** High; medium that the structured adapter may later expose
  shared cost and duration telemetry worth recording.
- **Owner:** `packages/commands/src/handlers/develop-auto.ts`,
  `packages/providers/src/{adapters/structured,prompts/auto-enhance}.ts`.

### S40 — Live probes are opt-in per purpose, and their evidence never becomes acceptance

- **When:** Slice 09b evidence surfaces and reviews; upscaler report contract and
  reuse passes, 2026-09-06.
- **The choice:** An ordinary gateway key in the shell starts *no* experiment.
  The embedding smoke requires its own purpose-specific key for that invocation;
  with no such key it exits successfully and writes a machine-readable
  `not_run:unconfigured` record, while a configured-but-failed run exits nonzero
  *and* writes a rejected record — so automation can tell "not authorized to run"
  from "authorized but broke". Acceptance is defined narrowly: exactly one finite
  3,072-number vector for one item containing a text part and an inline JPEG,
  because the product needs one searchable vector per photo, not two unrelated
  vectors or a provider's smaller default. On success the evidence keeps the
  request structure but replaces the JPEG bytes with their digest; on rejection
  it keeps no request fixture; a 200 response of the wrong shape records the item
  count and the first eight observed vector widths rather than copying an
  unbounded response into durable evidence. The upscaler spike likewise takes an
  operator-supplied JSON manifest that changes one variable per comparison and
  never fills in creativity or resemblance values itself; it identifies paid work
  by source bytes plus adapter/model/version plus exact prompt and controls, so a
  second inspection crop of the same image is free; it validates every input —
  including a full decode, since reading PNG dimensions does not prove the
  compressed pixels decode — before the first paid call; it stops spending on the
  first failure with no automatic retry or partial continuation; it marks a
  started run `running` and replaces a stale verdict rather than leaving
  yesterday's success beside today's failure; and it records mean absolute
  per-channel pixel drift as telemetry only. Where two outputs have different
  rasters there is no honest alignment, so drift is reported as absent with an
  explicit reason rather than as a computed score. Declared source categories
  ("this crop is hair") are recorded as operator declarations, never as
  recognition. Fake outputs are always labelled fake.
- **The gap:** The plan prohibited ambient credentials from becoming consent but
  chose neither the operator-facing key names, nor the exit/evidence behavior for
  configured failures, nor what qualifies as acceptance, nor how the runner
  isolates a comparison variable.
- **The reach:** Developers keep general provider credentials in their
  environment without accidentally uploading a photo or spending money during
  routine gates, and CI treats an absent optional experiment as green while still
  noticing a broken one somebody explicitly asked to run. A contact sheet can
  never silently become proof of photographic preservation or provider settings.
  Manifest control ranges are a runner restriction, not a provider guarantee; a
  future live adapter must establish its own control units first.
- **Verdict:** **Sound.** Purpose-specific credentials make consent observable,
  and refusing to turn telemetry into a quality score avoids an automated product
  choice.
- **Confidence:** High on the consent and evidence mechanics; medium that the
  candidate embedding dialect and the control ranges survive contact with a live
  provider.
- **Owner:** `scripts/{smoke-embed-shape,smoke-mask-polarity}.mjs`,
  `apps/workbench/` upscaler spike, [provider invariants](README.md#providers-and-cost).

### S41 — Keyless journeys and developer reports state exactly what their fixtures can establish

- **When:** Slice 12d2 agent-preview integration; slice 12d workbench fill;
  release report integration; `wb masks` and `wb ab` reports.
- **The choice:** The mandatory real-CLI editing journey uses a code-generated,
  asymmetric high-resolution raster with stable subject, detail, anchor and
  protected-pixel facts, and accepts the fake provider's intentionally flat
  replacement as a deterministic *state transition* — then judges placement,
  linear-light opacity, preview reuse, provider request counts and export
  identity independently. It never treats the synthetic fill as an aesthetic
  oracle. The developer fill report may execute the graph's *deterministic* steps
  (exact resampling, strict mask compositing) by following the fill execution's
  input hashes back to cached content-addressed artifacts, while paid generate
  and upscale nodes can only load the exact output pinned in their immutable
  execution record — if that cache is missing the report refuses, which makes the
  provider boundary mechanically unreachable from inspection. It also refuses a
  branch whose mask has since been transformed, rather than drawing an old
  base-space crop over transformed pixels. The mask report compares committed
  masks against the highest-area available execution of the current develop root,
  breaking ties by creation time, and explicitly disclaims knowing which cached
  tier a previous `show` reused. `wb ab` says outright that only pixel dimensions
  were verified — source, framing and encoding must come from capture provenance.
  The release gold report includes only the files the exam actually returned,
  uses relative links so the bundle can move without re-encoding JPEGs, defaults
  source classification to unverified even when an operator declares a real
  drive, and labels collision-skipped exports as unverified against the requested
  render.
- **The gap:** A keyless provider can prove orchestration and pixel ownership but
  cannot stand in for a live model's perceptual behavior; and none of these
  reports had a defined membership, cache policy or provenance claim.
- **The reach:** The full local journey catches stale previews, repeated paid work, coordinate drift,
  cache contamination, incorrect blending and stale exports without credentials
  or lucky sampled content, while live visual review retains one clear variable
  instead of inheriting false confidence. Checksums detect later byte changes but
  certify neither photographic quality nor source authenticity.
- **Verdict:** **Sound.** Each artifact's claims stop at the boundary its inputs
  can actually establish.
- **Confidence:** High for state, cache and export continuity; deliberately none
  for live aesthetics, and medium that a human still has to choose the most
  useful detail crop.
- **Owner:** `apps/workbench/`, `scripts/gold-exam.sh`,
  [gold report](assets/gold-report/), [agent preview loop](assets/agent-preview-loop/).

### S44 — Historical execution coordinates are recovered only when retained ancestry agrees

- **When:** Shared realized-frame implementation, 2026-09-05.
- **The choice:** An old execution row predates coordinate metadata. When it
  points at an input image shared by several historical runs, recovery compares
  their frames — the source dimensions and the mapping that locate those pixels
  in the original photo. If every candidate agrees, the recovered frame is saved
  on the old row; if they disagree, recovery reports ambiguity rather than
  borrowing the newest run's coordinates and silently moving a selection.
  Inspection stops at 64 candidates per input and 256 distinct executions
  overall. A preview that already has its own valid saved frame needs none of
  this and stays usable offline.
- **The gap:** The approved execution-metadata contract left historical recovery
  and its work limits open.
- **The reach:** A retained execution missing its optional frame can be inspected
  without replaying paid generation. This is not a promise to migrate old schemas. Very
  large or ambiguous historical graphs may require a fresh deterministic
  evaluation instead. The numeric limits are operational policy, not evidence of
  ambiguity.
- **Verdict:** **Sound.** Missing history must not become invented geometry, and
  an ordinary preview must not trigger unbounded database work.
- **Confidence:** Medium — the limits may need adjustment against real libraries.
- **Owner:** `packages/render/src/graph/projection.ts`.

### S46 — Revisions are root-complete, lazily created, and nothing is collected automatically

- **When:** Slice 08a1 implementation review; slice 08a2 preview and inspection
  integration; retention policy carried forward.
- **The choice:** A revision commit accepts caller-chosen batch-local keys for
  new nodes, so a caller can submit output → develop → source in any array order;
  the writer resolves the graph from the final typed root, refuses cycles and
  missing or cross-photo references, and rolls back if any supplied draft is not
  reachable — a second unused crop node cannot quietly attach itself. Every node
  kind has a strict parameter schema from the start, with kinds whose command
  arrives later exposing only their minimal structural fields so unknown
  top-level fields fail rather than entering a recipe. An ordinary imported photo
  acquires one immutable source→output revision the first time
  a graph-aware command needs it, with concurrent initializers converging on the
  winner's revision, rather than eagerly creating edit history at import. Paged
  graph inspection binds its opaque
  cursor to the photo, the inspected revision, the history mode and the last node
  identity; if a newer revision becomes active between pages, later pages
  continue the *original* revision rather than failing or switching state.
  All retained document revisions and provider-image attempts contribute artifact
  roots. Availability checks mark missing or corrupt files unavailable; reachability
  itself does not remove them. No automatic canonical-artifact deletion or numeric
  undo/age/storage limit is implemented or authorized by measurements alone.
- **The gap:** The atomic batch contract never defined how nodes created in one
  transaction refer to each other or whether unrooted drafts are legal; the
  schema introduced graph tables without backfilling; the pagination contract
  required revision binding without choosing continuation versus stale-cursor
  refusal; and retention limits were explicitly deferred.
- **The reach:** Develop, crop, layers and every future multi-node mutation get
  one stable request shape with no provisional node IDs, and failed requests
  cannot accumulate unreachable metadata. Disk grows without bound until a limit
  is chosen; that is the deliberate current state, and this ledger records no
  authority to add automatic collection or a retention cap.
- **Verdict:** **Sound.** Local keys are transaction-scoped addresses, lazy
  creation is deterministic and compare-and-swap protected, immutable revisions
  make cursor continuation both simpler and more useful than invalidation, and
  measurement precedes deletion policy.
- **Confidence:** High for the writer and cursors; medium for retention, which is
  an open measurement rather than a settled design.
- **Owner:** `packages/render/src/graph/{store,inspection}.ts`,
  `packages/render/src/artifacts/availability.ts`.

### S48 — Rendered previews are lazy, versioned, single-flight views of committed edit state

- **When:** User-directed preview amendment, 2026-09-04; slice 03a lifecycle;
  slice 12d preview foundation; cheap source-overview integration, 2026-09-06.
- **The choice:** Import keeps one immutable pinned source preview for offline
  recovery. Edited previews are separate, prunable JPEGs keyed by the canonical
  edit state and the viewport. A pixel-affecting command commits state and
  returns the new render hash *without* rendering; the next `show` lazily creates
  one full-frame display master for that render state, and crops and smaller
  views derive from the master without reevaluating the graph. Before promoting
  to a master, an existing full-frame view may feed a crop only when it really
  contains enough pixels at that region's scale; the default 1616-pixel overview
  stays cheap and does not force a full-resolution render. Concurrent requests
  for the same photo, render state and artifact join **one** materialization: one
  evaluation runs, every waiter receives the same validated artifact, and a
  failure clears the flight so a later request can retry. The path is leased
  while in flight, `cache prune` skips leased paths and anything used within the
  preceding 30 minutes, and `last_used` updates only after the returned file is
  readable — so an agent can compare two returned preview paths without a
  concurrent prune invalidating them. A derived preview is two files, the JPEG
  and a small sidecar naming its source tier and dimensions; the sidecar also
  carries the JPEG's digest, which is recomputed on read, so a crash between the
  two renames produces a detectable cache miss instead of an old explanation
  blessing new pixels, and cache accounting charges both files. Reusing a valid
  master repairs a missing index row rather than leaving a valid orphan invisible
  to the storage budget. A freshly imported photo's default overview may be
  encoded straight from its pinned import JPEG — but only when the active graph
  is exactly source followed by display output with no geometry; an explicitly
  empty develop node or a disabled-layer graph still runs ordinary evaluation,
  because looking empty in a summary does not prove no pixel operation exists.
  Even that cheap path checks the catalogued locator through the existing source
  resolver, warns truthfully, and publishes through the existing preview
  coordinator rather than returning the pinned file directly.
- **The gap:** The plan exposed the pinned import preview but never defined how
  an agent sees develop, layer, fill, retouch or markup changes before export,
  nor the concurrency and prune interaction, nor how two separately renamed files
  prove they belong to one completed write, nor how to prove a cheap overview is
  eligible.
- **The reach:** Every pixel mutation contributes its canonical inputs to the
  render hash, so a new edit or viewport produces a new path rather than
  overwriting inspected pixels. Export snapshots and reports the same render hash
  at command start but renders from the graph, so preview and export cannot
  silently refer to different edit states — preview pixels are review-sized, not
  export truth. Every future preview producer inherits this lease protocol.
- **Verdict:** **Sound.** A per-state full-frame master makes the
  overview → detail → zoomed-out loop cheap while the sufficiency check prevents
  a small overview from masquerading as full-resolution detail.
- **Confidence:** High; medium only for the intentionally narrow eligibility of
  the cheap overview shortcut.
- **Owner:** `packages/render/src/{preview,preview-coordinator,preview-artifact}.ts`,
  `packages/importer/src/cache-prune.ts`.

### S49 — One coordinate frame, one preview colour, one preview quality

- **When:** Slice 01b coordinate ownership and preview-contract correction;
  preview fidelity correction, 2026-09-07.
- **The choice:** Coordinates are oriented, uncropped, top-left base pixels
  measured along image *edges*, so the top-left is `[0,0]` and a bounding box
  transforms all four of its edges before its new origin and size are computed.
  One small transform record — a quarter-turn plus an optional reflection —
  serves both the coordinate functions and the pixel decoder, so an orientation
  fix in rendering cannot leave editing coordinates behind. A viewport is a
  half-open interval: `[-50,0,100,100]` asks for pixels from 50 left of the image
  through pixel 49 inside it, so the returned region is `[0,0,50,100]`, with
  fractional outer edges rounded outward before intersection. Clamping a negative
  origin while keeping the width would silently move the request and return
  pixels the caller never selected; a wholly non-visible region is a usage error.
  Every source preview, display master and derived view is an
  orientation-applied, opaque JPEG tagged with the bundled sRGB profile, encoded
  at quality 88 with a colour sample per pixel (4:4:4) rather than colour shared
  between neighbours — a thin blue detail beside red used to read as purple in a
  new preview even though the stored render still held distinct colours. New
  previews may be larger; existing cached previews stay usable until ordinary
  regeneration, with no purge, identity change or migration, because rejecting
  old high-resolution previews could reduce offline availability when only a
  smaller pinned source remains.
- **The gap:** The plan fixed the eight orientations and the box shape but not
  edge-versus-centre coordinates, fractional clipping, or preview colour
  sampling; raising JPEG quality alone would have kept the spatial colour
  averaging, and switching to PNG would change the public JPEG contract.
- **The reach:** Crop, segmentation boxes, masks, layer transforms, markup and
  render orientation inherit one base coordinate space, and UI clicks and
  agent-selected regions share it even after crop, rotate and straighten.
  Inspection never depends on an application guessing the preview's profile.
- **Verdict:** **Sound.** Outward edge rounding preserves every pixel the
  requested rectangle touches, and fine colour is preserved at the encoding
  boundary without changing source pixels or editing semantics.
- **Confidence:** High; medium for leaving existing caches unchanged, whose older
  appearance persists until regenerated.
- **Owner:** `packages/render/src/{coordinates,preview}.ts`.

### S51 — Metadata ownership at the import boundary: parse at the file, orient in render, refuse only what is structural

- **When:** Slice 01b importer, render-owned and library passes.
- **The choice:** A portrait photo can store its pixels as a landscape rectangle
  plus an orientation number saying how to rotate them. The importer reports that
  stored rectangle and the number separately, and the import command asks render
  for the oriented dimensions before writing the photo row — rather than importer
  and render each deciding which orientations swap width and height and
  eventually disagreeing. Descriptive metadata is nullable: a supported JPEG or
  TIFF with no lens, camera, exposure or timezone stays a useful photo, and the
  photo row always has camera and exposure objects that may simply be empty, so
  readers never juggle missing/null/empty. Width and height are different —
  without them there is no base coordinate space for render, crop, masks and
  export, so that file is refused as unsupported. Structural facts are checked
  strictly: byte size cannot be negative, displayed dimensions must be positive,
  and orientation must be one of the eight legal values. The preview-source pixel
  type is explicit too: three unsigned 16-bit channels per pixel in RGB order,
  *full range* so JPEG white is 65535 rather than 255 sitting inside a larger
  integer, tagged as display-referred rather than the scene-linear data later
  decoders produce — the encoder's plain 16-bit cast kept 8-bit values, which
  would have looked correct in TypeScript while giving compositing 1/257th of the
  expected range. The command resolves sources and evaluates the selected image.
  The delivery encoder receives oriented display-sRGB RGB16 pixels, a final output
  path and delivery options; it never opens the catalog or resolves mounts.
  The command owns directory creation and collision-policy orchestration.
- **The gap:** The plan named the columns, the pixel type and the two owners, but
  specified neither nullability, defaults and checks, nor whether the EXIF reader
  returns stored or oriented dimensions, nor the pixel buffer's layout, range and
  colour-space tag, nor the data crossing the export boundary.
- **The reach:** Every import format and every `show` response inherits the
  distinction between an unknown descriptive fact and an invalid structural one.
  Later slices could change catalog transport and add export templates without
  touching the pixel graph or adding a second source resolver.
- **Verdict:** **Sound.** Pixel geometry is a functional requirement while camera
  annotations are not, and parsing stays at the file boundary with geometry in
  the module that owns coordinate transforms.
- **Confidence:** High; medium on nullability, which is a schema shape a future
  reader may want expressed differently.
- **Owner:** `packages/importer/src/`, `packages/render/src/coordinates.ts`.

### S53 — One native colour core in a fixed scene-linear order

- **When:** Slices 08c1b, 08c2, 08c3, 08d1, 08d2, 08d4 and the selective-colour
  closeout.
- **The choice:** One native develop owner processes the exact linear artifact
  samples in a fixed order: white balance and opponent
  cast, brightness and black point, exposure, contrast about middle gray,
  luminance-preserving saturation, then the masked tonal controls (shadows,
  highlights, saturation, vibrance), levels, curves, local contrast, noise
  reduction, selective colour, vignette, black-and-white, named filters, and
  geometry last. TypeScript validates the dictionary and transports the float
  buffer; it owns no parallel grade. The formulas are ported from OpenColorIO's
  permissively licensed scene-linear renderer rather than linked. Specific calls
  inside that order: neutral is D65 and a positive temperature means visually
  warmer, bounded to 1667–25000 K, so zero is anchored exactly and continuously;
  levels map black to zero and white to one then apply reciprocal midpoint gamma,
  continuing with a sign-preserving power outside that range instead of clipping
  away recoverable highlights and negative working values; a curve point such as
  `[0.5,0.6]` is UI-normalized data mapped onto the operator's log domain, fitted
  with its monotonic spline, channel curves before the master curve, with values
  beyond the end points following the endpoint tangent; vibrance converts to
  sRGB-like primaries *only to classify hue* before attenuating the boost in a
  warm band, which is deterministic colour-only protection and not face or skin
  detection; selective colour treats its seven names as centres on the
  working-space hue wheel with smooth interpolation and red wrapping at zero,
  leaving achromatic pixels untouched and blending out-of-gamut targets back
  toward the original colour at the same luminance; a present black-and-white
  object activates monochrome mode even when its only control is zero, so
  removing the object restores colour and no fifth hidden control is needed; and
  noise reduction runs luminance before chroma in one fixed order, streamed in
  bounded row blocks with a cached margin sized by the search plus patch radius,
  so a full-resolution RAW uses scratch space proportional to width rather than
  to height.
- **The gap:** The plan named the operators, their masks and "one Rust owner",
  but delegated cross-operator order, UI normalization constants, sign
  conventions, extended-range behavior, hue coordinates, activation rules and the
  streaming strategy.
- **The reach:** Presets, copied develop dictionaries, in-memory previews,
  canonical artifacts, previews and exports share one deterministic meaning;
  reordering anything later intentionally changes rendered identity. Curve outputs
  must be non-decreasing because that is the spline's contract.
- **Verdict:** **Sound.** One owner, the authoritative operator's own
  scene-linear path, and no clipping before the display boundary.
- **Confidence:** High for the math and ordering; medium for product feel until
  broader preset and portrait fixtures exist, and medium that hue protection can
  also affect warm non-skin colours.
- **Owner:** `crates/photoctl-image/src/develop/`, `packages/render/src/develop/`.

### S54 — The develop dictionary is the mutation vocabulary; provenance is recorded but not hashed

- **When:** Slice 08b command, node, preset and schema integration; original
  filter verb completion, 2026-09-06.
- **The choice:** `develop --preset people` stores the *resolved* settings plus
  the preset name in the typed node, but the develop hash excludes the name, so
  two photos that end up with identical settings share one settings identity
  regardless of how they got there — while the logical node recipe still records
  the name, which means applying an alias with identical values can produce a
  different output render hash. One invocation may compose several operations,
  and their order is fixed by the command rather than by argument spelling: it
  selects its base first (`--copy-from` source, otherwise the target's current
  state), then applies `--reset`, then the named preset, then explicit `--set`
  assignments, then `--unset` paths — producing one classification and at most one
  immutable revision, and returning current hashes with no new undo entry when the
  fully resolved dictionary already equals the target state. `presets save`
  writes resolved settings (excluding prior preset provenance) to a library file
  published by temporary-file, fsync, rename and directory fsync, so a daemon
  cannot observe a half-written file and a library preset shadows a package
  preset of the same name. Nested values use one normalized JSON vocabulary —
  ordered `[input,output]` curve points normalized 0–1, `{black,midpoint,white}`
  levels, named selective-colour bands with bounded adjustments, base-pixel crop
  rectangles, positive `W:H` aspect, fixed filter names with bounded strength.
  The public `filter` verb validates its single-photo syntax and then performs the
  same two assignments as `develop`, returning that command's one-item envelope
  including layer compensation and stale warnings, so asking both forms in
  succession adds only one revision.
- **The gap:** The plan required retaining the preset name while excluding it
  from the hash without saying where provenance belongs; it ordered a preset
  before explicit sets without fully ordering copy, reset and unset; it named the
  preset locations without defining save collisions, inheritance or crash
  ordering; it fixed the operator keys without completely specifying nested JSON;
  and it chose the filter verb's two stored keys without saying whether it needed
  its own response or mutation.
- **The reach:** CLI parsing, presets, canonical hashes, future native operators,
  XMP mapping and graph validation all inherit these shapes. Scripts, retries,
  undo and layer-staleness classification get one deterministic result
  independent of CLI spelling, and idempotent replay cannot manufacture edits a
  photographer never made. Anything wanting provenance-sensitive caching must add
  a field rather than reuse the develop hash.
- **Verdict:** **Sound.** One strict normalized representation makes invalid
  recipes unrepresentable, a copied state is naturally an input, destructive
  reset is explicit, and the most specific requested edit wins last.
- **Confidence:** Medium — the harmless cache split from preset aliases, and the
  fixed filter/selective-colour vocabularies, are tradeoffs worth revisiting if
  aliases or new operators become common.
- **Owner:** `packages/render/src/develop/{dict,hash,presets,state}.ts`,
  `packages/commands/src/handlers/{develop,filter}.ts`.

### S55 — Geometry projects base-space requests through one affine owner, validated before commit

- **When:** Slice 08d3 geometry implementation and command integration; slice 8e
  local horizon.
- **The choice:** A crop is resolved in the photo's oriented uncropped base
  space; an optional aspect ratio keeps the largest centred rectangle inside it;
  photoctl maps that continuous rectangle onto the nearest whole-pixel output,
  applies an exact quarter-turn, then straightens around the new centre and
  returns the largest centred rectangle that fits inside the rotated pixels, so
  no empty black corners appear. The same composed matrix maps a base-space
  `show --region` request into the developed raster and maps clicks back, while
  the caller's original base-space request — not the internal projected rectangle
  — remains the view identity. When only a smaller embedded or pinned source is
  available, catalog-space crop coordinates scale to that source before the same
  plan runs. A crop that would leave the photo edge fails as `usage` *before* a
  revision is written, while independent photos in the same batch continue, so an
  active revision that cannot render never exists. Auto-straighten reduces the
  saved photographic output with the existing native resampler, converts to
  display RGB, and runs its line search in a native background worker rather than
  on the daemon's JavaScript thread — analysing the visible contrast the image
  actually presents rather than linear scene energy, and receiving the real
  frame's direction mapping so pixel rounding does not become a different
  physical tilt.
- **The gap:** The plan fixed the coordinate space, operator order and exact
  rotations, but not fractional crop rasterization, aspect anchoring, straighten
  canvas bounds, whether projected cache identity exposes internal coordinates,
  when crop bounds are checked, or where the line detector runs and in which
  luminance domain.
- **The reach:** Develop, canonical artifact dimensions, online and offline
  previews, view-cache reuse and future mask/layer consumers inherit one geometry
  plan. A request wholly outside developed pixels is a usage error; a partial one
  reports its actual base-space intersection. Display-contrast edges may vanish
  after photographic edits, correctly leaving less evidence — this is not
  semantic horizon recognition.
- **Verdict:** **Sound.** Centred maximal crops are deterministic and reversible,
  trimming prevents synthetic borders, base-space view identity preserves the
  public coordinate contract, and the catalog already owns the dimensions needed
  for deterministic pre-commit validation.
- **Confidence:** Medium for aspect anchoring and display-contrast weighting;
  high for the single owner and the pre-commit check.
- **Owner:** `packages/render/src/develop/{geometry,horizon}.ts`,
  `packages/render/src/transforms.ts`.

### S57 — Masks are their own typed artifact carrying their authored footprint

- **When:** Slice 10b2 mask artifact, transform and review passes; authored
  mask-frame integration, 2026-09-06.
- **The choice:** A mask is an uncompressed little-endian single-channel IEEE
  float TIFF with black-is-zero photometry, no colour profile, coverage samples
  constrained to `[0,1]`, and its own dedicated media type, so an RGB artifact
  can never pose as coverage and publication or restore validates the contract
  rather than accepting any TIFF whose dimensions happen to match. A permanent
  manual or model selection is a deterministic node whose only parameter is the
  full mask-artifact hash and which has no graph input — the node says "this
  exact saved coverage image", not "run segmentation again" — and the revision
  writer refuses a snapshot whose permanent pins are not published and available.
  If the evaluator's validation rejects a pinned mask's bytes, it clears that
  artifact's availability before returning the error, matching restore
  reconciliation instead of trusting a stale catalog claim. Crucially, a mask
  belongs to the frame it was authored in: a retouch circle placed on an
  expanded, rotated photograph is located by its own placement transform, and
  during composition coverage is projected from that recorded frame and clipped
  to *both* the mask's and the covered image's real footprints — otherwise
  filtering can reveal pixels outside the area either input actually supplied.
  Binary support for already-covered RGB is derived only after projection. Mask
  transforms reuse the same coordinate owner as RGB and then clamp filter
  overshoot back to legal coverage, and composition skips the write entirely when
  effective alpha is zero so the accumulated sample keeps its exact bits. Manual
  box and brush masks use pixel-centre coverage: a box is half-open with left and
  top edges included, a brush is a closed polygon filled by the even-odd rule at
  the same centres, coordinates outside the image are harmlessly clipped by
  rasterization, and normalized coordinates must lie in the unit interval before
  scaling. **Recorded storage cost:** a permanent mask is currently stored at the
  whole logical raster, so a single small retouch circle on a full-resolution
  frame publishes roughly four bytes per photo pixel; with automatic collection
  disabled by policy, many retouches accumulate. This is a recorded tradeoff and
  an input to the still-open retention measurement — not a demonstrated
  correctness failure, and not authority to redesign mask storage or to add a
  collection policy during closeout.
- **The gap:** The plan fixed the semantic sample type and required a distinct
  deterministic artifact, but chose neither the byte layout and media type, nor
  the node's parameters and arity, nor how a signed kernel's overshoot is
  reconciled with coverage, nor edge inclusion and fill rules, nor what raster a
  permanent mask is stored at, nor how a mask carries an expanded photographic
  footprint.
- **The reach:** Artifact hashes, node pins, evaluator dispatch, restore repair
  and every manual or model-produced mask share one unambiguous identity. Retouch,
  ordinary layer composition and canvas composition share the existing
  frame/projection owners with no retouch-specific compositor. Transparent areas
  of later layers cannot perturb earlier results in the ordered fold. A cropped
  or bounded mask raster remains a possible later optimization located at the
  mask-authoring owner, where the placement transform already exists.
- **Verdict:** **Sound.** The layout is minimal and deterministic, the general
  authored-support contract covers cropped, rotated and expanded inputs without a
  dimension-based special case, and clamping belongs at the mask boundary.
- **Confidence:** High for the format, projection and exactness; medium for the
  full-raster storage cost, which is explicit and unoptimized.
- **Owner:** `packages/render/src/{mask-tiff,mask-operations}.ts`,
  `crates/photoctl-image/src/mask.rs`, `packages/render/src/retouch.ts`.

### S58 — Layers are ordered roots into the graph with lineage-derived compatibility

- **When:** Slice 10a document writer and vocabulary; slice 10b3 compensation;
  slice 10c1 commands; combined move/scale pass, 2026-09-06.
- **The choice:** A layer identity is a UUID allocated only *inside* the revision
  transaction that stores nodes, the complete stack and the new active revision,
  so a stale caller leaves no orphan identity behind. A caller changing only the
  graph may omit the stack and the writer copies the previous snapshot forward,
  while passing an explicitly empty list clears it — so a base edit cannot make
  two subject layers disappear, and `layer clear` still means what it says. A
  vacancy is the only role permitted to point at another layer, and only at a
  subject in the same photo. A delta node consumes one RGB input and stores the
  *same* validated develop dictionary rather than a parallel adjustment schema.
  An absolute transform compiles to one scale-then-rotate-then-translate matrix
  about its resolved anchor and replaces the prior matrix; a relative one
  pre-multiplies it, so a nudge composes in the oriented base frame rather than
  in the layer's already-transformed axes; with `--norm`, an anchor is a point in
  the unit interval while a displacement is a *signed* image fraction from −1 to
  1, because a displacement is a vector, and scale and rotation are dimensionless
  and unaffected. `layer reorder --to 1` moves a layer to the back, matching the
  directional forms, while the response still exposes canonical zero-based
  ordering. Opacity is stored at double precision so a value like `0.123456789`
  survives a snapshot reload exactly and one immutable edit cannot acquire two
  identities across the database seam. Segmenting does not render a second RGB
  image: the new subject layer points its content at the current immutable
  base-output node and pairs it with the newly published permanent mask, and the
  evaluator clips during composition when pixels are eventually needed. When an
  absolute transform replaces a layer's geometry, photoctl walks through the
  retained develop-delta nodes, replaces the transform beneath them, and rebuilds
  those same delta recipes above it; a relative transform's default anchor is the
  original mask centroid mapped through the current matrix, so rotating a moved
  subject keeps its visible centre fixed. Combined movement multiplies the
  subject's *current* scale — a subject already enlarged twice becomes four times
  its original size under `--scale 2` — while rotation and flips are preserved,
  and normalized coordinates change only the destination units, not the scale.
  Whether a layer can take a develop delta is reconstructed by walking its
  content branch from the retained develop ancestor through every persisted
  delta; a transition that cannot compose exactly — saturation from zero chroma,
  repeated vibrance, mixed active controls — is reported stale rather than given
  an approximate delta.
- **The gap:** The plan required complete snapshots, stable IDs, atomic failure
  and relative composition, but chose none of: whether unchanged callers must
  resubmit the stack, the legal role pairings, the delta recipe's shape, which
  coordinate frame relative composition uses, the numeric precision of opacity,
  position numbering, the normalized meaning of a displacement, the initial
  subject content recipe, transform placement among retained deltas, whether
  "centroid" meant original or visible centre, whether an optional scale is
  absolute or a multiplier, or how staleness is recovered after restarts.
- **The reach:** "Layers are ordered roots, not private pipelines" is the
  load-bearing shape. Staleness survives process restarts and any number of
  revisions without a mutable flag that could drift from the graph; commands that
  reorder, rename, disable, remove or clear must submit a complete replacement
  snapshot so the transaction can validate the exact composite projection; and
  future layer transforms must retain content ancestry for this reconstruction to
  stay valid. Clients wanting an absolute transform keep the separate
  layer-transform contract; `delta_applied` means the persisted operation has a
  defensible scene-linear composition, and supporting more combinations later
  requires a proven composition rule rather than a weaker result meaning.
- **Verdict:** **Sound.** The immutable graph is already the authority for what
  pixels mean, so deriving status prevents a second state owner, and each
  narrow choice reuses an existing owner rather than inventing a parallel one.
- **Confidence:** High for identity, lineage and the transaction boundary; medium
  for the ergonomic calls (explicit anchors, one-based positions, relative frame,
  multiplicative scale) until an interactive client exercises them.
- **Owner:** `packages/render/src/layers/`, `packages/render/src/graph/store.ts`.

### S59 — Vacancy is workflow state derived from content lineage

- **When:** Slice 10c2 vacancy integration; slice 12d3 person-move integration;
  combined move/scale lifecycle correction.
- **The choice:** Moving a person leaves a hole. That hole's pixels are a
  zero-input `solid` recipe carrying oriented dimensions, the working colour
  space and one RGB triplet, evaluated lazily in the native image owner — not
  disguised as provider output, a mask artifact, markup or a special composite
  role. The vacancy identity is stable: the first move creates one, later moves
  reuse it even if a prior revision removed it, a database constraint enforces
  that, and `layer duplicate` therefore rejects vacancy layers. Each active
  revision places the vacancy immediately behind its subject and renumbers the
  stack contiguously; `--to` translates the current visible mask centroid while
  preserving existing scale and rotation, and `--by` adds a vector in oriented
  base coordinates. The *original* hole is the one recorded when that vacancy
  identity first appeared, so after moving a person, generating replacement
  pixels, filling the old hole and moving again, the restored hole is the first
  one — a later subject generation's selection describes its new position and
  cannot redefine it. Critically, the role does not permanently mean "magenta and
  unfinished": the vacancy is unfilled exactly while its content lineage still
  reaches the solid sentinel, and once filled the same identity is ordinary
  photographic content following the ordinary develop tiers. Only the placeholder
  state is excluded from develop compensation and staleness and reported as
  unfilled, so editing exposure cannot tint the warning placeholder or make one
  vacancy count as two problems, and a filled hole does not warn forever.
- **The gap:** The plan required deterministic vacancy content, a stable original
  and repeat moves, but the graph had no honest constant-image node, and slice
  10c2 could equate role with placeholder state because vacancy fill did not exist
  yet. Reactivation after removal, exact stack placement, whether `--to` discards
  existing transforms, and the provenance owner of the original hole after
  replacement were all unspecified.
- **The reach:** Future constant backgrounds can reuse the solid vocabulary
  without teaching the compositor what a vacancy means. History always refers to
  the same logical hole, and any future history collection must preserve that
  first-snapshot provenance while a vacancy can still be reactivated.
- **Verdict:** **Sound.** Immutable lineage already records the state transition,
  so no mutable status column can drift from the active graph, and the database
  enforces the identity rule.
- **Confidence:** High for the derived state and identity; medium for adjacency
  as presentation policy and for the multiplicative move/scale ergonomics.
- **Owner:** `packages/render/src/layers/{operations,model,status}.ts`.

### S60 — Canvas authoring replays the projection that was captured, and clips coverage afterwards

- **When:** 12f2 canvas-ancestry, restriction and deterministic-core checkpoints;
  geometry metadata prerequisites; 12f3 core checkpoint.
- **The choice:** Expand a cropped photograph with border A, move A to the right,
  then add border B around the resulting view. B records the exact *ordered
  projection stages* — each a frame plus a coordinate mapping used by one existing
  pixel sampler — that made its input visible, and later renders replay those
  immutable stages against live pixels rather than reconstructing B's input from
  A's original unmoved rectangle, which erased already-visible columns.
  Capturing RGB instead would freeze later photographic edits, so only the
  projection is retained. A placed border keeps its full intrinsic raster under a
  distinct persisted placement recipe — translating it moves its RGB, its mask
  hole and its extent together, and the existing manual transform keeps its
  baked-raster meaning — while a supplied image whose intrinsic dimensions
  disagree with the prepared frame cannot activate the border. Ancestry has two
  meanings that are kept apart: remove border A then author B, and B remembers
  that A happened earlier for inspection without inheriting A's exclusions merely
  because A preceded it, so historical retention cannot reactivate removed
  support. RGB and coverage traverse the same ordered samplers and coverage is
  clipped against the authored admissible frames *afterwards*, so interpolation
  cannot leak forbidden original values into a hole while a manual layer authored
  after expansion keeps its legitimate extension pixels. A new crop partly
  outside the picture is accepted when it intersects the current view and refused
  when wholly disjoint, but once valid it survives even if removing borders
  leaves it unsupported. A later aspect edit crops the *stable authored canvas*
  rather than replaying the pre-border source operations, keeping the familiar
  before-quarter-turn meaning of the ratio, so returning to an earlier
  rotation/straighten pair restores exactly the earlier dimensions. Two numerical
  tolerances are separate: integer raster bounds snap a coordinate to its nearest
  integer only within a small multiple of machine epsilon scaled by frame size
  and magnitude (a rotated frame mapped back into its own axes produced a
  −1.4e-14 that added a spurious row), while support coverage maps every frame
  into viewport-relative coordinates and treats a *summed* remainder of roughly
  1.4e-14 of the viewport area as roundoff — summing first so splitting a real
  hole into fragments cannot make it vanish. A document without canvas geometry
  may have no authoring checkpoint. A new layer attaches to the current
  checkpoint automatically while duplication explicitly preserves the original
  reference including its absence. This optional state is not a promise to
  migrate old development catalogs. Finally,
  editing intent is resolved inside the existing revision transaction: a layer
  edit asks for photographic planning rather than supplying a separately
  assembled output, and requesting both a planned photograph and an explicit
  custom graph root is rejected rather than silently discarding one.
- **The gap:** Earlier checkpoints kept input and output frames but could not
  recover the intermediate canvas after an older border moved; the metadata
  scaffold had not distinguished the two meanings of ancestry; geometric exclusion
  and interpolation coverage have different meanings at edges; the old
  containment check could not represent reversible exterior intent; integer
  raster bounds needed a different numerical policy from area tolerance; and the
  plan did not choose eager versus lazy adoption of the new metadata root.
- **The reach:** Geometry checkpoints require the captured stages, and the canvas
  recipe stores its shared viewport stages once. Reset, shrink and removal must
  never be reclassified as new enlargement. Coverage is independent of preview
  resolution and ignores no ordinary pixel-sized hole. Consumers must treat an
  absent geometry root as an ordinary pre-canvas document, not as lost data.
  Custom graph roots retain their explicit validated meaning without becoming
  implicitly photographic.
- **Verdict:** **Sound.** Captured projection preserves the complete visible
  input while keeping authored exclusions fixed and later pixels editable, and
  each tolerance matches the failure it was measured against.
- **Confidence:** High for ancestry, placement and admissibility; medium for the
  numerical tolerances and for post-border aspect being a canvas restriction
  rather than a replay of the source operation.
- **Owner:** `packages/render/src/graph/{canvas,canvas-support,frame,projection,geometry-intent}.ts`.

### S61 — Canvas density: local supply satisfies demand, and the cache re-checks original sampling

- **When:** 12f2 density consumer pass and independent review correction.
- **The choice:** The base image's actual sampling sets the output demand; local
  images may fill an offline resolution shortfall only up to that demand, and
  they count only where their projected mask really covers the final viewport.
  Each saved projection is then realized at a uniform integer sampling grid
  derived from actual input frame mappings — a 25-unit-wide exterior crop of a
  half-sized source needs 12.5 samples and becomes 13 pixels using the existing
  rounding convention, without moving the catalog coordinates to make the
  division even, and a quarter-turn of a 13×6 grid produces 6×13. The largest
  directional sampling rate is used so available detail is preserved without
  stretching the two axes independently. Public preview source dimensions
  describe the rendered master, not the decoder's original input: a native border
  plus an offline small original preview can produce a native-resolution canvas
  while original detail stays limited, so the retained execution frame still
  records the small source and the public tier still reads pinned-preview.
  Because output sampling and original sampling can therefore diverge, cache
  sufficiency compares *both*: when the original returns, a master that looked
  dimensionally sufficient because of a native border no longer keeps serving its
  reduced interior forever.
- **The gap:** Saved frames establish physical geometry and authored rasters, not
  the raster available during an offline execution; existing preview field names
  could be mistaken for a claim about every contributing image; and the old cache
  predicate assumed output and original sampling rose together.
- **The reach:** Logical inspection stays stable while execution frames and
  previews describe the real raster, reusing the frame owner and the existing
  renderer semantic revision for invalidation — no second persisted geometry,
  density policy, cache status or provenance table. Callers must not infer
  recovered original detail from native output sampling.
- **Verdict:** **Sound.** Keeping physical intent separate from raster size
  avoids both fabricated fallback pixels and coordinate rebasing, and actual
  original supply must participate in cache sufficiency when a local layer can
  conceal its shortfall.
- **Confidence:** High for the corrected supply rule and the cache predicate;
  medium for the directional sampling policy, which is numerical rather than a
  promise about detail in both directions.
- **Owner:** `packages/render/src/graph/{canvas-support,frame}.ts`,
  `packages/render/src/preview.ts`.

### S62 — Outpaint has one exterior owner at native density, prepared without early activation

- **When:** Native-density clean cutover and 12f3 core/refresh/retry follow-ups,
  2026-09-06.
- **The choice:** Generated and upscaled border RGB is placed physically at its
  own native raster, and the exterior layer mask alone owns coverage — the
  mask's authored raster need not match richer paid content, and the earlier
  design that retained a hidden historical interior and resampled purchased
  detail back down to the authored size is removed rather than kept as a
  compatibility path. Refresh replaces the paid RGB while the sole exterior mask
  and physical placement stay authored, and the live photographic output beneath
  supplies the source and earlier layers. Preparation is allowed to run ahead of
  activation: refresh can build a current predecessor image from deterministic
  graph drafts, store those immutable nodes *without* an active revision, and
  evaluate through the existing cache; if generation then fails, the active photo
  and its extent are unchanged while the preparation persists as reusable
  deterministic work. An untouched source's deterministic graph is published and
  evaluated through the normal source execution owner without activating a
  document at all, while an edited photo samples its immutable markup-free
  photographic output including earlier layers. Retry is narrow: when a border's
  image was generated but its upscaler failed, asking again with the *same*
  generation intent keeps that purchased image and retries density for its
  current physical placement, leaving placement and the exterior mask unchanged;
  a different prompt is refused rather than silently buying a new image, and
  explicit refresh remains the operation that regenerates from current context.
  The exterior seam itself is hard by construction: outpaint fixes strict fitting
  with zero feather, and retrying with fitting or strength flags is a usage error
  — which is exactly what makes the whole-frame refusal meaningful, since a
  provider that returns a repainted photograph instead of a border is rejected
  rather than composited.
- **The gap:** Eager document or temporary-layer creation would mutate a failed
  or no-op request; a second generation pipeline would drift from fill's capping,
  adapter and density rules; the evaluator reads persisted nodes, so a separate
  staged evaluator would duplicate node resolution and add another cache
  contract; ordinary fill can replace generation on a changed request, but
  applying that to a border would conflate permanent expansion intent with a new
  canvas operation; and the fit vocabulary was specified for masked fills without
  saying how outpaint interacts with it.
- **The reach:** Failed attempts can retain extra nodes and artifacts, and with
  automatic collection disabled, repeated *distinct* preparations consume storage
  while identical ones retain deterministic identity. First-generation document
  creation stays atomic with successful activation, and no temporary active layer
  or revision is ever permitted. Any future softening of the original/exterior
  seam must come from the exterior mask owner, not from a fill strength flag; any
  future editing of a border's interior mask would have to revisit the
  single-exterior invariant.
- **Verdict:** **Sound.** One deterministic publication owner preserves reusable
  preparation without exposing an intermediate edit, and retrying a failed
  processing step does not authorize replaying generation or expanding the
  document twice.
- **Confidence:** High for the tested source/activation and retry contracts;
  medium for full-scale resource behavior, which the release resource gate still
  owns.
- **Owner:** `packages/render/src/fill/outpaint.ts`,
  `packages/render/src/graph/canvas.ts`.

### S64 — Markup is one editable vector document mirrored by a final deterministic node — and it is delivered

- **When:** Slice 13c vector markup and its independent review; markup mutation
  semantics verified against current code.
- **The choice:** A photo owns one ordered JSON vector document, while its active
  output root is a deterministic markup node whose recipe contains that same
  document and consumes the ordinary composite output; a markup mutation changes
  the table and commits an immutable revision in one transaction, and undo points
  at the parent revision and restores the table from that revision's final node.
  Stored coordinates always describe the oriented uncropped base: for a cropped,
  rotated or straightened photo the native renderer creates overlay colour and
  coverage in the base frame, transforms both, divides colour by transformed
  coverage only after resampling, then composites — so annotations follow the
  photograph through geometry changes instead of moving whenever develop geometry
  does, and partially covered edges stay colour-correct. Evaluation traces the
  exact first-input artifact lineage to recover the base dimensions of the source
  tier that actually produced the current pixels, scales coordinates and crop
  geometry to that tier before rasterizing, and sizes strokes and text by the
  geometric mean of the two axis ratios so integer rounding cannot make them
  anisotropic — so a low-resolution offline preview uses bounded memory while
  native-size export stays exact. Rendering is host-independent: the native addon
  rasterizes every primitive with a bundled font, converts hexadecimal
  display-sRGB colours into the working space before blending, assigns stable
  UUID item identities addressable by unique prefix, and bounds document size,
  path points, text length and geometry magnitudes so one JSON item cannot create
  unbounded native work. Mutation semantics are whole-item: `markup update`
  rebuilds the item from the supplied JSON keeping only its ID and position, so
  omitted fields are dropped rather than merged; `markup add` appends, and
  insertion order *is* z-order with no reorder verb; and a mutation whose result
  deep-equals the current document returns success with no change and no new
  revision — unlike an automatic-enhance no-op, which does commit a transition,
  so callers detecting work must read the change field rather than watch the
  revision ID. **Delivery boundary:** because the markup node *is* the active
  output root when the document is non-empty, `export` renders the annotations
  into the delivered file, exactly as preview shows them. "Removable" means an
  ordinary undoable markup mutation — `markup clear`, which commits a revision
  and changes the render hash — not an unimplemented export-only flag. Pixel-edit
  consumers such as retouch and outpaint do receive the markup-free underlying
  output, so a presentation overlay is never baked into permanent pixels.
- **The gap:** The slice specified the table, the coordinate space and native
  flattening, but not how editable state, immutable revisions and the typed graph
  stay synchronized, nor how antialiased vector pixels cross the develop
  transform, nor how base coordinates map onto a smaller offline preview, nor the
  colour space, identity ergonomics and resource ceilings, nor the mutation
  verb's patch and no-op semantics.
- **The reach:** Preview, export, later develop changes, layer mutations and undo
  all retain one render identity and one editable document, and a future GUI can
  edit vectors without acquiring a second rendering owner. An agent doing
  read-modify-write must send the full primitive each time. Treating markup as
  review-only — an export that omits annotations — would be a *new* product
  choice, not a missing behavior in the current contract.
- **Verdict:** **Sound.** The table owns current editability, the graph owns
  reproducible pixels, atomic projection keeps them equal, and not committing an
  identical document keeps history meaningful.
- **Confidence:** High for the graph and rendering contract; medium that
  delivering annotations by default is the product behavior a photographer
  expects, which is why the boundary is stated here explicitly.
- **Owner:** `packages/render/src/markup/`, `crates/photoctl-image/src/draw.rs`,
  `packages/commands/src/handlers/{markup,export}.ts`.

### S65 — The eyedropper returns a useful bounded correction and says what it could not fix

- **When:** Slice 08g eyedropper pass, 2026-09-06.
- **The choice:** A severely blue patch may need more correction than the
  temperature control's bounds allow. Rather than rejecting the click or quietly
  widening the control model, photoctl keeps the existing bounds, returns the
  best correction available along their edge, and reports both a limit flag and a
  relative RGB neutrality residual — a numerical channel mismatch, not a
  gray-card confidence score. The same native forward grade evaluates the result
  and its matrix inverse supplies attainable neutral targets, so no second colour
  formula exists. Offline sampling maps the same oriented base position into the
  available preview and selects the containing pixel; a rectangle averages the
  actual pixel centres inside its half-open bounds, and a tiny rectangle
  containing no centres fails rather than silently growing into a different
  patch. The result reports its pixel count, actual raster and scene-linear mean,
  and sampling reads verified canonical bytes in yielding batches without another
  full-frame float copy.
- **The gap:** The initial requirement settled neither out-of-range samples, nor
  point footprint, fractional patch edges, or reduced-resolution behavior.
- **The reach:** Manual controls, layers and undo inherit unchanged stored values
  and ranges. Clients can distinguish native from overview measurements, and
  neighbouring patches do not double-count boundary centres. Another footprint
  policy would require an explicit API decision.
- **Verdict:** **Sound.** Useful bounded work is honest about its remaining
  error, and the existing coordinate and source owners are preserved without
  false precision.
- **Confidence:** High for the bounded fit; medium for the offline footprint
  conventions.
- **Owner:** `packages/render/src/develop/`.

### S67 — The Core Image decoder is a neutral oracle across a public boundary

- **When:** Slice 07a helper boundary and selection; slice 07c oracle diagnosis
  and reports.
- **The choice:** A Core Image RAW filter starts from per-file values the vendor
  chose — baseline exposure, shadow bias, local tone mapping, and on newer
  systems highlight recovery — on top of the boost, noise reduction, sharpening,
  contrast, detail, lens correction and gamut mapping that were already
  neutralized. Leaving them active failed the unchanged decoder-comparison
  threshold; explicitly neutralizing them makes the result a scene-linear decode
  rather than the vendor's suggested starting look, and the same comparison then
  passed without moving its tolerance. The comparison itself measures the
  *public* linear TIFF boundary through the real CLI rather than importing a
  private in-memory buffer, so it covers dispatch, decoder metadata, the shared
  camera front, quantization and framing as one contract; sub-16-bit numerical
  drift is deliberately outside it and stays the colour core's unit-test
  responsibility. The three-way workbench view shows the embedded camera JPEG
  beside both decoders so framing and orientation are reviewable, but only the
  two comparable scene-linear decoders contribute to the numeric score — the
  camera JPEG carries the maker's intentional picture style, and scoring it would
  measure a presentation difference as a bug. Transport is a validated temporary
  file: a quarter-scale decode holds millions of channel samples, so the Swift
  helper writes row-major 32-bit floats to a caller-supplied unique path and
  prints a small JSON description, TypeScript checks that description and the
  exact expected byte count before constructing the image, and the temporary
  directory is removed whether decoding succeeds or fails. The helper is
  *discovered*, never compiled at command time: an explicit path override, then a
  packaged binary, then the workspace's built debug binary, then the system
  search path. `decode --with auto` falling back to an embedded JPEG or pinned
  preview because the preferred native decoder is unavailable returns its own
  `decoder_fallback` warning rather than reusing the offline-source warning, so
  an agent is told to repair a decoder rather than reconnect a drive. `decode
  --to` writes an unsigned 16-bit TIFF, saturating out-of-range floats at both
  ends rather than wrapping into unrelated brightness, and normalizing camera
  counts by their measured black and white levels so the stored samples truly
  span 16 bits — while the in-memory float image keeps its unclipped values.
- **The gap:** The property list omitted the newer file-dependent controls even
  though a neutral render was required; the plan delegated the float wire format,
  the helper lookup order, the out-of-range mapping, and whether the oracle
  compares private buffers or requestable artifacts.
- **The reach:** Any new decoder must publish the same neutral linear boundary or
  the oracle stops meaning anything. Release packaging can ship a platform binary
  at the same seam without changing commands, and future fixtures can use camera
  previews to catch geometry errors without forcing an independent RAW
  implementation to imitate proprietary picture styles.
- **Verdict:** **Sound.** A decoder oracle is more durable when it exercises the
  supported seam instead of reaching around it. Headless verification is removed,
  not an additional acceptance obligation.
- **Confidence:** High for the neutralization and transport; medium for the
  quarter-scale comparison scope and the helper lookup order.
- **Owner:** `helpers/mac/`, `packages/mac-helper/`,
  `packages/render/src/decoder.ts`, `apps/workbench/`.

### S68 — Highlight recovery is a floating-point translation that preserves complete cells and ships its source

- **When:** Highlight reconstruction passes A and B, 2026-09-06.
- **The choice:** The upstream routine infers a clipped colour channel from
  nearby channel ratios, and its integer input conversion discards values the
  current decoder preserves — so the neighbourhood operation is translated into
  the existing floating-point camera front instead, keeping reliable samples and
  values above display white, with double-precision ratio maps and an estimate
  that can only *increase* the clipped channel. Two small maps replace the need
  for another full white-balanced RGB image. Estimation uses complete
  four-by-four neighbourhoods in the decoder's physical grid: if a photo has one
  to three leftover pixels at its right or bottom edge, those samples are left
  unchanged rather than padded with invented neighbouring evidence, and rotating
  the displayed image does not move these physical neighbourhoods. Reconstruction
  runs on native decoder neighbourhoods *before* any reduction, between the
  single white-balance and colour-matrix owners, and a reduced request still
  reconstructs the full source before resizing. One fixed upstream mode is used
  as a bounded reference; no speculative strength control is exposed. The
  translated file is CDDL-licensed, so installing the native runtime also
  installs that derivative source with its terms and attribution notice, and the
  native crate declares both licences rather than presenting the file as covered
  by the repository's own.
- **The gap:** The spec required correct RAW output and floating-point
  preservation but chose neither the algorithm, the intermediate precision, the
  partial-cell behavior, nor how a new derivative source accompanies binary
  distribution. Two photographs improving under several upstream modes does not
  prove those modes interchangeable.
- **The reach:** Float retention is what lets recovery live before the
  scene-linear canonical artifact; an integer staging buffer would have to be
  re-derived to change it. An "applied" status means the operation ran, not that
  every pixel was reconstructed — visible edge defects would reopen the
  partial-cell choice. The ratio maps consume tens of megabytes on a
  full-resolution photo. This asserts no audit of unrelated third-party
  distribution obligations.
- **Verdict:** **Sound as the implemented translation** — it preserves the
  working representation, bounds extra storage, and keeps attribution and
  derivative-source access with distribution. The normal-rendering default is
  recorded in S92.
- **Confidence:** Medium for the numerical choices: approval of the current
  rendering does not identify every residual color cause. High for keeping
  attribution and translated source with the package.
- **Owner:** `crates/photoctl-image/src/highlight.rs`, `scripts/package-native.mjs`.

### S69 — Decoder treatment travels with the pixels and gates what may be called a full-quality render

- **When:** Reconstruction pass B, 2026-09-06; RAW diagnostics.
- **The choice:** "Treatment" is the record of which decoder produced pixels, at
  what scale, whether recovery was requested, whether it actually ran, and by
  which method. It is a closed schema that refuses impossible combinations such
  as "applied without a method", it is compared after decode so a plan and its
  result cannot disagree silently, and it includes the decoder's *identity and
  version* — because a system update can leave a decoder's recovery method name
  unchanged while its revision produces different pixels, and a cached preview
  from the older revision must not satisfy a request planned for the newer one.
  A composite output carries the treatment of its *primary* photographic input,
  following the same first-input ownership already used for source dimensions and
  coordinates; it does not claim a generated patch passed through RAW recovery,
  and the patch's own execution remains independently inspectable. Copying every
  ancestor's treatment into each combined output would duplicate the graph and
  force every consumer to interpret a list. Admission is asymmetric on purpose:
  once a preferred native decoder is available, a warm preview must match that
  decoder's planned treatment as well as the existing geometry and sampling
  requirements — but a fallback or cheap-overview request may reuse a richer
  cached RAW preview and report its recorded treatment honestly, because
  requiring the smaller pinned JPEG's treatment would throw away the better
  image. When a probe omits a decoder version, planning keeps the existing
  convention of using the adapter name as the identity value; the two current
  decoders differ in whether they supply a version, so a versionless plan cannot
  silently become a known-version result — their disagreement prevents
  publication. Diagnostic oracle runs are immutable: each run gets its own
  directory of decoder TIFFs and measured JSON, and a stable report entry points
  at the latest run while earlier directories remain intact, because reusing
  fixed filenames would collide with no-clobber publication and deleting the
  first run would destroy the comparison. Finally, ordinary rendering and the
  public decode command request recovery *explicitly*; a developer using the
  lower-level image decoder with no option still gets its disabled behavior, so a
  raw numeric inspection does not silently become a scene-linear recovery request.
- **The gap:** The plan required complete effective identity and truthful offline
  reuse but never said how decoder revision accompanies treatment through
  descendants and previews, what one treatment field means for an operation with
  several image inputs, which source candidates constrain a warm preview, how a
  versionless probe is represented, how repeated oracle runs are stored, or
  whether adopting the product default should change every lower-level entry point.
- **The reach:** Deterministic operations retain distinct execution identities
  when treatment differs even if their bytes happen to match. Decoder version is
  not embedded in the method name, so the two evolve independently. Consumers
  must not read an adapter-name fallback as a verified codec release. This is not
  a general promise to invalidate every ordinary-image preview after a decoding
  library upgrade. Product source planners must pass the fixed request explicitly.
- **Verdict:** **Sound.** One actual decoder record supplies both transport and
  reuse identity, the base-source owner is preserved rather than ancestry
  duplicated, and product policy sits at its callers.
- **Confidence:** Medium — successful versionless behavior from the current
  decoders is not established, and the admission rule is deliberately asymmetric.
- **Owner:** `packages/protocol/src/treatment.ts`,
  `packages/commands/src/graph-source.ts`, `packages/render/src/decoder.ts`.

### S70 — SAM's shipped mechanics: source-only input, existing transport, no invented selection rule

- **When:** Slice 11a/11b implementation; source-only canvas consumer, visual
  review, resource correction and integration review, 2026-09-06; real CPU export
  prerequisite.
- **The choice:** After outpainting a cropped photo, the model is shown the
  permitted original image surrounded by black — not the generated border. Its
  predicted selection may still include some of that black, and photoctl keeps
  the existing clipping to the image boundary rather than additionally erasing
  every selected pixel outside original-source support: that would be a new rule
  about what the model may select, not a correction of its input coordinates. A
  base-coordinate point outside the current crop is a usage error rather than
  being clipped to a visible edge, since clipping would select a different
  object, while a base-space box rotated by develop geometry becomes its
  enclosing axis-aligned box because the model's box input cannot express an
  angled rectangle; text-grounded boxes already belong to the rendered frame and
  pass through directly. Grounding keeps its existing JPEG transport even though
  a small colour island surrounded by black acquires faint halos when encoded:
  placement and black exclusion are verified before encoding rather than
  relabelling a lossy result as exact, since switching to a lossless input would
  change the external request and its size, not just the projection code. A
  long-running command sends the existing advisory heartbeat throughout
  initialization, inference and publication using the same minimum idle window as
  other long commands, and a disconnected listener is *not* a cancellation
  request — the work may still commit, and the caller must inspect state rather
  than replay the mutation. Publication is snapshot-checked: the initial revision
  (including the absence of a document) is captured before preparation and must
  still match before the mask is published, because dispatch with a supplied
  library handle can be re-entered during an external model callback and merely
  loading the newest revision at publication would attach an old-coordinate mask
  to a new image. One text command commits all matched masks in a single
  revision, so three found people become three layers together or none at all,
  and dry runs share the committed run's instance response shape with null layer,
  artifact, revision and render identities because they wrote nothing. Encoder
  features are cached against the *rendered pixels* — dimensions plus pixel hash
  — so rating a photo reuses them while changing develop pixels or source quality
  does not; failed loads and encodes are removed so a repaired model can retry.
  The exported decoder model ranks pre-sigmoid quality logits while leaving its
  probability outputs and first-index tie rule unchanged, because real inputs
  exposed numerical saturation that picked a different mask despite mathematically
  identical ordering; the exporter recognizes only the pinned graph topology,
  checks actual upstream parity results rather than trusting a zero exit status,
  pins its Python dependencies and source revisions in an isolated environment,
  and publishes a complete staged pair plus report by directory rename into a
  fresh candidate directory.
- **The gap:** The plan specified source-only input with authored exclusions but
  no additional exclusion on the model's *output*; the coordinate contract did
  not say how an invisible point or an angled rectangle maps into a
  point/axis-aligned-box vocabulary; grounding had no codec decision or progress
  coverage for a command longer than the idle window; the old publication check
  covered only changes after its final reload; and the plan did not say whether a
  multi-instance command is one edit or several.
- **The reach:** Prompt coordinates and returned masks keep original catalog
  coordinates and bounds. Geometry acceptance is not photographic quality
  acceptance — future codec work must judge grounding quality and request cost
  separately. Rejected work may leave unreferenced prepared artifact bytes but
  activates no stale layer and does not retry. Release hashes identify normalized
  real graphs; export parity accepts neither inference memory nor mask quality,
  and cross-platform export reproducibility is not established by a single host.
- **Verdict:** **Sound.** Input geometry is corrected while output-selection
  policy stays explicit, the existing revision and transport owners are reused
  rather than duplicated, and monotonic ordering is preserved without relaxing
  tolerances.
- **Confidence:** High for the revision, transport and publication contracts;
  medium for the enclosing-box conversion and the lossy grounding transport,
  which remain model-interface limitations.
- **Owner:** `packages/render/src/sam2*.ts`, `crates/photoctl-image/src/sam2.rs`,
  `scripts/export-sam2.py`.

### S71 — Native pixel work is scheduled off the command thread and accounts only the memory it owns

- **When:** Slice 07c colour front; slice 08c1b bounded-memory review; slice 08d1;
  native allocation, task-accounting and resampler-accounting checkpoints,
  2026-09-06; full-source G6 owned-projection checkpoint; slice 11 real-model
  resource pass.
- **The choice:** Large native rendering jobs run off the daemon's JavaScript
  thread; bounded synchronous preview resampling remains a separate contract
  (S56). Because a JavaScript typed array stays writable by JavaScript, the
  native boundary copies it once before scheduling asynchronous work — sharing it
  would be a data race and would make results depend on mutations after the call
  — and that single unavoidable safety copy is then *reused*: pointwise colour
  conversion transforms its private snapshot in place and returns it instead of
  allocating a second full frame; the global develop operator grades its owned
  buffer in place; a composite job reuses its owned background for the result;
  and the graph develop path copies verified canonical bytes once into the native
  task and publishes the returned bytes without ever materializing a full-frame
  typed array on the event loop. The shared projection worker takes the whole
  ordered stage list at once — receiving source pixels, the stages mapping each
  input to its next output, and the restrictions mapping final pixel centres back
  into earlier visible frames — allocating exactly two vectors large enough for
  their alternating stages, copying the source once, swapping after each sampler,
  freeing the unused vector at completion and tightening the output before
  ownership transfers. A dedicated shared predicate answers "is this final pixel
  centre inside that frame?" for both mask clipping and the RGB worker, so a
  future boundary fix cannot change one and not the other. Segmentation goes
  further: each library's runtime loads and runs its encoder and decoder on **one
  dedicated native thread** behind a bounded handoff, because the previous design
  held a mutex around execution while letting successive calls land on different
  general-purpose workers whose retained allocation working sets multiplied
  memory. Releasing the last runtime or inference task closes that handoff and
  waits for the native worker to finish destroying its sessions, including after
  initialization failure. Detached cleanup would let Node begin process-wide
  ONNX Runtime teardown while a session still needs it; synchronous cleanup
  keeps those lifetimes ordered without a timeout, leaked runtime, or new API.
  Text selection builds its grounding image and small normalized model
  input and then *releases the full photographic buffer* before waiting on the
  provider and inference. Accounting is deliberately literal: a task tells the
  runtime how much pixel capacity it actually owns so the garbage collector can
  see that pressure, but it never pre-charges a guessed size while queued, never
  forces collection, never changes the worker pool, and never calls the
  thread-bound accounting API from a background thread; where input and output
  are distinct allocations — resampling, affine transforms — the input's charge is
  held until the input is actually freed rather than released when the output
  becomes visible. Memory limits themselves are treated as the user directed: the
  recorded resident-memory figure is an **adjustable investigation canary, not a
  cap** — a crossing alone neither blocks delivery nor triggers extended
  profiling, and no speculative optimization is undertaken for it.
- **The gap:** The plan named Rust as the one pixel owner and set a memory band,
  but never specified napi scheduling inside a persistent daemon, intermediate
  storage ownership, the projection boundary's data shape, native allocation
  ownership across worker threads, or how to account allocations that outlive or
  differ from the returned result.
- **The reach:** Every later develop operator, mask operation and geometry stage
  inherits this execution model. One additional thread belongs to each loaded
  segmentation runtime — no new process, database field, command option or global
  worker-pool setting. These are *allocation* guarantees, not resident-memory
  guarantees: collection timing and allocator residency can keep process memory
  high after logical ownership ends, tightening an output can reallocate, and
  freed storage may stay resident. Whole-command memory acceptance therefore
  requires its own measured runs and cannot be inferred from a balanced counter.
- **Verdict:** **Sound.** Consume memory the task already owns exclusively,
  report what is actually owned to the platform that manages collection, and
  preserve caller buffers and exact pixel arithmetic rather than tuning an
  allocator or a garbage collector around one photograph.
- **Confidence:** High for ownership, scheduling and counter correctness; medium
  for allocator tradeoffs and bounded duplicate preprocessing under concurrency,
  where resident memory remains measurement-dependent.
- **Owner:** `crates/photoctl-image/src/`, `packages/img/`,
  [full-source performance](assets/full-source-performance.md).

### S72 — Native diagnostics are bounded and transported by existing operations

- **When:** Slice 11 addon diagnostic integration and the actual Linux capture,
  2026-09-06.
- **The choice:** The inference runtime can emit warnings between commands, when
  no operation is running and no callback owner exists. Rather than installing a
  live native-to-JavaScript callback solely for diagnostics — which would add
  request and teardown lifecycle obligations — an explicit process-scoped logger
  and per-worker session loggers record messages, creation and job outcomes carry
  them even when the operation fails, and command code drains them through its
  existing stderr-event owner. A CPU warning emitted between commands therefore
  waits for the next operation, which transports it *without* claiming the
  warning belongs to that photo. Each recorder retains 64 messages with each
  field capped at 4,096 bytes, surfacing truncation and dropped counts; each
  scope is first-in-first-out, but there is no cross-scope chronology or global
  sequence owner, and process messages may be lost at teardown. One field is
  deliberately omitted: the pinned wrapper decodes the message category from the
  code-location pointer, so photoctl reports scope, severity, message and code
  location and omits category rather than forwarding a mislabelled location — no
  dependency fork is added for it.
- **The gap:** No live callback owner exists in the native interface, and the
  documented upstream callback contract does not match its pinned implementation.
- **The reach:** Clients receive less metadata but never an invented or
  mislabelled diagnostic fact, and the strict machine-readable stderr contract is
  preserved. These diagnostics are not a durable logging service.
- **Verdict:** **Sound with limits.** Reuse the operation-result and stderr owners
  while making bounded loss and delayed timing explicit; omission is preferable
  to inventing facts.
- **Confidence:** Medium for the timing and retention policy; high for delivery
  of measured failures and for the omission.
- **Owner:** `crates/photoctl-image/src/sam2_diagnostics.rs`,
  `packages/commands/src/`.

### S73 — Cargo owns one target-local source build of the inference runtime, and damage fails by name

- **When:** Slice 11 default runtime acquisition, 2026-09-06.
- **The choice:** The inference runtime is the C++ library that executes the
  segmentation models. Rather than letting the Rust dependency download a vendor
  archive, one pinned source-and-patch recipe is built and cached inside Cargo's
  own target directory: a developer running Cargo directly, the packaged build
  script, the Docker test image and the release job all reach the same recipe,
  and none can select a different runtime behind that owner's back. Docker
  prewarms it in a recipe-only layer before application sources are copied, so
  ordinary source edits do not pay for a cold C++ build. If a completed archive
  stops matching its recorded hash, or a patch was interrupted mid-apply, the
  build stops and names the exact disposable cache entry to delete — it never
  resets project sources, silently substitutes another runtime, or runs a
  background cleaner; an interrupted compilation with intact prepared sources
  resumes through the ordinary incremental build tool. The rejected alternative,
  one shared cache across worktrees, would save cold builds but needs its own
  locking and eviction owner, so Cargo's existing target-directory lock was kept.
- **The gap:** No published patched archive or reproducible vendor-builder
  provenance exists, while direct, Docker and release builds all needed identical
  selection behavior; recovery from partial acquisition damage was unspecified.
- **The reach:** Contributors now need Python, CMake, Ninja, Git and a native C++
  toolchain; the preparer installs nothing and uploads nothing. Cold builds are
  expensive and rare, warm builds are idempotent, and nothing about model files,
  CPU feature selection or the public image API changes.
- **Verdict:** **Sound with acceptance gates.** One acquisition owner prevents
  silent per-platform divergence, and failure stays visible and scoped.
- **Confidence:** Medium — the build-cost and prerequisite burden is a real
  tradeoff; the ownership is not in doubt.
- **Owner:** `crates/photoctl-image/ort/{README.md,recipe.json,prepare.py}`,
  `test/Dockerfile`.

### S74 — The addon owns the final native link, on one shared macOS deployment floor, signed at its shipped path

- **When:** Slice 07c packaging integration; slice 11 runtime acquisition,
  2026-09-06.
- **The choice:** The addon is the dynamic library Node loads to get native image
  code. When Rust links it, Rust's own object code goes first and the linker then
  resolves its inference-runtime calls from the pinned archive, followed by the
  system C++ libraries — and on Linux the compiler's support archive must follow
  the runtime too, because the real link demonstrated that outlined ARM atomic
  helpers live there. The rejected alternatives were forcing every archive member
  to load, or calling an otherwise pointless runtime function from image code so
  the linker would keep it: both make runtime behavior compensate for build
  order. The package deliberately emits only the Node dynamic library, not a
  general-purpose Rust library whose future callers would inherit an undesigned
  transitive-linkage contract. The deployment floor — the minimum macOS version a
  binary declares — comes from one workspace value supplied to Rust, the RAW
  decoder and the inference runtime together, overridable by an explicit build
  environment variable that a standalone preparer must pass rather than infer
  from the builder's OS; without it, one C++ dependency could quietly target the
  build machine's OS while everything else targeted an older one. The check runs
  where it matters: the platform package is packed, installed into a scratch
  prefix outside the checkout, loaded, and its declared minimum asserted against
  policy. Packaging also ad-hoc signs the destination addon on macOS *after*
  copying it, because a linker signature can survive a filesystem copy and still
  be rejected by the loader; Linux packaging performs no signing.
- **The gap:** The plan named a Node native addon and one runtime acquisition
  owner but never said how that owner participates in the final link; the RAW
  decoder had a floor while the new runtime source build had no shared platform
  policy; and the release layout never said how a copied Apple Silicon library
  keeps a loadable signature.
- **The reach:** Existing Node APIs and native unit tests are unchanged, and a
  future public Rust SDK is not implicitly promised. Changing the floor moves all
  native image components together and changes the runtime cache identity; it
  says nothing about the CLI's Node or helper OS support.
- **Verdict:** **Sound.** Link ordering belongs to the build, a builder's OS
  version cannot implicitly choose what customers can run, and the shipped
  artifact is the one that is signed and checked.
- **Confidence:** Medium for narrowing the crate's outputs; high for final-link
  ownership, the shared floor and the installed-package check.
- **Owner:** `crates/photoctl-image/` build configuration, `.cargo/config.toml`,
  `scripts/{package-native,audit-linkage}.mjs`, `test/model-runtime/`.

### S75 — The Linux test image matches the runtime's C++ ABI, and the resulting floor is an observed fact

- **When:** Docker/model gate wiring, 2026-09-06.
- **The choice:** An ABI here is the versioned set of symbols a compiled binary
  demands from the system C++ runtime at load time. A clean native build on the
  older Debian release failed at link, because the pinned inference runtime calls
  symbols that release's C++ library does not provide; the same Node major on the
  newer Debian release supplies them, so the test image pins the newer one. The
  built artifacts then *require* those newer versions — a requirement read back
  out of the binary rather than assumed. Bundling a second C++ library or
  changing the runtime pin would have moved an owner outside this test-wiring
  change.
- **The gap:** The original Docker seam named the older release before the
  current pinned runtime made a newer C++ runtime a concrete build requirement.
- **The reach:** Docker coverage means "this newer Linux", not arbitrary older
  installations. The release workflow builds Linux packages on its own runners;
  under the user's verification policy their compatibility floor is not a
  required gate, and nothing here claims one. Node version, model bytes,
  inference semantics and image algorithms are untouched.
- **Verdict:** **Sound.** Fix the demonstrated toolchain mismatch and keep the
  evidence boundary explicit.
- **Confidence:** Medium — the fix is certain, while "which Linuxes can load
  this" stays an open, deliberately unclaimed property.
- **Owner:** `test/Dockerfile`,
  [runtime acquisition](assets/ort-acquisition/README.md).

### S76 — Build provenance records the toolchain actually used and claims no binary equivalence

- **When:** Slice 11 runtime acquisition and its initialization experiment;
  slice 07b vendored-source integration.
- **The choice:** Two machines building the same pinned source with different
  platform SDKs or compiler revisions select different cache entries; each
  records its own compiler and tool identity, its flags and its output hash, and
  neither is called byte-equivalent to the vendor's archive. Native hosts build
  their own target — cross-compilation is never inferred from a target name.
  Separately, a patch defers the runtime's CPU-reading start-up work until an
  explicit logger exists, because the CLI's error stream must stay strict
  machine-readable output and diagnostics belong on the typed native transport
  rather than arriving as a process-load side effect; both the insufficient first
  patch and the working one are retained, and that timing experiment explicitly
  does not claim to reproduce the vendor binary. Third-party source stays
  verbatim: whitespace diagnostics are disabled for the vendored RAW-decoder
  directory only — its upstream archive contains trailing whitespace and mixed
  line endings, and normalizing them would make photoctl's vendored bytes diverge
  from the pinned checksummed release — while every project-owned file keeps the
  repository's normal whitespace checks.
- **The gap:** The source and patch recipe were fixed, but the vendor's complete
  build environment and the supported packaged Linux ABI floor were not, and the
  clean-diff gate never said how to treat formatting already present in
  third-party source.
- **The reach:** SDK or compiler changes force a rebuild, and success on one
  platform closes nothing on another. The existing x64 CPU-feature floor is
  retained rather than broadened, no untested platform silently falls back to an
  unpatched archive, and future vendored updates stay auditable against their
  upstream archive.
- **Verdict:** **Sound.** Reproducible inputs plus observed toolchain identity are
  honest evidence without pretending to a hermetic, bit-identical build.
- **Confidence:** High for the evidence boundary; medium for native-only build
  ergonomics.
- **Owner:** `crates/photoctl-image/ort/README.md`, `.gitattributes`,
  [acquisition evidence](assets/ort-acquisition/).

### S78 — One CLI tarball carries the private module closure, resolved the way Node resolves any package

- **When:** Standalone packaging integration, 2026-09-05; slice 00 module mode;
  slice 14 journey sharing.
- **The choice:** Installing the CLI also installs its private command, render,
  provider and daemon modules *inside* that one tarball, with their ordinary
  third-party dependencies declared once on the CLI manifest — the package
  manager treats a bundled package's dependencies as bundled too, so leaving
  those edges on the embedded manifests would claim absent files were shipped.
  Platform native addons and the Swift helper stay separate optional packages.
  TypeScript compiles to real ECMAScript modules under Node's `NodeNext` rules,
  so source imports carry the `.js` specifier Node will actually load and there
  is no bundler step between what is tested and what ships. Ordinary development
  builds stay debuggable while packaging compiles optimized native binaries, with
  one root version generating the helper's version constant and synchronizing
  platform pins, and publication selecting only the expected current-version
  tarballs rather than every file left in an output folder. One targeted
  exception to the debug default: opening an uncached full-resolution RAW spent
  nearly all its time in unoptimized native pixel loops, so the image crate and
  its RAW-decoder crate are optimized *within* the development profile, retaining
  assertions, overflow checks and symbols — rather than switching every build to
  release, which would delete development checks everywhere and optimize
  unrelated code. A release install runs the same editing-and-preview scenario as
  a source build, selecting only a different executable and working directory, so
  new editing assertions automatically cover both runtimes rather than the two
  copies gradually drifting.
- **The gap:** The plan named CLI and platform tarballs but left workspace
  modules unshipped, chose no module-resolution mode, did not distinguish shipped
  from development performance, let the helper version drift from the CLI's, and
  did not say how the installed-runtime and full-journey coverage share their
  checks.
- **The reach:** Module-relative assets keep their package layout after install
  and an installed command holds no checkout-relative path; external dependency
  conflicts are rejected by the packer rather than silently resolved; the linkage
  audit accepts system libraries only and treats a binary's own build-time
  identity as not a dependency; optimized code is harder to step through even
  with symbols; and the installed daemon lifecycle remains independently tested,
  so the full-feature journey claims no daemon coverage it lacks.
- **Verdict:** **Sound.** One public JavaScript release boundary with the same
  module ownership as development, and release properties owned by build code
  rather than runtime fallbacks.
- **Confidence:** Medium — the clean-prefix install exam proves the current
  closure, not every future dependency graph.
- **Owner:** `scripts/{pack,publish-npm,sync-versions}.mjs`,
  `apps/cli/package.json`, `Cargo.toml` profiles, `test/macos/`.

### S79 — Release builds four platform packages and verifies one

- **When:** Standalone packaging 2026-09-05; Mac-only verification policy applied
  to the release workflow, 2026-09-08.
- **The choice:** Pushing a version tag exports and hash-checks the models,
  builds native packages on four runners (Linux x64, Linux ARM64, macOS ARM64,
  macOS Intel), assembles one draft release containing every tarball plus the
  model files and hashes, publishes it, re-downloads the models from the public
  URL to verify them, and only then publishes to the package registry. The
  verification steps — loading the real addon with real models, the packed-install
  exam and the linkage check — run **only** on the Apple Silicon job. The other
  three jobs compile and upload; nothing loads them. Intel and Linux validation
  is **removed, not deferred**: a green release run is not a statement that those
  packages work, and unverified platforms are never claimed as verified.
- **The gap:** The plan named a release matrix; the user's later policy named
  Apple Silicon as the acceptance target without saying whether the other
  packages stop being built.
- **The reach:** Users on Linux or Intel Macs can still install packages that no
  gate has executed — the portable implementation and its existing tests remain,
  but the builds are explicitly unverified. Release and registry publication are
  not one transaction, so a registry failure can leave a complete GitHub release
  with packages unpublished. The full local suite remains the release-preparation
  gate; a green hosted run is not release acceptance.
- **Verdict:** **Sound** as the faithful implementation of the user's stated
  policy — retained builds are explicitly not verification.
- **Confidence:** Medium, because shipping unexercised platform packages is a
  user-facing consequence of a verification-scope decision.
- **Owner:** `.github/workflows/publish.yml`,
  [verification policy](../../../README.md#verification-policy).

### S84 — References ride the documented edit route, and reference-only means "a variation"

- **When:** Slice 12e2 reference/init integration; reference-only completion and
  negative guidance passes, 2026-09-06.
- **The choice:** `generate --ref vase.png --prompt "…"` posts to the documented
  multipart image-*edit* route with repeated image parts, editable base first
  when a mask exists. The
  reference is sent only for models a fixed table says accept one — a table, not
  a capability probe. Unsupported references warn and are omitted when an explicit
  text prompt still defines the request; reference-only generation and explicit
  reference-strength requests instead fail before payment. Two immutable pins are kept:
  the exact oriented PNG bytes including alpha, and a separate working RGB
  projection, so a later refresh still works after the user's file disappears.
  Supplying `--ref` with *no* prompt is meaningful on its own: photoctl sends a
  versioned instruction asking for a new variation that keeps the main subject
  and composition while permitting detail changes, and stores that resolved
  instruction and its template version beside the retained reference — it does
  not promise a copy or an exact reconstruction, and an explicitly *empty* prompt
  is a usage error rather than a request for the default. `--neg "text, logos"`
  appends a versioned instruction asking the general model to avoid those
  elements; the result explicitly calls this prompt guidance, preserves the
  requested exclusions and the actual transmitted prompt in the immutable request
  and the attempt journal, and never claims the provider accepted a native
  negative-conditioning parameter or that unwanted content cannot appear. All
  provider-facing types, capability decisions, warnings and applied controls live
  in the provider package; render imports those types only, and an unsupported
  requested control is retained as immutable intent, warned about, and not sent.
- **The gap:** The slice required `--ref` and named `--neg`, but versioned
  neither wire dialect, said nothing about what to generate when no text
  describes the desired result, and supplied no provider-independent
  interpretation for exclusions.
- **The reach:** This defines the default creative intent of the shorthand
  without a new image model, local blend, database field or implicit
  reference-photo import. Working reference normalization stays full-size —
  allocating display and float buffers proportional to the reference's pixels and
  retaining a full-size working TIFF alongside the PNG — rather than silently
  flattening or reducing it; a future bounded projection needs an explicit
  density/role contract. A future template change must retain its version in
  request provenance, and future native controls must report a distinct
  application mode rather than reinterpret already-recorded guidance.
- **Verdict:** **Sound.** A variation is a useful generation operation while
  copying would not justify a provider call; refusing when the only input cannot
  be sent prevents unrelated paid work; and guidance is labelled as guidance.
- **Confidence:** High for the transport and immutable intent; medium for the
  full-size reference cost, which is explicit and unoptimized, and for the
  variation wording, which is a reversible product default. Live photographic
  acceptance is separate and unrun.
- **Owner:** `packages/providers/src/adapters/image.ts`,
  `packages/providers/src/prompts/image.ts`,
  `packages/render/src/fill/reference.ts`.

### S86 — The best declared source tier is a reusable preview ceiling

- **When:** Shared realized-frame implementation, 2026-09-05.
- **The choice:** A photo can have a 40×20 catalog size while only a declared
  20×10 source is available. After rendering that source once, the saved
  full-frame master records both its output frame and the source tier that
  produced it, and later detail requests reuse that master when it already
  represents the best declared tier — even though a full-catalog-size request
  would prefer more pixels. A newly available higher tier can still trigger a
  better render. Without this the same small source was decoded repeatedly and
  then failed outright once it disappeared, despite valid cached pixels with
  valid coordinates. A pinned fallback's *label* does not prove its density, so
  photoctl reads its actual image metadata once: it keeps a 20×10 cached master
  rather than dropping to a 10×5 pin, but improves a 4×2 master from that same
  pin, and if the pin is missing or unreadable it retains the valid cache and its
  truthful frame. One consequence worth knowing: what "source" means in a frame
  is set per node kind — a generate or upscale node declares *its own raster* as
  its source, while a canvas composite carries the decoded original's source
  through. So after an outpaint the ceiling still means "the original file's
  pixels", while on a generated branch it is self-referential, which is correct
  for a source-less generation but must not be read as "how good the original
  was".
- **The gap:** Exact frame retention required truthful resolution reporting but
  never said how a reduced, non-pinned source proves that rendering again cannot
  improve detail.
- **The reach:** Cached detail stays usable after source loss without pretending
  upscaling adds information. This relies on source-resolution metadata
  accurately describing the chosen tier.
- **Verdict:** **Sound.** Reuse follows retained source provenance rather than an
  output-width ratio.
- **Confidence:** High for the ceiling; medium that its per-node-kind meaning is
  discoverable enough for a future reader.
- **Owner:** `packages/render/src/preview.ts`, `packages/render/src/graph/frame.ts`.

### S5 — Import continues past a failing unit and describes each failure by path and reason

- **When:** Slice 01b command integration; slice 04 scanning; corrected
  2026-09-08.
- **The choice:** Import a folder where photo 2 has vanished mid-scan and photo 3
  is a text file: photos 1 and 4 are still imported. The envelope is
  `code:"partial"`, carrying `ids[]` for everything created *or* already
  recognized, `conflicts[]` naming the affected source paths with a
  human-readable reason, and counts describing logical photos. An expected
  per-unit error joins that partial result; only an unexpected fault still
  throws. Expected per-unit failures cannot discard IDs already committed by
  earlier units. Conflict entries preserve paths and readable messages, not the
  internal error's structured code or data. Unsupported inputs are counted
  separately. Shared setup has a different scope: when an admissible group exists,
  prepare the pinned-preview directory before admission; failure returns the
  destination error rather than one conflict per photo. An unsupported-only scan
  needs no cache directory. A batch that admitted no image reports `volume:null`
  instead of inventing a mount. **This
  per-unit conflict list is a message-and-path partial, and it is deliberately a
  different contract from the typed batch-envelope aggregation in S6.**
- **The gap:** The A2/A6 envelope defined counts and mixed success but not the
  identities behind them, the empty-batch volume, or how a per-unit failure
  interacts with units that already committed.
- **The reach:** Agents can chain import into every ID-based verb without parsing
  logs or querying the database, and one bad file in a folder cannot starve its
  neighbours. Collapsing the four causes into "unsupported" would tell automation
  to fix data when the storage edge actually needs attention.
- **Verdict:** **Sound.** Batch continuation preserves committed work while the
  result stays truthful about what did not happen.
- **Confidence:** High.
- **Owner:** `packages/commands/src/handlers/import.ts`.

### S7 — A successful import always leaves a pinned preview *and* its index row, and re-import repairs either half

- **When:** Slice 01b idempotency review.
- **The choice:** Every imported photo gets a pinned, source-independent
  1616-pixel-long-edge JPEG plus a `cache_index` row; a photo row without both is
  not a successful import state. A crash after the preview file is renamed but
  before the database commits would otherwise leave a photo whose index row never
  returns. Re-import therefore byte-compares the expected preview against the
  pinned cache file: a match leaves the file's timestamp alone but still upserts
  the index row, while a missing or same-length corrupt file is atomically
  rewritten. Checking only for the file's existence would leave the index missing
  forever; blindly rewriting every valid preview would turn an idempotent import
  into repeated cache churn.
- **The gap:** The plan required both halves but not the recovery when only one
  survived.
- **The reach:** Folder-scale re-import stays convergent and cheap in writes;
  pruning can trust that valid pinned files eventually regain their accounting.
  `files.embedded` stays reserved for genuine embedded JPEG byte ranges, so a
  whole-file source is never stored as a pretend preview.
- **Verdict:** **Sound.** Each half is verified and repaired without treating
  either as proof the other committed.
- **Confidence:** High.
- **Owner:** `packages/importer/src/cache.ts`,
  `packages/commands/src/handlers/import.ts`.

### S16 — One writer per library, from the lockfile to the daemon

- **When:** Slices 01a and 02, with the 01a review correction and 03b
  integration review.
- **The choice:** The lockfile still carries `{pid,socket,startedAt}`, but the
  actual exclusion is a kernel advisory lock held on an open descriptor for the
  whole library session — the operating system releases it automatically when the
  process exits, including after `kill -9`. The first design read a dead PID and
  unlinked its file; two contenders could both make that decision and one could
  delete the other's new live lock, which a synchronized probe reproduced as
  overlapping holders. PGlite is started *without* the flag that disables
  `fsync`, and both `fsync` and `synchronous_commit` are verified live at every
  open. `init` dispatches in-process to create the library and closes its bootstrap
  handle. Daemon startup then acquires the library lock and hands that
  *already-held* descriptor to the child as file descriptor 3: ownership is
  continuous across spawning, not across initialization and spawning. Direct
  mode, restore and non-library requests also have in-process paths.
  If that daemon spawn fails, `init` still returns success plus a
  `daemon_unavailable` warning, so the natural retry does not fail with "library
  already exists". A `--no-daemon` command stops a live daemon but defers a
  socketless direct holder to the ordinary library-open wait, which reports the
  holder PID and elapsed budget; `daemon stop` and destructive restore keep
  refusing a non-daemon holder immediately. `doctor` reports `lock_holder:null`
  on success, because a healthy run necessarily holds the lock itself and only
  foreign contention is actionable.
- **The gap:** Ordinary filesystem unlink offers no atomic compare-and-delete;
  the plan assumed runtime-adjustable durability settings; and it never assigned
  ownership of a socketless holder met while preparing direct execution.
- **The reach:** Every catalog write, the daemon lifetime, and the native
  `fs-ext` install dependency on the supported macOS/Linux targets rest on this.
  The library lock remains the sole owner of contention timing and error data.
- **Verdict:** **Sound.** Kernel ownership removes the race instead of tuning its
  timing window.
- **Confidence:** High.
- **Owner:** `packages/library/src/{lock,open,database}.ts`,
  `apps/daemon/src/server.ts`.

### S17 — Daemon transport is bounded, its control answers are observed, and it never replays an unknown outcome

- **When:** Slice 02 transport and integration reviews; recovery and status
  corrections, 2026-09-06.
- **The choice:** A frame is a four-byte big-endian JSON byte length followed by
  that JSON, rejected above 16 MiB on both encode and decode, so arbitrary socket
  chunking is transparent and a runaway length cannot allocate unbounded memory.
  The daemon log is a socket-identity-derived file in the OS temporary directory,
  beside neither the library nor its photos, owner-only, truncated at each start.
  `daemon status` asks the live daemon for uptime, queue depth and
  `background_busy` — read from the worker registry that already keeps the daemon
  alive — instead of inventing values; reading status does not interrupt indexing,
  and a false `background_busy` means the worker settled, not that its work
  succeeded. `daemon start` returns the handshake snapshot it already received
  rather than asking a second time and risking a lost reply. `daemon stop`
  reports failure when a live holder neither answers nor exits by the deadline.
  Idle connected sockets consume no request-queue capacity because only framed
  work is a request, and one 5 ms admission window coalesces simultaneous
  arrivals before serial execution. Most importantly: if a connection dies
  **after** a request began sending, the CLI returns unavailable with an explicit
  unknown-outcome message and does not resend — a duplicated `layer duplicate` or
  a second paid generation is worse than an unclear answer. Only a failure before
  sending retries.
- **The gap:** Framing and log placement were delegated; replay after ambiguous
  delivery, idle-connection admission, IPC permissions and failed-stop reporting
  were all implicit.
- **The reach:** Every verb, including paid ones, shares the no-replay rule
  rather than a growing list of supposedly safe verbs. This prevents
  client-generated duplicates; it does not promise exactly-once execution.
  Durable request IDs with saved responses could allow safe replay, but would
  need a cross-command transaction and retention contract that does not exist.
- **Verdict:** **Sound.** Recovery must not convert a missing acknowledgement
  into another mutation.
- **Confidence:** High.
- **Owner:** `packages/protocol/src/frames.ts`,
  `packages/commands/src/daemon-client.ts`, `apps/daemon/src/server.ts`.

### S18 — Backup is metadata-only; restore trusts the filesystem, not the journal's last word

- **When:** Slice 03b; slice 08a2 restore integration; the pre-slice-08 unknowns
  walk.
- **The choice:** `backup` is a small SQL snapshot for recovering from PGlite
  corruption, never a media backup: it is written to a unique temporary file,
  fsynced, renamed, and followed by a backup-directory fsync before rotation,
  with recency taken from the ISO timestamp encoded in photoctl's own filename
  rather than mutable mtimes — so copying history across a restore cannot
  reorder it. The newest snapshot survives even when it alone exceeds the
  retention budget, with a typed warning. `restore` replaces database state while
  **preserving** `artifacts/`, `originals/`, `previews/` and user-authored
  presets, recreating them in the staged sibling as hard links on the same
  filesystem, sharing image payloads while creating directory entries, before the
  directory swap; after promotion it validates registered canonical artifacts and
  marks missing or corrupt files unavailable rather than letting SQL claim they
  exist. Crash recovery reads the surviving directory trees — stage and rollback
  names share one UUID token, and any other path grammar is rejected — instead of
  believing whichever journal phase was written last; past the `committed`
  marker, recovery only finishes cleanup and never replaces the promoted library.
  Migration is exact-prefix: the recorded versions must be `[]`, `[1]`, `[1,2]`
  and so on through the current complete prefix, so a gapped or future ledger
  fails rather than looking current, and a repeated `migrate` re-queries state
  instead of replaying a cached startup result. The success envelope returns only
  `{library,from,schema_version}` — not the rollback path, which successful
  verification deliberately deletes. `dumpSql()` exposes text rather than the raw
  database object and commits in a `finally` block, because the dump tool leaves
  the shared session in a read-only transaction the daemon's next command would
  trip over. Narrow programmatic fault hooks let tests kill a real child process
  at exact durability boundaries without adding any user-visible flag.
- **The gap:** Crash ordering, oversized-newest behavior, how backup history
  crosses the swap, and whether restore may delete library-owned file trees were
  all unspecified.
- **The reach:** Recovery can never delete the media that SQL deliberately
  excludes, and a restored node may honestly report an already-missing artifact
  because SQL never promised to recreate it.
- **Verdict:** **Sound.** The filesystem is the observable truth after a crash,
  and publication establishes the replacement before any optional cleanup.
- **Confidence:** High.
- **Owner:** `packages/library/src/{backup,restore,restore-journal}.ts`,
  `packages/library/src/migrations/runner.ts`.

### S20 — Background embedding borrows the daemon's command lane, never its lock

- **When:** Slice 09c worker integration and the failure-path/scale reviews.
- **The choice:** photoctl has exactly one process — the daemon — holding the
  library's kernel lock and one database handle for its lifetime, so the
  precedent worker's "close the session between batches" cannot be copied: doing
  so would tear down the shared command handle. Instead the embedding worker
  selects at most 50 photos, does bounded per-photo provider work, then pauses;
  and before *any* foreground dispatch the daemon marks it paused, aborts
  in-flight provider I/O and retry backoff, wakes sleeps, and awaits the worker
  promise — so no foreground transaction can absorb or roll back a background
  write on the shared connection. Provider error classification ends *before*
  catalog persistence begins, so a local write failure is never retried as paid
  work. A 401/403/404 rejection is treated as a broken shared
  credential/model/endpoint context: the rest of the batch is recorded without
  further calls and automatic work stops until a later foreground command
  supplies fresh context, while an HTTP 400 stays a single-photo failure so
  photos 18–50 still run. A detached worker rejection is caught at its kick
  point, reported once as a bounded one-line diagnostic, and left dormant rather
  than becoming an unhandled rejection that makes shutdown fail. Slow foreground
  provider work emits progress frames every five seconds inside the client's
  ≥31-second idle window, so a 30-second provider call is not retried as dead.
  `embed --all` is an idempotent backfill over rows lacking a current-model
  vector, returning exact totals with at most the first 100 failures plus an
  explicit omitted count; naming IDs means "refresh these", capped at 1,000 with
  bounded identifier lengths so even the largest explicit batch stays far below
  the 16 MiB frame.
- **The gap:** The lifted precedent assumed two independent database sessions,
  and the plan supplied none of the batch, ID, failure-detail or cadence budgets.
- **The reach:** Future background workers must reuse this cooperative
  foreground-priority lane rather than introduce a second lock or session model.
  Operators needing a complete per-photo repair report use explicit-ID batches.
- **Verdict:** **Sound.** Foreground work stays bounded during automatic backfill
  while the one-lock invariant holds, and payment policy never crosses the
  boundary where remote success becomes local persistence.
- **Confidence:** High for the lane and failure policy. The *request dialect*
  inside it remains provisional: production may send one photo per request —
  fixed descriptive text plus that photo's pinned preview, accepted only when the
  response is exactly one finite 3,072-number vector — and only under explicit
  embed consent, because no live gateway has ever accepted or rejected it. A
  rejection must produce a newly named request version, not a silent fallback.
- **Owner:** `apps/daemon/src/workers/embed.ts`,
  `packages/commands/src/handlers/embed.ts`,
  `packages/providers/src/adapters/embedding.ts`.

### S22 — Command input is a closed set, and human output cannot break its own table

- **When:** Slice 01a review correction; slice 02b human renderer.
- **The choice:** Each command declares the options it accepts; an unknown
  option, a duplicate option, a missing value or a stray positional argument
  returns `usage` *before* the library is touched. The first parser searched only
  for known names, so `--cache-mxa 1GiB` silently initialized a library at the
  default size and `doctor nonsense` succeeded — automation typos looked like
  valid work. Separately, `--human` output escapes newlines, tabs, terminal
  escape bytes and the `|` column separator into visible spellings such as `\n`,
  so a tag or path containing a control character stays on one table row and
  cannot inject a column or a terminal control sequence; the JSON envelope is
  untouched. A failure that carries no message — a mixed batch returning
  `code:"partial"`, for instance — gets a label derived from its code
  (`Error [partial]: Partial failure`), while a supplied message always wins.
- **The gap:** The plan fixed command shapes and required deterministic readable
  text, but delegated the parser and said nothing about control characters
  originating in user or filesystem data, or about failures whose `message` field
  is absent.
- **The reach:** Every later verb extends one strict parser and reuses one
  renderer without sanitizing its own values or widening the protocol.
- **Verdict:** **Sound.** A CLI contract is only stable when unrecognized input
  is rejected, and presentation fills a presentation-only gap.
- **Confidence:** High.
- **Owner:** `packages/commands/src/{arguments,dispatch}.ts`,
  `apps/cli/src/output.ts`, `packages/protocol/src/envelope.ts`.

### S25 — Listing separates result membership from current availability

- **When:** Bounded list materialization, 2026-09-06.
- **The choice:** A catalog holds hundreds of photos and the caller asks for ten.
  photoctl counts every eligible photo and keeps the same ordering, but checks
  drive and file availability only for the ten rows it will actually return. XMP
  staleness is different and still checks every candidate sidecar, because
  staleness changes *membership*. A streaming caller must accept one row before
  the next row's availability work starts, while an ordinary non-streamed page
  keeps concurrent checks for the rows it will return; `next` resolves only its
  one selected photo.
- **The gap:** The existing SQL page bounded catalog memory but never said where
  expensive availability work belongs relative to output limits and stream
  backpressure.
- **The reach:** Counts and cursors do not become availability caches. Every
  returned row still consults the ordinary resolver, so offline, wrong-volume and
  reconnect behavior are unchanged.
- **Verdict:** **Sound.** Output demand bounds external work without changing the
  catalog's meaning or adding a second count owner.
- **Confidence:** High.
- **Owner:** `packages/commands/src/handlers/cull.ts`.

### S26 — Ambient credentials are never consent; consent is per purpose and per upscaler

- **When:** Slice 09a settings/selection; slice 12c1 policy; slice 12d provider
  runtime.
- **The choice:** A developer has a gateway API key exported in their shell.
  `fill --remove` runs generation through the gateway, but the upscale step
  reports `upscale_unconfigured` and preserves the generated pixels, because
  consent lives in a durable per-model row in the library
  (`providers.upscale[model].configured`), not in the environment. Three settings
  objects stay separate: `models` maps a purpose to a model, `generation.upscale`
  is the `auto|off` preference, and the consent row is the authorization —
  choosing a model never authorizes sending pixels to its vendor, and a
  command-line model override implies a request to upscale but cannot bypass the
  consent bit. Discovery is likewise not authorization: when a command or the
  workbench needs to know which upscalers exist, it asks the provider package for
  a *fresh* in-memory registry populated with the release roster, and then
  separately reads persisted consent. A process-global mutable registry would let
  test or future runtime registration leak between independent commands. The
  result contract keeps these apart too: `enabled` answers whether policy asked
  for upscaling, `action` answers what can happen now — default `auto` with an
  unavailable adapter is `enabled:true, action:"preserve_generation"` plus a
  warning, while explicit `off` is `enabled:false` with the same action and no
  warning. Public setting writes reject unknown fields through the shared strict
  registry; tolerant response parsing is a separate contract.
- **The gap:** The plan fixed consent semantics and precedence but not their
  durable shape, and never said where discovery ends and authorization begins.
- **The reach:** `doctor`, generation verbs, migrations and configuration tooling
  all inherit one explicit distinction between choosing a model and authorizing
  an external service, and UI or agent clients can explain why generated pixels
  were preserved.
- **Verdict:** **Sound.** Purpose-specific model choice stays independent of
  provider authorization.
- **Confidence:** High.
- **Owner:** `packages/providers/src/{config,upscale/runtime}.ts`,
  `packages/render/src/fill/upscale-policy.ts`.

### S32 — Density is an optional generative stage with deterministic, honest fallbacks

- **When:** Pre-slice-12 unknowns walk; slices 12a/12b/12d2; standalone upscale
  consumer correction.
- **The choice:** Generation publishes exactly the provider's intrinsic raster —
  the artifact keeps the dimensions the provider actually returned, and the
  recipe records the same dimensions as the sampling-density fact — while a
  separate canonical resample node owns deterministic sizing and placement into
  the base canvas. If the destination needs more density, the planner picks the
  smallest uniform supported scale covering both axes and then resamples once for
  exact geometry. A cached upscale is reused only when it names the *same*
  generation, with ties broken by fewest pixels and then by artifact ID so
  database row order can never change the plan; a fractional advertised scale is
  valid only if it lands on whole pixels for both axes. If every advertised scale
  breaks the adapter's limits, there is no legal paid request to make, so the
  plan uses the already successful generation, still lands the exact dimensions,
  and reports `density_satisfied:false` with `upscale_resolution_limited`. If the
  call fails, the same soft outcome applies with `upscale_failed`, always
  starting from the original pinned generation rather than recursively from a
  resized or composited result. Every generation recipe stores its upscale
  intent, adapter, model and guarded-prompt identity *even when no call was
  needed*, so a later layer enlargement can decide correctly. Downstream, the
  editable develop node consumes the entire purchased branch including any final
  exact-size resample, so lowering exposure on an enlarged image replaces the
  adjustment controls rather than tracing back past the paid pixels or stacking a
  second adjustment. Generic tiling and unexplained aspect stretching are
  forbidden; adapter-native tiling with a reversible frame mapping is allowed and
  recorded.
- **The gap:** The old normalization matched provider response dimensions to the
  sent crop rather than to the base image's real pixel density, and a later layer
  scale could silently magnify that deficit; the plan also never defined the
  zero-valid-scale case, multiple sufficient cache hits, or where upscale intent
  lives when no call happens.
- **The reach:** Fill, reimagine, relight, transform, refresh, preview and export
  agree on what "full resolution" means. Repeated transforms never compound
  pixels through upscale/resample/composite ancestry and never discard a sharper
  prior purchase.
- **Verdict:** **Sound.** Generated detail is honest at the destination without
  making rendering itself nondeterministic, and usable work is preserved rather
  than an invalid call scheduled.
- **Confidence:** High.
- **Owner:** `packages/render/src/fill/{density,prepare-density,transform-density}.ts`,
  `packages/providers/src/upscale/registry.ts`.

### S34 — Original image responses are retained separately from accepted edits

- **When:** Paid-response retention audit and closeout, 2026-09-06; reconciled
  after the user's retention/redo direction.
- **The choice:** A generation returns a PNG with the wrong aspect ratio and is
  rejected by policy. The bytes are still published through the ordinary artifact
  store and recorded on a library-owned *attempt journal* — a sanitized request,
  its provenance, the outcome and a link to the original image — so a valid returned
  image survives later acceptance-policy rejection, even where no photo or graph
  node exists yet. Unreadable responses or failed persistence cannot be claimed
  retained; those attempts expose failure instead. A
  successful render execution links the same attempt when its revision commits.
  The original encoded file is kept *alongside* the scene-linear working pixels
  the editor uses, so undoing an edit does not throw away the purchase and
  inspecting an attempt can return the provider's exact bytes and metadata.
  Artifacts are classified by *content*, not by use: a provider TIFF that happens
  to be identical to the strict working TIFF is one file and one row with both
  links, while an ordinary display TIFF is retained as encoded image data that
  cannot be read as working scene-linear RGB — labelling artifacts by their use
  would make identical bytes collide or weaken working-image validation. Listing
  a page of attempts reads catalog metadata and calls its flag
  `recorded_available`; inspecting one attempt verifies the file and reports
  `available`, so a file deleted outside photoctl still appears in a list with
  its last recorded presence while detail correctly reports it missing. Records
  too large for a bounded response mark truncation rather than being deleted or
  expanding the daemon frame.
- **The gap:** All six library image-producing paths can reject or abandon a
  returned image before graph activation, and bounded list/detail inspection was
  specified without choosing whether a list refreshes file availability.
- **The reach:** One journal owns retention; executions reference it rather than
  duplicating ownership. All attempt images remain retention roots, including
  after photo deletion. Measurements do not authorize automatic deletion.
  Started-but-incomplete records left by a crash mean incomplete — never
  permission to retry. Format measurements establish the encoding distinction,
  not a universal storage cost.
- **Verdict:** **Sound.** Capture must precede acceptance policy to preserve
  purchased output, and content-addressed identity must depend on bytes rather
  than on the caller's purpose.
- **Confidence:** High on ownership; library-scale storage cost remains
  unmeasured, and the retention count/age/storage cap stays deliberately open.
- **Owner:** `packages/render/src/provider-images/{attempts,inspection}.ts`,
  `packages/render/src/artifacts/publication.ts`.

### S38 — Full-frame generation intent pins the exact input execution and its own coverage raster

- **When:** Full-frame creation pass A, 2026-09-06.
- **The choice:** Two cropped views can contain byte-identical pixels while
  occupying different places in the photograph, so an artifact hash alone cannot
  answer "which view supplied this?". The generation request therefore stores the
  specific input *execution* ID alongside its saved frame, so inspection and
  later refresh can identify the physical viewport that was purchased.
  Separately, a provider may return fewer or more pixels than the requested
  viewport: the returned RGB keeps its own intrinsic sampling, while the constant
  strength mask is sampled at the *intended viewport* raster, and both are placed
  in the same physical footprint. Attaching the mask to whatever sampling
  happened to arrive would couple coverage to provider density.
- **The gap:** The plan required an exact execution/frame binding but did not say
  where to persist the link — existing generation execution inputs retained only
  artifact hashes — and it separated RGB placement from coverage without choosing
  the mask's sampling.
- **The reach:** Immutable generation intent is extended without a new table,
  migration or second provenance owner, and future refresh must honour the
  recorded viewport. Density processing can change retained RGB detail without
  changing the strength mask or exposing pixels outside the authored viewport
  after a later crop change.
- **Verdict:** **Sound.** The existing generation intent is the durable owner of
  the purchased request, and coverage has exactly one owner.
- **Confidence:** High.
- **Owner:** `packages/render/src/full-frame-branch.ts`,
  `packages/render/src/reimagine.ts`.

### S42 — One immutable image DAG replaces flat render state and private layer pipelines

- **When:** DAG/upscaling unknowns walk, 2026-09-05.
- **The choice:** Source, develop, generation, upscale, deterministic resample,
  transform, mask, composite, crop, markup and output are typed immutable nodes
  in one graph. User-visible layers stay an ordered editing vocabulary, but each
  revision points a layer at one output node; a processing step never masquerades
  as another painted layer, and a layer never hides a private replay pipeline.
  Topology is normalized nodes and ordered edges; each node kind owns a validated
  canonical parameter schema. Changing a parameter inserts a replacement node and
  a document revision rather than mutating history. The rejected alternatives
  were a visible layer for every operation, per-layer private DAG fragments, and
  continuing the flat replay design.
- **The gap:** The plan called a linear renderer a graph and gave future layers
  enough fields to become a second render-state owner; adding upscaling there
  would have compounded the duplication.
- **The reach:** Slice 08 establishes the graph before develop; slice 10 makes
  layers roots into it; fill, reimagine, retouch, markup, preview, export, undo
  and every future processing stage share one evaluator and one identity model.
- **Verdict:** **Sound.** The feature became a general processing architecture
  instead of an upscaler bolted onto generated layers.
- **Confidence:** High.
- **Owner:** `packages/render/src/graph/`.

### S43 — Logical edit identity and pixel-execution identity are separate

- **When:** Slice 08a1 architecture audit; fill projection integration correction.
- **The choice:** A logical node says what edit should happen; an execution says
  which pixels were actually used and produced. Changing exposure inserts a
  logical node and a revision immediately, so the CLI returns a new render hash
  without decoding the photo. Later, preview may evaluate that same node from an
  online full-resolution artifact or from the pinned offline preview: both runs
  share the document edit and the render hash, but their evaluation keys differ
  because the ordered input artifacts, frames or source treatments differ.
  Source runs additionally
  record the actual locator, tier, dimensions and decoder identity/version. A
  deterministic run reuses its evaluation key; a generative run keeps a distinct
  execution ID even when another attempt returns identical bytes. Layered on top,
  the renderer's *semantic revision* participates in derived-cache identity, so
  fixing a pixel-math bug gives existing photos a fresh derived preview and
  reevaluated deterministic nodes while pinned paid generations and their
  original bytes stay reusable — no global cache deletion, no migration, no
  provider replay, and no silently displayed old wrong image. Canonical recipe,
  evaluation, artifact, render and view hashes retain full SHA-256 values.
  Deterministic execution IDs hash their evaluation identity; nondeterministic
  execution IDs instead retain a random 256-bit identifier in the same hexadecimal
  shape. Only human presentation abbreviates them. Coordinate meaning is saved with each
  *execution* rather than with the shared pixel bytes, because two differently
  sized black sources can round to the same 7×7 black output while their
  locations in the original photo differ.
- **The gap:** The initial plan put input artifact hashes directly in node
  identity, which cannot coexist with committing an edit before pixels exist, and
  it never said whether source fallback changes edit history. Existing execution
  rows retained input artifact hashes but no coordinate metadata.
- **The reach:** Cache reuse, refresh, undo, graph pagination, artifact
  collection, preview paths and export correlation all inherit collision-safe
  identities. Future pixel-semantic changes must advance the single semantic
  revision; a fourth identity would fork the model.
- **Verdict:** **Sound.** Edit history stays stable and cheap while cache
  correctness follows the exact pixels used, and pixel semantics live in
  derived-cache identity rather than in user edits or destructive cleanup.
- **Confidence:** High.
- **Owner:** `packages/render/src/graph/recipes.ts`.

### S45 — Canonical artifacts preserve exact scene-linear working pixels, published before the graph points at them

- **When:** Slice 08c1a artifact correction; slice 08c1b probe and publication
  reviews.
- **The choice:** A source decode produces oriented scene-linear Rec.2020 RGB
  32-bit float samples. The artifact owner writes those exact samples to a
  deterministic uncompressed IEEE-float TIFF with the bundled linear Rec.2020
  profile and hashes those bytes, so every node reads the same unclamped values
  its parent published and negative, above-white and out-of-gamut samples survive
  to a display/delivery conversion boundary. Canonical publication fsyncs a sibling
  temporary and hard-links it into the content-addressed name. Identical existing
  bytes are an idempotent success; corrupt bytes at that owned address may be
  replaced with the correctly hashed artifact, while a genuine hash collision is
  refused. The directory is synced before catalog activation. A crash can leave an
  orphan but cannot publish a new active root before its pixels are durable.
  User-selected delivery paths have a different contract: native atomic
  no-replace rename protects an occupied destination, and unsupported filesystems
  refuse that publication. `render <id> --linear` uses that delivery primitive
  with no overwrite option while emitting the same verified canonical bytes.
- **The gap:** "Content-addressed artifacts" named neither a working colour space
  nor a publish order, and Node has no portable rename-without-replacement API —
  direct exclusive writes expose partial final files, and a user-space recovery
  protocol cannot atomically establish ownership across crashes and contenders.
- **The reach:** Everything reading artifacts must accept samples outside `[0,1]`.
  Repairing an owned content-addressed artifact is not authority to replace a
  photographer's chosen delivery path. Each publication boundary keeps that
  distinction explicit without a separate recovery daemon or marker protocol.
- **Verdict:** **Sound.** Preserve working pixels and make durable publication
  precede catalog visibility, with destination ownership deciding replacement.
- **Confidence:** High in the ownership boundary; platform execution evidence
  retains the root README's Mac-only acceptance scope.
- **Owner:** `packages/render/src/linear-tiff.ts`,
  `packages/render/src/artifacts/publication.ts`, `packages/render/src/export/run.ts`,
  `crates/photoctl-image/src/publication.rs`.

### S47 — Public undo and redo are document operations with the existing conflict boundary

- **When:** Public undo and redo integration, 2026-09-06/07.
- **The choice:** Undoing a layer removal restores that revision's image graph,
  geometry, ordered layers and editable markup together. It does not reverse
  ratings, tags or XMP writes, whose state is not part of document revisions.
  With no older revision to restore — a freshly generated image, or an imported
  original — undo succeeds with `undone:false` and retains the purchased image
  rather than clearing the only existing root; for an import whose lazy document
  was never initialized, the existing initializer establishes its ordinary source
  revision first and returns the same no-op result. Redo stores the revisions
  left behind by undo as a stack on the same document, so after edits A→B→C,
  undoing twice and redoing twice restores B then C; editing D after an undo
  discards that navigation path but deletes neither C's purchased pixels nor its
  history, and a failed edit leaves redo available. If two commands both read
  revision C, the first may restore B and the second must report the existing
  revision-conflict error rather than silently continuing from B to A, and a lost
  response cannot trigger automatic replay through the daemon.
- **The gap:** The internal undo primitive allowed the first revision to become
  no active document, and the spec required public editing undo without defining
  its response or a catalog-wide history model. Redo was requested without
  specifying persistent path storage.
- **The reach:** One document column and the existing transaction/activation
  owner control navigation across restarts — no separate history service, command
  replay or automatic provider retry. The public result always names a valid
  revision and render hash. Future catalog-wide undo would need an explicit
  separate contract.
- **Verdict:** **Sound.** Restoring an older edit cannot mean erasing the only
  existing image, and an explicit navigation path avoids guessing among abandoned
  branches.
- **Confidence:** High.
- **Owner:** `packages/render/src/graph/store.ts`,
  `packages/commands/src/handlers/history.ts`.

### S50 — Lossless tiled masters and progressive delivery are deliberately deferred

- **When:** User-directed preview scope decision, 2026-09-04.
- **The choice:** V1 keeps the full-frame JPEG display master and a synchronous
  `show`. Replacing that master with lossless random-access tiles, and letting a
  UI cancel, prioritize or progressively refine requests, are tracked in a
  separate optimization spec. Correctness does not depend on either: `show` still
  returns one complete readable view.
- **The gap:** The preview audit mixed requirements needed for trustworthy agent
  inspection with throughput improvements needed only once an interactive UI or a
  measured large-image bottleneck exists.
- **The reach:** V1 stays smaller. Any future implementation must preserve render
  and view hashes, coordinates, colour, warnings, cache lifetime and export
  correlation rather than expose a second preview contract.
- **Verdict:** **Sound.** Defer unmeasured complexity while leaving a named
  replacement seam.
- **Confidence:** High.
- **Owner:** [`specs/preview-rendering-optimizations.md`](../../preview-rendering-optimizations.md).

### S52 — Image admission is capability-based, and source kind is derived from one probe registry

- **When:** Slice 01b accepted-format and import reviews.
- **The choice:** `import --link` and `import --copy` accept every decodable
  single-frame still image by probing file *contents*; an extension is a filename
  hint, and an unknown or wrong one is not a refusal. Once imported, a photo is
  eligible for the same catalog, metadata, culling, develop, search, layer,
  segmentation, editing, preview, offline and export verbs — format selects
  the source adapter, never command availability
  or result shapes. Corrupt bytes, animated or multipage media, and formats no
  registered preview producer can decode return an unsupported result and create
  no photo row. A whole-file source is *not* stored as a pretend embedded
  preview: the embedded list keeps genuine embedded JPEG byte ranges. Resolution
  probes the online original; ordinary image decoding uses the whole file, while
  RAW file-decoder fallback can use an embedded JPEG range. Delivery encodes the
  evaluated pixels into the requested profiled format, even for upright JPEG
  originals. Sparse files take
  their dimensions from the image header when descriptive metadata is absent.
- **The gap:** The plan named a `file` source kind without defining how it
  crosses the catalog boundary without another schema column, and required
  content-based admission without saying what an unadmitted file leaves behind.
- **The reach:** Decoder selection could be added later while the embedded-preview
  collection kept one meaning, and folder scanning works on ordinary images with
  no metadata at all.
- **Verdict:** **Sound.** Source kind stays derivable from the sole format owner
  and no permanent preview seam is diluted.
- **Confidence:** High.
- **Owner:** `packages/importer/src/probe/`, `packages/render/src/decoder.ts`.

### S56 — One resampler, with pixel-centre mapping and widened support when reducing

- **When:** Slice 07b scale implementation; slice 10b1 native resample and N-API
  integration; slice 12d affine foundation; expanded-export performance pass.
- **The choice:** Graph and preview geometric resampling share one native owner;
  model-specific preprocessing and mask-logit reconstruction retain their own
  sampling contracts. The image encoder also owns final delivery downscaling.
  A destination pixel maps from its *centre* to the
  corresponding source-pixel centre. Reducing widens the Lanczos sampling
  footprint in proportion to the reduction — including reduction caused by a
  layer's transform matrix — and renormalizes the weights, so shrinking a
  four-pixel row to two integrates a wider neighbourhood instead of taking two
  sharp point samples; enlarging keeps the ordinary radius. Taps outside the
  source contribute zero, so a partially overlapping footprint fades continuously
  and a fully outside one returns zero, while an exact flip or quarter-turn
  copies the source sample and bypasses every filter. A stored resample matrix
  maps the intrinsic source raster *forward* into the oriented base canvas using
  pixel-edge coordinates — `[1,0,0,1,8,6]` places the source's top-left edge at
  base position (8,6) — and the native evaluator inverts it only while sampling
  destination centres, so graph recipes agree with the existing layer-transform
  owner. Ownership at the boundary is explicit: float layer work copies the
  caller's typed array once and runs on a worker, since JavaScript may mutate its
  backing store; display-preview resampling instead borrows the caller's 8- or
  16-bit array for a synchronous call and allocates only the final-sized output;
  imported preview decode admits at most one full raster at a time even though
  import prepares four candidates. Because the same distance-based weights apply
  to red, green and blue, the horizontal and vertical weights are computed once
  per output pixel and reused across channels in the same summation order — a
  two-stage separable filter would be faster still but would change the order of
  floating-point additions and therefore the pixels.
- **The gap:** The plan selected the kernels and exact right-angle geometry but
  defined neither pixel-centre mapping, edge behavior, transform-edge coverage,
  how the footprint changes when reducing, whether stored matrices are forward or
  inverse, nor the typed-array safety and memory boundary.
- **The reach:** Preview, provider normalization, layers, masks and canvas
  placement share one coordinate convention and one kernel. Downscaled layers
  anti-alias, exact flips and quarter-turns stay bit-identical, translated empty
  space stays empty for later composition, and off-canvas pixels stay zero.
  Because output is bit-exact, the weight reuse warrants no renderer-semantic
  revision. A derived-view recipe version identifies the native algorithm, so
  artifacts made by the previous encoder-based path are not reused after upgrade.
- **Verdict:** **Sound.** Centre mapping is symmetric, scaled support prevents
  avoidable aliasing, the integer fast path makes exactness structural rather
  than tolerance-based, and each caller pays only for the precision its contract
  needs.
- **Confidence:** High.
- **Owner:** `crates/photoctl-image/src/resample.rs`,
  `packages/render/src/preview-resampler.ts`.

### S63 — Retouch coordinates stay original-relative and require real photographic support

- **When:** Slice 13d keyless retouch; expanded-canvas retouch follow-on,
  2026-09-06.
- **The choice:** Extend a photo to the left, then heal a spot in that extension:
  its horizontal coordinate is *negative*, because zero still means the original
  photo's left edge. With `--norm`, positions scale by the original width and
  height and the radius scales by the original long edge, so the same request
  does not move when the canvas changes — renormalizing to each new canvas would
  silently relocate existing requests. A new circle must intersect actual
  photographic pixels and leave photographic surroundings; empty corners inside a
  rotated canvas rectangle do not count, but a visible generated layer can supply
  those pixels, and the circle is clipped to that coverage rather than healing
  empty canvas. A circle centred just outside the viewport is valid when its edge
  still covers supported pixel centres. Two radii are deliberately different
  things: `radius` always describes the permanent circular repair mask that the
  user asked for, while the versioned heal recipe separately records a fixed
  small reconstruction neighbourhood, an iteration ceiling and a masked-pixel
  update budget for the project-owned deterministic fill — the recipe names that
  method directly rather than claiming to be a canonical published algorithm.
  Resolved pixel geometry is canonicalized to nine decimal places so an
  equivalent normalized and absolute retry has one identity.
- **The gap:** The plan named a public target radius and an algorithm without
  saying whether the same number controls the inpainting sampler, how normalized
  radius scales, or how canvas expansion interacts with original catalog bounds;
  rectangular bounds also include empty corners and gaps left by authored
  geometry.
- **The reach:** Validation consumes the stored canvas plan and the existing mask
  projection owner; it may materialize deterministic mask artifacts but never
  decodes a source, replays paid generation, or changes nodes or revisions.
  Retouch identity, exact retry reuse and mask composition stay stable if a later
  recipe version tunes or replaces the native reconstruction. An exact retry
  returns the authored layer even if a later crop now hides it, while a *fresh*
  invalid circle is rejected — which preserves the idempotent-operation contract.
- **Verdict:** **Sound.** Original-relative coordinates preserve request meaning,
  one value belongs to the user-visible edit and the other to a reproducible pixel
  recipe, and the same projected coverage governs both rendering and validity.
- **Confidence:** High.
- **Owner:** `packages/render/src/retouch.ts`,
  `crates/photoctl-image/src/heal.rs`.

### S66 — RAW decoding is dispatched by sensor facts, not by filename or format label

- **When:** Slice 07b LibRaw adapter and scale implementation; reduced-RGB
  correction, 2026-09-06; fine-colour correction, 2026-09-06.
- **The choice:** Demosaicing reconstructs the two missing colours at each sensor
  site. A reduced Sony RAW already carries all three colours per pixel, so it
  bypasses that step — and the decision is made from the *decoded sensor layout*,
  not from a Sony filename or a compression tag, which would confuse storage
  format with whether colours are actually missing; any other complete-RGB codec
  gets the same treatment with no new flag, wire field or format exception.
  Where demosaicing does run, it runs on a working copy normalized by the
  recorded channel gains, because feeding it unequal sensor-channel scales
  produces coloured edges on a known gray subject; the normalization is then
  undone into floating-point camera samples and every actually measured sample is
  restored exactly, so the public image and its metadata stay camera-space and
  the ordinary front end still owns white balance and colour conversion. After
  demosaicing, photoctl subtracts the measured sensor black offset but does not
  divide by the white level or apply the camera white balance, so a sample stays
  a linear camera count with the separate as-shot numbers *describing* rather
  than altering the pixels. LibRaw's own declared inset crop is applied
  immediately after unpacking, producing the camera's nominal image rather than
  the larger stored rectangle with its optical-black margins — the decoder's
  format metadata owns sensor margins, and this is normalization, not a user
  crop. Fractional decoder scales are computed after demosaicing by bilinear
  pixel-centre sampling with floored dimensions, rather than asking the library
  for a half-size decode that would change the demosaic algorithm. A full decode
  returns a promise and runs on Node's native worker pool while the library keeps
  its thread-local scratch state — disabling the parallel build by omitting its
  flags rather than by defining the no-threads macro, which would replace that
  scratch with shared static memory and let two independent decodes corrupt each
  other. Capability probing parses metadata including the compression tag without
  unpacking every sensor byte, so a truncated file still identifies as a
  supported RAW and then fails decode with an I/O error rather than being
  mislabelled "decoder unavailable" and silently downgraded to an embedded
  preview. The original compression tag is preserved separately from the value
  the library rewrites while selecting a decoder, so the public probe reports
  what the file actually says while routing is unchanged. Loading the native
  package is lazy — a missing platform package is an explicit unavailable result
  rather than a crash on every command — while the test script builds and copies
  the host addon first, since generated binaries are not committed.
- **The gap:** The plan required camera space and forbade colour conversion but
  chose neither the numeric units after black subtraction, nor whether container
  margins count as image pixels, nor the interpolation kernel or its position
  relative to demosaicing, nor scheduling versus internal thread safety, nor
  whether probing is also an integrity check, nor how to survive the library's
  metadata normalization, nor the internal representation demosaicing needs.
- **The reach:** The shared develop front end, TIFF probes, histograms and future
  decoder comparisons must interpret these samples with their accompanying black
  and white levels rather than as display RGB. Two internal patched fields
  require rebuilding the vendored library and addon together and preserving the
  patch across upgrades. Automatic selection distinguishes "this decoder
  understands the format" from "this particular file decoded".
- **Verdict:** **Sound.** The distinction the decoder already owns drives
  dispatch, colour decisions stay with the one develop pipeline, and source
  corruption stays an error rather than becoming a silent quality downgrade.
- **Confidence:** High.
- **Owner:** `crates/libraw-sys/`, `crates/photoctl-image/src/`,
  `packages/render/src/decoder.ts`, `packages/img/`.

### S77 — Models are pinned by hash, provisioned explicitly, and rebuilt before the gate runs

- **When:** Slice 11a runtime; real-model gate wiring and export, 2026-09-06/07.
- **The choice:** The model manifest pins the upstream revision, per-file digests
  and the exporter-owned operator sets. Provisioning is always explicit: the
  Docker functional image requires a models base URL and fails the build when it
  is unset, and a host run either points an environment variable at an existing
  directory or uses the same hash-verifying fetch script. There is no second
  downloader and no guessed public address. Only the functional image fetches
  models; the fake gateway service stops at the built application image. Running
  the gate asks the container tooling to build first, so it can reuse unchanged
  layers but cannot silently run the previous image's tests against the current
  checkout.
- **The gap:** The plan required real default model coverage and a hosted release
  that did not exist, and settled neither stale image reuse nor automatic host
  provisioning.
- **The reach:** A source-changing functional run may rebuild its image and
  requires a configured base URL; missing models are a visible prerequisite
  failure, never a skip. Hashes bind bytes, not model quality or latency, and
  workflow wiring is not proof that a public release has run.
- **Verdict:** **Sound.** The gate tests the requested checkout, and one fetch
  owner preserves hash verification without hidden distribution or credential
  policy.
- **Confidence:** High for the gate wiring; the publication itself is U26.
- **Owner:** `fixtures/models.json`, `scripts/fetch-models.mjs`,
  `test/Dockerfile`, `packages/commands/src/dispatch.ts`.

### S80 — Hosted CI is a four-file public-boundary smoke; the full suite is local

- **When:** Explicit user CI-policy cutover, 2026-09-06; final-ledger
  reconciliation, 2026-09-08.
- **The choice:** Every push runs lint, typechecking, and exactly four fast unit
  files — command exit-code classification, daemon socket framing, human-readable
  output, and image-provider request controls. It builds TypeScript but does not
  compile the photo runtime, download models, or run camera journeys. Local
  commands are unchanged: the root test script still runs the TypeScript, Rust,
  Docker-functional and macOS suites. This supersedes two pieces of machinery
  that existed for the old hosted full suite: a host-pressure sampler that
  recorded CPU and memory snapshots to explain deadline failures, and an
  upload of a failed test's daemon log files as a short-lived artifact. **Neither
  is needed and neither should be restored:** this subset starts no daemon, so
  there are no daemon logs to keep and no contention to attribute. The product
  half of the old diagnostic survives untouched — the CLI still names a dead
  daemon's private local log path in its error. If future smoke coverage ever
  launches background processes, choose diagnostics for that actual workload
  rather than reinstating these.
- **The gap:** The user chose a small hosted subset and left its exact membership
  to implementation; nobody restated whether the diagnostic plumbing survived the
  shrink.
- **The reach:** Green smoke means those four boundaries hold — not that
  photographic quality or a release is accepted. Native-cache warming and
  host-load machinery are unnecessary for this gate.
- **Verdict:** **Sound.** A small deterministic boundary sample that follows the
  user's policy without deleting broader coverage.
- **Confidence:** High.
- **Owner:** `.github/workflows/ci.yml`, `package.json` `test:ci`,
  [verification policy](../../../README.md#verification-policy).

### S81 — The local gate is allowed to actually fail

- **When:** Slice 07b test boundary; CI repair pass 2026-09-06; local and
  selection closeouts, 2026-09-07.
- **The choice:** Five corrections share one property — the harness must be able
  to observe the failure it promises to test. (1) A sidecar test makes one photo
  directory read-only and expects that item to fail while the next photo
  succeeds; the container's root process would bypass those permissions, so the
  functional service drops its file-access bypass capabilities rather than the
  product inventing permission checks. Moving the whole toolchain to another user
  would require unrelated ownership changes; this targets the demonstrated
  mismatch, and does not claim root became an ordinary user for every other
  privilege. (2) Two integrity tests import a full camera RAW and deliver its
  full-resolution pixels; the framework's implicit five-second cutoff was
  silently acting as an unrequested export-speed requirement, so they now use the
  same 30-second *hang guard* as neighbouring RAW tests — a guard against
  hanging, not a latency promise, with explicit warm-preview, encoder and memory
  canaries left authoritative and unchanged. (3) The gold-exam test on a fresh
  checkout creates disposable command launchers pointing at the compiled entry
  points, so it exercises the real CLI without depending on installation links
  that do not exist yet — and certifies nothing about executable links, which the
  packed-install gate still owns. (4) Native binaries are not committed, so the
  test script builds and copies the host addon before the runner starts, while
  the image package still loads lazily so non-image commands work on
  installations without it. (5) Comparisons follow behavior rather than
  incidental scheduling: model-download URLs are compared without arrival order
  while preserving exact values and multiplicity, and an unavailable library is
  simulated by an atomic rename rather than by recursively deleting files
  underneath a live writer.
- **The gap:** The Docker plan never specified container capabilities; these
  functional tests had no chosen execution budget; and the plan required both
  built-code and packed-install verification without saying how the built-code
  test places commands on its search path.
- **The reach:** The capability drop applies to the functional container only,
  not to build steps or the gateway fixture. Deliberate extra downloads and a
  disabled watcher still fail; none of these corrections changes product
  scheduling, shutdown logic or performance thresholds.
- **Verdict:** **Sound.** Neither test expectations nor product code should
  compensate for a root user or a framework default.
- **Confidence:** High.
- **Owner:** `test/compose.yaml`, `package.json` test scripts,
  `packages/test-harness/`, `scripts/gold-exam.sh`.

### S82 — Fixture facts are bound to image bytes and to the writer that produced them

- **When:** Slice 00 fixture tool; RAW manifest and codec integration; SAM
  photographic probes; corrupt-fixture and historical-schema completion,
  2026-09-06.
- **The choice:** Each committed RAW has an adjacent manifest produced by an
  *independent* generator, so identity and embedded-preview tests cannot become
  tautologies against the code under test — the tool follows the container's own
  directory pointers to embedded JPEGs, parses each referenced JPEG's own header
  for its dimensions, and also scans for signatures as a second measurement path,
  so two independent structures must agree before a fact is recorded. Measured
  fields regenerate freely, but *authored* fields — provenance, licence, and
  hand-placed subject points and area bands for segmentation — survive only while
  the image's digest is unchanged: replace the image under the same filename and
  regeneration refuses to overwrite the old manifest until its annotations are
  reviewed, so a new photograph cannot inherit the old one's expectations while
  looking freshly verified. The known-bad fixture is truncated after 64 bytes,
  leaving a genuine container directory but no usable embedded preview, chosen
  deliberately because cutting only the RAW payload would leave a decodable
  preview that *should* import under the capability-based rule. Historical schema
  fixtures are recreated by checking out each schema's original migration runner
  and graph writer and authoring real edits — a moved subject, affine sampling, a
  local retouch — before dumping the database, rather than relabelling today's
  schema; the tests then compare records before and after a real migration and
  check what the edit *means*, while stating plainly that mask files are not
  packaged into the dump so a passing check is not evidence that lost image bytes
  can be recovered. The host segmentation test requires an explicit models
  directory and fails when it is absent rather than fetching, inferring a private
  cache, or silently skipping.
- **The gap:** The plan required a manifest, a truncated witness and per-schema
  dumps without defining the annotation lifecycle, the cut point, or how to
  recover omitted historical fixtures after later schemas had landed.
- **The reach:** Decoder suites discover the committed RAW files and consume
  these manifests rather than keeping a second inventory. Exact decoded-pixel
  hashes are scoped to their measured host and are not portable equivalence
  claims. Committed compression coverage does not substitute for real-drive
  acceptance, and area bands test coarse selection, not edge quality. The camera
  itself is released: the retained references and recorded gold evidence are the
  camera contract, and no further camera or mounted-volume access is authorized.
- **Verdict:** **Sound.** Identity is the image hash rather than the filename,
  historical code establishes the historical authoring contract, and each
  fixture's evidence keeps its stated scope.
- **Confidence:** High.
- **Owner:** `fixtures/README.md`, `fixtures/tools/`, `fixtures/camera/README.md`.

### S83 — Camera references keep real files and separate geometry evidence from colour evidence

- **When:** Permanent camera JPEG fixture pass, 2026-09-06.
- **The choice:** A camera writes a RAW and a processed JPEG for the same
  exposure. Both original files are kept together with separate integrity
  manifests, rather than generating the JPEG from photoctl's own RAW renderer —
  camera-produced files expose metadata and codec behavior that generated
  fixtures cannot independently establish. Representative landscape and both
  portrait rotations run through public import, offline preview and full-size
  delivery, and generated pixels are compared, as stored, against the correctly
  oriented camera image with a requirement to match it substantially better than
  any quarter-turn alternative. That checks upright content; it is explicitly not
  a claim that two different resamplers produce matching colours. JPEG manifests
  use a distinct suffix so the RAW facts are not overwritten, and tests use a
  second locator to exercise byte-identity deduplication.
- **The gap:** The user asked for permanent realistic JPEG and paired examples
  but prescribed neither fixture naming nor the photographic regression oracle.
- **The reach:** These references do not by themselves prove paired import or
  photographic colour fidelity; narrowly named assertions keep an orientation
  test from being presented as a quality gate.
- **Verdict:** **Sound.** Real camera files establish what generated ones cannot,
  with claims scoped to what the comparison can support.
- **Confidence:** High.
- **Owner:** `fixtures/camera/README.md`.

### S85 — Full-frame generation accepts cropped, rotated and reduced sources

- **When:** Slice 13a reimagine; authored-frame implementation completed through
  full-frame passes A and B, 2026-09-06.
- **The choice:** An early bounded checkpoint refused `reimagine` on any photo
  whose develop roots changed the frame, and refused a smaller pinned fallback,
  because the layer model then had no durable way to place a full-frame generated
  result back into a changed frame honestly. That restriction is gone. The
  current implementation captures the authored frame and the exact input
  execution (S38), records the source context — tier, pixel scale and whether
  resolution was limited — with the request, and therefore accepts a cropped,
  straightened, rotated or reduced-resolution current view as model input,
  reporting truthfully what it actually sent. Any statement that full-frame edits
  still refuse cropped or reduced inputs is stale.
- **The gap:** Catalog dimensions describe the oriented base while a cropped or
  rotated develop node renders another frame; until the authored-frame contract
  existed there was no honest mapping, and the interim behavior was a
  pre-provider refusal rather than a silently misplaced composite.
- **The reach:** Because the request records its own source context, a result
  produced from a reduced offline view cannot later be mistaken for one produced
  at native resolution; refresh reconstructs the recorded viewport rather than
  guessing today's.
- **Verdict:** **Sound.** The narrow refusal was correct while the mapping was
  missing, and superseding it with a recorded frame and source context is the
  general solution rather than a per-command workaround.
- **Confidence:** High.
- **Owner:** `packages/commands/src/handlers/full-frame-generation.ts`,
  `packages/render/src/full-frame-branch.ts`.

### S87 — Geometry intent records whether a restriction is active, not only its value

- **When:** Outpaint geometry-intent recon, 2026-09-06; implemented.
- **The choice:** Crop to rectangle C, expand the picture with a border, then
  explicitly set crop C again. That second command must crop the *expanded*
  picture even though the absolute numbers are identical to the old crop —
  otherwise "set the crop I want" would silently do nothing. Repeating the set
  afterwards is then a genuine no-op, and changing exposure or rotation does not
  reactivate a consumed crop. A graph-owned geometry-intent record therefore
  preserves which restrictions were explicitly activated after each border's
  authoring checkpoint.
- **The gap:** Before canvas authoring existed, equal develop dictionaries
  implied equal intent, because there was no boundary that could make the same
  numbers mean something new.
- **The reach:** The canonical output planner owns semantic no-op detection
  across develop and layer writers. Reset, copy and preset operations keep
  explicit field-touch semantics, and optional revision metadata alone cannot own
  state that ordinary layer mutations would drop.
- **Verdict:** **Sound.** It distinguishes an actual user action from an
  incidental unchanged value, without a second mutable geometry table or a
  permanently destructive crop.
- **Confidence:** High.
- **Owner:** `packages/render/src/graph/geometry-intent.ts`.

### S88 — Prerequisites were resequenced to land before their first consumer

- **When:** Post-slices-02/07a wavefront audit; outpaint planning checkpoint,
  2026-09-06.
- **The choice:** Two plan-order changes were made rather than building a feature
  and repairing it afterwards. First, the preview lifecycle — one coordinator,
  a validate-before-touch cache index, materialization leases and the prune grace
  — moved into slice 03a, *before* slice 08 added developed render graphs;
  otherwise slice 03 would have had to protect in-flight files using machinery
  the plan did not build until five slices later, and develop would have created
  a second cache owner. Second, canvas growth was made to depend on shared frame
  ownership: render, preview, masks and markup were first made to consume the
  same graph-derived frame — dimensions plus the mapping from original
  coordinates to evaluated pixels — because a rotated photo can have the same
  width and height as its original while its pixels occupy different coordinates.
  Growth then landed together with ordinary layer removal and undo, and
  generation followed that deterministic contract, instead of a special larger
  fill path whose preview and layer lifecycle would be repaired later.
- **The gap:** A preview-contract amendment added concurrency guarantees after
  the original dependency graph was written, and the initial slice named outpaint
  without identifying ownership across its consumers.
- **The reach:** Cache prune, ordinary preview, develop and later layer previews
  inherit one writer and one lifetime model; extent comes from immutable graph
  intent and active layers rather than changed source dimensions or a second
  mutable canvas-size table; and combined coordinate matrices must not fuse the
  ordered resampling stages that RGB and fractional mask coverage share.
- **Verdict:** **Sound.** Building the prerequisite before its first consumer
  prevents parallel implementations from drifting, and makes each checkpoint
  useful through existing user commands.
- **Confidence:** High.
- **Owner:** [import and preview invariants](README.md#import-and-previews), [canvas and generation invariants](README.md#canvas-and-full-frame-generation).

### S89 — Verification stimuli are chosen so a passing check means something

- **When:** Slice 09b storage probe; slice 07b portable build; cold offline
  lifecycle witness, 2026-09-06.
- **The choice:** Three unrelated checks share one discipline: construct the
  stimulus so the thing being claimed is actually exercised. (1) The database
  storage probe writes one deterministic but hard-to-compress wide value into
  every row each cycle, and changes it the next cycle, so the database must
  really replace each row's out-of-line payload — the mechanism under test —
  rather than merely touching rows; after the final cycle it reads every value
  back and compares it exactly instead of counting rows, and if the probe cannot
  start, run, verify, close or clean up it first replaces any earlier pass file
  with an explicitly unsettled verdict rather than letting the evidence directory
  claim a decision this invocation did not establish, with its diagnostic
  flattened to one bounded line. (2) The cold-offline witness imports a modest
  synthetic original through the normal pipeline, authors a border, then makes a
  *new* edit before disconnecting the file, and verifies the resulting whole-photo
  output has never been rendered before asking for a preview or an export —
  deleting a cached output or replacing the pinned preview would manufacture a
  state users never reach and would hide whether ordinary import produced useful
  fallback pixels. (3) The vendored RAW decoder's build discovers its sources
  recursively but excludes three upstream files that implement no-postprocessing
  placeholders for a different build configuration; compiling them beside the
  real sources defines the same functions twice and the linker rejects the
  library, while listing every wanted file by hand would silently omit a new
  decoder file on the next pinned update.
- **The gap:** The plans fixed the probe's row count, width and cycle count
  without defining the values or the readback; required cold reduced-source
  evidence without prescribing its stimulus; and required recursive source
  discovery without calling out upstream's mutually exclusive placeholders.
- **The reach:** The storage verdict is credible only while the probe really
  creates wide external values and forces a final read, so a dependency upgrade
  can rerun the same controlled workload and compare a verdict rather than a
  timing anecdote. The cold journey runs through public commands on both the
  built and installed CLI and introduces no product API, persistence or fallback
  change; it does not replace real-camera, paid-model, resource-budget or
  fresh-native-release acceptance. Both supported platforms use the same complete
  decoder implementation, and a future vendor update stays discoverable through
  the source glob and checksum review.
- **Verdict:** **Sound.** Each check exercises the failure class it claims to
  cover, and unsettled evidence is recorded as unsettled.
- **Confidence:** High.
- **Owner:** `packages/library/src/`, `crates/libraw-sys/build.rs`,
  [outpaint lifecycle evidence](assets/outpaint-lifecycle/).

### S90 — Full-frame generation is shown the current photographic result

- **When:** Shared-frame full-frame planning and creation, 2026-09-06;
  input policy approved by the user on 2026-09-07.
- **The choice:** A user retouches a face, extends a border, then asks to relight
  the photo. The model is sent the *current photographic result* — the composite
  the user has already inspected — with presentation markup such as arrows and
  labels excluded. Sending only the developed original would omit edits the user
  has already looked at and approved. The creation records this input policy and
  the identities of the predecessor layers that were captured at request time.
- **The gap:** The original full-frame plan described source/develop input;
  extending it to the current canvas required a choice about preceding
  photographic layers. The user selected the current result. Neither interpretation turns
  `--strength` into a denoise control.
- **The reach:** Purchased pixels contain those prior edits, and removing an
  earlier layer afterwards does not un-bake them. Explicit refresh reconstructs
  only the captured predecessors — never itself, never later layers.
- **Verdict:** **Sound.** It implements the user-approved current-photograph
  policy. Never silently reinterpret already-purchased generation intent or add
  a speculative second mode.
- **Confidence:** High.
- **Owner:** `packages/render/src/full-frame-branch.ts`,
  `packages/commands/src/handlers/full-frame-generation.ts`.

### S91 — `generate --strength` means freedom to vary, not resemblance

- **When:** Generate reference-strength guidance pass, 2026-09-06.
- **The choice:** A user supplies a vase photograph with `generate --ref vase.png
  --strength 0.25`. The model receives an instruction saying it has *low freedom
  to vary* that reference: zero asks for the closest preservation, one allows the
  greatest variation. This follows the numeric direction already used by
  `reimagine`, but it borrows none of reimagine's pixel blending — a newly
  generated photograph has no editable base to blend against, so even zero may
  differ from the reference. The public result and the saved history call this
  prompt guidance, retain the numeric request and the exact transmitted
  instruction, and claim neither native denoising nor provider compliance. If the
  selected model cannot receive the reference at all, an explicit strength is
  refused before payment rather than buying a text-only image.
- **The gap:** The original flag did not say whether a larger number meant more
  resemblance or more change.
- **The reach:** The interpretation is versioned inside immutable request intent.
  Existing requests without strength keep their prompts and identities; a later
  direction change must use a new guidance version rather than reinterpret
  previously purchased work.
- **Verdict:** **Sound.** Higher means more variation, as approved by the user
  on 2026-09-07. Saved guidance retains its original meaning.
- **Confidence:** High.
- **Owner:** `packages/providers/src/prompts/image.ts`,
  `packages/commands/src/handlers/generate.ts`.

### S92 — Highlight recovery is on by default, with an explicit diagnostic escape

- **When:** Highlight reconstruction planning, 2026-09-06; implemented.
- **The choice:** Opening a candle photograph should normally correct the false
  magenta that appears where one colour channel clipped. A caller inspecting the
  decoder can explicitly ask for the version without that correction. Both still
  use RAW pixels, white balance and colour conversion; neither substitutes the
  camera's own JPEG. Every result records whether correction actually ran and
  which decoder supplied it.
- **The gap:** The neutral-decoder contract disabled recovery, but the delivery
  review exposed false magenta. The current photographic rendering was approved
  by the user; the diagnostic alternative remains explicit.
- **The reach:** The default changes derived rendering identity — not original
  files, and not paid edit history. Effective treatment is recorded in the
  existing execution provenance column. Reversing the default is a policy change
  with a corresponding render identity, not a migration or a destructive cache
  reset.
- **Verdict:** **Sound.** Preserve the approved current rendering and explicit
  diagnostic path without claiming every residual color difference is resolved.
- **Confidence:** High.
- **Owner:** `crates/photoctl-image/src/highlight.rs`,
  `packages/render/src/decoder.ts`, [slice 07 highlight
  reconstruction](README.md#the-reasons--why-it-works-this-way).
