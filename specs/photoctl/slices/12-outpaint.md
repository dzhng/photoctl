# 12f — Frame-aware outpaint

Outpaint extends the current photograph without changing its original file, photo identity, or
catalog source dimensions. It is not a new photo or a larger provider response masquerading as a
canvas. This subplan owns the remaining geometry decisions before generation is wired.

## Current planning verdict

Three blind drafts independently identified the same first dependency: one graph-derived frame
must replace caller-specific reconstruction from source width and height. The fewest-slices draft
joined all deterministic behavior into one pass; the risk-first and seam-quality drafts split it
into geometry, canvas, lifecycle, consumers, and generation. Use three coherent checkpoints instead:
frame ownership with existing consumers; deterministic canvas with reversible lifecycle; generation
with the complete CLI journey. Do not accept a canvas checkpoint that defers its preview or removal
behavior to a later slice.

The next frame-ownership pass is specified below; canvas authoring must pass its explicit decision
checkpoint before its implementation begins. This is not a claim that the whole outpaint plan is settled.

## Invariants and provisional product choices

- Coordinates keep their oriented, uncropped original-base meaning. `--norm` continues using original
  source dimensions; it must not silently move existing edits when the canvas changes. Exterior regions
  use signed absolute coordinates and must intersect the visible frame.
- Expansion is provisionally centered. `--px N` adds N on every visible edge. For a reduced positive
  integer ratio `p:q`, `--aspect p:q` uses the smallest containing exact-ratio raster:
  `k = ceil(max(width/p, height/q))`, output `k*p` by `k*q`. This can add a few pixels on both axes.
  Use integer offsets, giving an odd extra pixel to the right or bottom rather than shifting source
  pixels by half a pixel. Matching aspect is a no-op with no provider request or new revision.
  Validate safe integer dimensions and pixel limits before multiplication/allocation; report actual dimensions.
- The recommended subject of expansion is the current visible crop, including its orientation and
  straightening, not the hidden uncropped source. The user has been asked; this remains provisional.
- Generation consumes the current photographic composite before final vector markup. Existing layers
  stay editable; only exterior coverage belongs to the generated border. Context is pinned for paid
  provenance, not substituted as an opaque replacement for live interior edits.
- Pixel placement and geometry use the existing native kernels. No generic provider tiling, full-raster
  Float32 transport copies for bounded uploads, parallel preview geometry owner, or source-dimension
  mutation is permitted. Check dimension and total-pixel limits before allocation or external work.
- Keep existing reimagine/relight restrictions explicit; outpaint does not imply lifting their accepted
  uncropped-base limitation. Missing live weights/credentials never become invented quality evidence.

## 12f1 — One frame owner for existing graph behavior

**Question:** do recipe inspection, evaluated pixels, and public view coordinates describe the same
frame, including source-tier rounding and ordered projection stages?

Extend the render-owned graph projection boundary into a frame resolver rather than adding another
handler-side calculation. It has two inputs to the same geometry rules: immutable recipe ancestry
plus catalog dimensions for a logical frame, and exact execution ancestry plus actual source
dimensions for a realized frame. Never select an unrelated latest execution at a logical node.

The shared value carries raster dimensions, original-base-to-raster and inverse matrices, visible
base polygon, and source/catalog dimensions. Retain the ordered raster projection stages needed for
pixels: a combined coordinate matrix does not authorize fusing resampling stages. The existing
offline single-coverage regression proves that clamp/interpolation boundaries can make fusion wrong.

Wire the current consumers in this pass: evaluator RGB/coverage, show/native detail and preview
density/region planning, markup, segmentation context, and mask inspection. Export consumes the same
evaluated output frame. Preserve each command's existing public behavior; no canvas kind, extra
mutable document-size state, or externally visible outpaint flag lands in this checkpoint.

**Measured starting points:** `graph/projection.ts` currently reconstructs one develop geometry
along exact first-input ancestry and stops at explicit raster canvases. `handlers/show.ts` separately
reconstructs geometry from the catalog and develop dictionary. `preview.ts` owns zero-origin raster
views and width-ratio density planning. `develop/geometry.ts` owns the actual crop, quarter-turn,
straighten, and tier-rounding math. Move ownership without duplicating those operators.

