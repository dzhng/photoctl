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
- Expansion is provisionally centered. `--px N` adds N on every visible edge. `--aspect R` grows the
  smallest necessary axis without cropping; use integer offsets, giving an odd extra pixel to the
  right or bottom rather than shifting source pixels by half a pixel. Matching aspect is a no-op with
  no provider request or new revision. Actual dimensions are reported.
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

## 12f2 — Canvas authoring and reversible extent

**Decision checkpoint before coding:** use an asymmetric cropped, quarter-rotated, straightened
example to settle the viewport policy. Merely retaining the prior final crop hides the extension;
clearing it reveals previously excluded content. An authored extent after straightening is an affine
rectangle in original coordinates, not necessarily an axis-aligned base bounding box.

The plan must resolve these outcomes before this checkpoint is implementation-ready:

1. How a crop that preceded outpaint differs from an explicit crop applied afterward, and how later
   rotate/straighten changes act on the authored extent. One graph owner must encode that temporal
   geometry; do not maintain a second unsynchronized crop or canvas width beside develop state.
2. Which enabled layers contribute extent and what opacity zero means. Recommended: extent belongs
   to enabled outpaint layers independently of opacity, so fading does not resize the canvas.
3. Removing an inner border while a later outer border survives. Retained authored pixels must not
   shift or trigger a provider call. Any resulting uncovered area requires an explicit opaque-output
   background and warning policy; accidental zero-filled buffers are not a product decision.
4. Absolute authored footprints versus relative repeat requests. A successful second `--px` expands
   again; retrying a failed generation must not accidentally apply its expansion twice.

After those decisions are materialized, implement the immutable canvas/extent recipe and the
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