**Dependencies:** the initial-fill crop/offline sampling correction is integrated. Its exact mapping
and authored visible-mask intersection are consumers of this same boundary. A public show regression
now reproduces the next defect: reduced-source crop/straighten produces a 16×15 raster but its reported
mapping scales the logical full-resolution frame. Master sidecars currently lose that exact geometry;
persist the realized frame through cached master and detail views, not only the uncached result.

**Verification:** use `write-tests` before behavior changes. Existing source/develop, crop/rotation,
fractional straighten, manual masks, SAM projection, markup, fill creation/refresh, cached-mask report,
and offline tests remain green. Add a public show/native-detail assertion whose independent asymmetric
landmarks round-trip through the reported mapping at full and reduced density. Warmed old renderer
artifacts must stay bypassed without replaying paid generation. The built agent-preview journey is
the integrated guard; reserve the root full gate for final closeout.

**Delegated:** internal naming and module placement within the existing render geometry boundary.
Not delegated: changing coordinate units, projection order, rounding, source-tier claims, or public
crop behavior to simplify the refactor.

### 12f1 implementation evidence

The frame owner now follows each node's geometry and retains the realized frame with its execution
and preview artifact. A logical frame is recipe-derived; an evaluated frame is loaded by exact
execution identity. Equal RGB bytes are insufficient evidence of equal coordinates: differently
rounded source tiers can produce identical pixels with distinct mappings. Deterministic execution
identity therefore includes input frames; paid identities and artifacts remain unchanged.

Preview/show, evaluator RGB and coverage projection, fill preparation/refresh, SAM coordinates,
mask inspection, retouch geometry, and markup now consume this shared frame contract. Export
continues to deliver the evaluated raster. The affine transform node moves content within its
unchanged canvas; the registered standalone crop recipe still has no built-in pixel evaluator.
Implementing another raster-changing node requires extending the shared frame transition too.

Migration 17 adds compact frame metadata to executions. Historical missing metadata is recovered
only when bounded ancestry proves one frame; ambiguous pixel ancestry is never resolved by choosing
the latest row. A valid cached preview retains enough frame data to serve offline native/detail
inspection without that reconstruction. Public `source_dimensions` keeps its master-raster meaning;
the underlying source-tier dimensions are a separate internal frame fact.

Public full/reduced landmark and cached-detail regressions, identical-RGB/different-frame execution
regression, historical paid-fill recovery, schema fixture upgrade, and the built preview journey
cover this boundary. [Frame captures](../assets/frame-views/README.md) separate unchanged master
pixels from corrected detail extraction. The existing ordered RGB/coverage projection stages remain
unchanged; combined coordinate matrices do not authorize fusing pixel samplers.

Root integration `b3340b2` passed 75 focused preview, show, evaluator, migration, fill, and cache tests,
including the built CLI editing journey, plus typecheck. Integration review retained the three
recorded choices: execution-owned coordinates, bounded historical recovery, and density-aware cache
reuse. The production diff is +519/-432 lines including comments; the durable addition is one nullable
execution metadata column. This is checkpoint evidence, not the full release gate.

## 12f2 — Canvas authoring and reversible extent

The metadata prerequisite is implemented separately from canvas pixels. The graph revision writer
accepts an immutable `geometry` root: current activation records refer to authored checkpoints,
whose ancestry contains only geometry metadata, never historical generated RGB. Current absolute
develop values remain in the base graph. New layer identities capture the current checkpoint in the
same revision transaction; duplicates retain their original authoring relation. Geometry intent is
included in document render identity and follows ordinary revision inheritance and undo. The
`layer set --enabled true|false` boundary controls the existing enabled snapshot field explicitly.
Migration 19 and its real dump fixture cover this storage contract. They do **not** implement canvas
composition, crop consumption, extent, uncovered warnings, SAM geometry, or pixel lifecycle acceptance;
those remain 12f2 work. Subsequent canvas pixel kinds require their own migration, not edits to 19.

### Deterministic core maintenance checkpoint

The canvas publication boundary now accepts normal graph drafts and pinned artifacts, captures
immutable input/support history, and atomically activates an exterior-only border. Migration 21
admits its distinct canvas composite and full-raster placement recipes; migration 19 is unchanged.
The real dump fixtures exercise the production writers, including a translated border.

The public [canvas lifecycle tests](../../../packages/commands/src/outpaint-canvas.test.ts) cover
cropped/rotated expansion, nonzero-straighten round trips, repeated borders, removal and re-enabling,
post-border local edits, translated pixels/extent, exterior fallback, and cached show/export warnings.
These are deterministic geometric/pixel proofs, not photographic generation quality or full 12f2
acceptance. No paid outpaint command is wired.

The complete [core visual evidence](../assets/outpaint-canvas-core/README.md) retains public previews,
lossless diagnostics, edge crops and both independent critique verdicts. Exact restoration and the
authored-support hole are verified; JPEG boundary halos are explicitly distinguished from canonical
pixels rather than hidden by substituting lossless captures.

Independent code review found an effective-crop validation gap and ambient test-cache dependency;
the public regression now rejects a crop whose aspect-constrained rectangle is disjoint, and test
caches live inside their fixtures. Its compatibility concern about the required support count was
not adopted: the preceding metadata scaffold had no shipped canvas authoring flow or persisted
user-authored checkpoints requiring the former shape. The real schema-19 fixture is regenerated
through its writer; migration 19's DDL remains immutable.

Continue from this reviewed core in these bounded consumer passes:

- Restriction activation: independently replace crop and aspect, copy/reset/presets, and restore
  geometry intent through auto-enhance undo and ordinary revision undo.
- Layer lifecycle: public duplicate/reorder/clear, arbitrary rotated support and overlapping copies;
  later borders must keep authored coordinates when earlier support changes.
- Shared consumers: SAM sees source-only pixels with the same geometry/support plan, without
  photographic layers; native exterior detail and offline density must use that plan too. In
  particular, prove reduced offline inputs do not masquerade as full-resolution output and purchased
  upscale density survives exterior crop/canvas geometry; authored raster dimensions alone are not
  evidence of realized pixel density.
- Finish the complete deterministic visual journey and its fresh critique before accepting 12f2.

The render frame owner bounds new raster growth independently of provider capabilities, while
preserving source-sized operations. New crops may extend beyond the original but must intersect the
current visible canvas; removing support never turns a previously valid crop into a rejected new
request. Unsupported pixels remain opaque black. The immutable support verdict reaches show/export
before cache hits or export collision skips, independently of border opacity.

**Decision checkpoint before coding:** use an asymmetric cropped, quarter-rotated, straightened
example to settle the viewport policy. Merely retaining the prior final crop hides the extension;
clearing it reveals previously excluded content. An authored extent after straightening is an affine
rectangle in original coordinates, not necessarily an axis-aligned base bounding box.

The lifecycle checkpoint adopts the following reversible product calls. They constrain the graph
design; they do not claim the canvas implementation or its visual acceptance is complete.

1. Each enabled border retains the visible input frame it was authored around. Earlier cropped-out
   source or layer content does not reappear merely because outpaint expands that frame. A crop
   applied afterward is a replaceable view restriction: clearing it reveals the authored canvas,
   not content excluded before that border. The restriction tied to authoring is conditional on the
   border, not a permanent destructive crop. Removing that border removes its restriction unless a
   later enabled border independently retains the same boundary in its authored input.
2. Current absolute crop/rotate/straighten controls remain the current editing intent. Removing
   borders must not reset later develop choices. With no enabled outpaint borders, ordinary develop
   geometry again operates on the original source, retaining previously valid exterior viewports
   under the unsupported-pixel policy below. Relative orientation after a border is measured
   against its authored orientation: a border authored at rotate=90 followed by rotate=180 rotates
   the whole authored canvas by another 90 degrees, not another 180. Repeated slider changes replace
   the geometry tail; they do not accumulate resampling operations.
3. Extent belongs to enabled outpaint layers independently of opacity. Opacity zero fades pixels
   without resizing the canvas; disabling/removing the layer withdraws its extent. A later surviving
   border keeps its absolute authored placement when an inner border disappears. It neither shifts
   nor regenerates. Uncovered canvas is provisionally opaque scene-linear black, reported with
   `canvas_uncovered` on show/export. Hidden original content must not silently fill a generated-area
   hole while a surviving authored boundary excludes it.
4. A successful second `--px N` expands the then-current visible frame again. A failed external
   operation commits neither extent nor revision. Explicit retry uses that operation's pinned
   authored input/output intent; inspection, layer changes, and retry cannot append the same extent
   twice. A separate newly requested expansion is a new operation.

**Worked lifecycle target:** start with a 1000×800 source, crop `[100,200,400,200]`, rotate 90:
the visible raster is 200×400. Border A adds 20 pixels per edge, giving 240×440. Then set rotate 180
and crop `[100,200,420,200]`: the 420×200 view includes A's strip beyond original x=500.
Border B adds 10 per edge, giving 440×220. Disabling B returns to 420×200 with A's strip intact.
Disabling A while B survives keeps B's 440×220 placement but leaves the missing strip black and warned.
Once both are disabled, the current 420×200 crop/180-degree controls operate normally on the original,
so original content at x=500..520 is visible. The final state is independent of disable order.

Layer transform/reorder/duplicate behavior uses the same extent owner; compositing order must not
silently rewrite authoring chronology. One-axis aspect
ceiling was rejected because an identical request can grow repeatedly (10×7 → 11×7 → 11×8 for 3:2).
The exact-ratio contract above gives 12×8 once and then a no-op. The non-blocking question received
no contrary answer; keep this planner choice reversible before any canvas is authored.

### Geometry intent and ordinary layer operations

The [photographic output planner](../../../packages/render/src/graph/output.ts) owns final layer
projection for every photographic mutation. Editing requests opt into photographic planning; the
existing revision transaction resolves their intended base, geometry and complete layer snapshot
after its revision conflict check, then invokes the planner once. Explicit low-level output roots
remain explicit and cannot be combined with that opt-in. Final vector markup remains the
transaction's presentation step.
An empty layer stack points directly at the base, while a nonempty disabled stack retains its
composite identity outside canvas geometry.

The same absolute control value can mean a new restriction after a border consumed it. For example,
crop C → border A → explicit `develop --set crop=C` must restrict A's expanded picture; only the next
identical set is a no-op. Semantic no-op detection therefore includes immutable restriction
activation, not just equality of the final develop dictionary.

Keep current absolute geometry values together with the activation provenance of crop/aspect
restrictions in immutable graph intent. Each border captures an authoring checkpoint. A single global
"geometry changed" counter is insufficient: changing exposure, rotate, or straighten cannot reactivate
a consumed crop. Preserve the explicit fields touched by the command through this boundary:

- `--set` and `--unset` touch the named fields; presets touch only keys their overlay supplies.
- `--copy-from` replaces the full develop dictionary and explicitly sets/clears its geometry restrictions.
- `--reset` clears all current restrictions, including their fallback intent after borders are removed.
- Auto-enhance touches only fields it actually proposes; undo restores its prior intent rather than
  activating unrelated historical geometry. Revision undo restores the complete recorded graph state.

Intent changes can warrant a revision even when current pixels happen to match: clearing a consumed
crop changes what will be visible after border removal. Do not hide this state solely in optional
revision metadata that unrelated layer writers omit. One canonical output planner must serve develop,
manual mask/layer creation, and every layer mutation; changing only `commitLayerSnapshot` is insufficient.

Reordering changes paint order, not authoring chronology. Duplicating copies an authored checkpoint and
extent; it is not another expansion and does not consume the current geometry again. Removing one of
two coincident copies keeps the remaining copy's conditional boundary active. Provisionally, an explicit
layer transform moves that border's generated pixels, mask, and extent contribution together, while its
authored input exclusion remains fixed in original coordinates. It does not rotate or move the whole
document, reveal excluded source pixels, or move later borders. Vacated areas follow the uncovered-canvas
policy above.

### Exterior viewports and inherited support

Provisionally retain a previously valid exterior crop when its supporting borders are removed.
For a 1000×800 original and crop `[-20,100,60,80]`, removing all borders keeps the 60×80 view:
the left 20 columns become black and warned, while the remaining 40 sample the original. A wholly
unsupported viewport remains black rather than failing removal. A new crop must intersect the
then-visible canvas and pass dimension limits; removal does not revalidate an existing crop as a
new request. Clipping was rejected provisionally because it changes later editing intent and cannot
represent an empty intersection. The user can still change this reversible policy before authoring.

The frame describes where pixels are, not which original pixels may appear there. A border's captured
input-plan checkpoint must retain inherited support/exclusion ancestry, not only its input rectangle.
If narrower crop D includes pixels generated by border A, then border B authored around D must still
exclude the original behind A when A is removed. Follow immutable ancestry for admissible support;
do not replace live interior edits with a flattened snapshot or add a second coordinate owner.

The pure [canvas support owner](../../../packages/render/src/graph/canvas-support.ts) intersects
source restrictions and clips each enabled border's outer-minus-input ring to its later authored
restrictions. A border's mask hole moves with its outer frame; inherited source restrictions remain
fixed. Extent consumers receive those convex pieces in original-base coordinates. Coverage subtracts
their union from the final viewport, so overlapping copies cannot conceal a hole by double-counting
area. This is structural support independent of opacity, not a scan for black or transparent pixels.
Clipping reuses the develop geometry owner; no image raster is allocated. This helper is a prerequisite,
not acceptance of the planner, cached show/export warnings, or canvas pixel lifecycle.

**Nonzero-straighten witness:** production frame/matrix functions on a 1000×800 source give crop
`[100,200,400,200]`, rotate 90, straighten 10 → 135×382; A adds 20 → 175×422. Narrow crop
`[180,230,200,120]`, rotate 180, straighten 5 → 191×103; B adds 10 → 211×123. Base point
`(182,248)` is outside the first crop's realized support but inside A, D, and B's retained interior.
Removing A while B survives must make that point black/warned; removing both makes original pixels
admissible under the current D controls. Removing only B retains A at that point. Re-enabling restores
the corresponding state without regeneration. Exact transition is
`M(A→D) = M(base→D) × inverse(M(base→A))`; an angle difference omits translations, raster floors,
and crop centers. This numerical check proves the proposed coordinates, not rendered outpaint pixels
or permission to fuse ordered samplers.

Implement the immutable canvas/extent recipe and the
canonical layer/output builder together. Current enabled layer state derives the extent; do not add
a mutable canvas table. New constrained node kinds or roles use the next numbered migration with its
schema fixture and upgrade test. All output-building paths must retain the same extent contract.

**Verification:** deterministic artifacts first, through public layer mutations and show/export.
Independently known original pixels copy exactly at integer offsets; source bytes/catalog dimensions
stay unchanged. Cover nonzero crop origin, quarter-turn, straighten, negative detail selection,
repeated expansion, disable/remove/reorder/duplicate/clear/undo, later develop, and offline density.
An outpaint-only smoke path that cannot survive those ordinary edits is not this checkpoint.

## 12f3 — Generation and complete CLI journey

Add `fill <id> --outpaint (--px N | --aspect R)` without a required existing layer. Reject mixed
operations and invalid/unsafe dimensions before external work. Extend the existing fill planner,
branch descriptor, and refresh/retry owner rather than adding a parallel ancestry interpreter.

The request stores exact authored input/output frames and intrinsic sampling separately from final
placement. Reuse input capping, native mask encoding, adapter frame validation, optional configured
upscaling, canonical resampling, artifact-first publication, atomic revision activation, and lazy
preview materialization. Outpaint's mask is exterior-only; ordinary expand/free fitting must not
dilate inward and weaken original-side protection.

**Verification:** real HTTP fake bodies prove sent RGB/mask pixels, dimensions, and request count.
Corrupt/aspect-invalid generation leaves extent and revision untouched. Upscale failure retains usable
generation with existing warnings. The shared built/packed CLI journey covers outpaint on an edited
crop, native exterior detail, a subsequent local edit in the extension, repeat expansion, layer
removal and undo, offline show, and export identity. No later inspection or ordinary layer edit
replays a provider.

## Visual and closeout gates

Every visual checkpoint uses the same asymmetric scene, original landmark, and border crop at matching
density. Judge placement/clipping first and photographic seam continuity separately. Run
`compare-screenshots`, then unprimed `screenshot-critique`; include full captures and edge crops.
Open the relevant shots with `preview-shots` for a non-blocking review window, record the provisional
verdict if silent, close the window, and continue other work. Keep captures and critique in the spec's
assets. Synthetic generation proves mechanics only; configured live photographic evidence is distinct.

Run `review` and `audit-choices` for each focused pass. Update the parent handoff and this plan after
each checkpoint. Whole-spec review, the root closeout gate, and archival wait for the full requirements,
not the first green outpaint example.
