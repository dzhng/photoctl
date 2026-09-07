# 13 — 13a reimagine/relight/generate · 13b auto_enhance · 13c markup · 13d retouch

The integrated geometry/offline contract is owned by
[full-frame authored coordinates](13-full-frame-geometry.md). Whole-spec release
and live photographic acceptance remain separate from its verified creation and refresh.

- **13a** ✓ `reimagine <id> --prompt ... [--strength f]` runs Slice 12's shared DAG planner with `scope:"full-frame"`: captured photographic input → generation →
  optional density-matching generative upscale → authored-frame placement → `role:"reimagine"` layer root
  (never overwrite), `drift:"full-frame"`; C3 template. Strength defaults to `1`, is bounded to `0..1`, becomes both versioned
  provider guidance and a constant full-frame composite coverage, and therefore has a defined pixel effect. Removing the layer
  redirects the active revision to its prior root and pixels exactly. The keyless fixture proves lazy materialization, one generation
  plus optional configured upscale, target dimensions, provider provenance, no native mask, and no provider rerun during show/remove.
  Cropped, rotated, straightened and reduced offline inputs retain their authored
  frames through the shared placement owner. The linked full-frame plan owns
  input selection, density, placement and explicit refresh; catalog dimensions
  must not be substituted for a realized input frame.
  ✓ `relight <id> --azimuth 0..360 --elevation -90..90 --intensity 0..1` applies the versioned C3
  soft-key-light template through that same full-frame owner. Intensity controls both the provider guidance and whole-frame blend,
  so zero preserves current pixels and one applies the generated result fully. It creates another removable `role:"reimagine"`
  layer named Relight, retains `drift:"full-frame"`, stays lazy, and inherits the authored-frame and atomic-failure contracts.
  The deterministic built-CLI captures and comparison telemetry live in
  [`../assets/relight-journey/`](../assets/relight-journey/).
  ✓ `generate --prompt [--ref] [--size 1024x1024] [--seed] [--model]` → canonical generated artifact → imported photo tagged
  `generated`; it has no base-density target, so library `auto` does not invent one. Explicit `--upscale` uses the requested
  `--size` only when the provider returned fewer pixels. Text-only `generate@2` has no source input;
  reference-bearing `generate@3` has a pinned reference, not an invented editable base. An
  output wrapper lets the imported photo enter ordinary show/develop/export flows while the pinned execution retains provider
  provenance and never reruns during lazy display. The deterministic visual checkpoint lives in [`../assets/generate/`](../assets/generate/).
  Tests: `reimagine-layer.test.ts` (full target dimensions; remove restores),
  `reimagine-upscale-fallback.test.ts` (generation survives upscaler failure), `reimagine-journey.test.ts` (built CLI),
  `generate.test.ts`, `relight-template.test.ts`. Deps 12.
- **13b** `develop <id> --auto-enhance`: `develop/stats.ts` on the 1024 sRGB preview (Rec.709 Y; p02/p50/p98/clipped/mean_sat/est_wb_k)
  → `StructuredModelAdapter` with the C4 schema → one `--set` batch, clamped; `develop_before_auto` stored for `--undo-auto`.
  Test: fake output lands, clamped, `--undo-auto` restores. Deps 09a, 08.
- **13c** ✓ Migration (next number) `markup(photo_id, items jsonb)`; `markup add <id> --json '{type,…}'` with per-primitive shapes:
  `text{at,text,size_px,color}`, `arrow|line{from,to,width,color}`, `rect|ellipse{bbox,width,color,fill?}`, `path{points,width,color}`,
  `highlight{bbox,color,opacity}`; bundled OFL font Inter; `photoctl-image::draw` into the composite node; `markup list|update|remove|clear`.
  Test: opaque red rect → red pixels there, nothing else changed. Deps 10.
- **13d** ✓ `retouch <id> --at x,y [--radius n] [--norm]` (default 2 % long edge) → the deterministic native
  `photoctl-image::heal` fast-marching fill with bounded harmonic refinement as a `role:"retouch"` layer with a permanent circular mask; idempotency key
  `(at, radius)`. The target radius is independent of the recipe's fixed three-pixel reconstruction neighborhood. The heal consumes
  the current pre-retouch document output, while the existing composite owner preserves every pixel outside the mask bit-for-bit.
  Tests prove native/graph determinism, oriented and normalized coordinates, lazy materialization, exact repeat reuse, independent
  export decoding, zero gateway work, and canonical outside-mask equality. Deps 10.

Every 13a/13c/13d pixel mutation creates typed nodes whose full input artifact hashes and parameters determine the active output
root/render hash, returns a new document revision without eager preview work, and extends `agent-preview-loop.test.ts` with at
least one representative mutation. The next `show` remains the only required preview-materialization step.

## Original command controls

`generate --neg` is versioned exclusion guidance appended to the provider prompt, not a native
negative-conditioning parameter or a guarantee that the model obeys it. The optional public
`negative_prompt` record retains requested text, applied mode, guidance version and actual provider
prompt; the immutable generation request and attempt journal retain the same record. Missing
`--neg` leaves the existing prompt, recipe version and request metadata unchanged. Empty guidance
is refused before library/provider work. The existing gateway adapter applies guidance on both
text and reference routes; real HTTP fixtures verify transmitted text and saved provenance.

Reference `--strength` is optional versioned variation guidance: higher means
more freedom to vary, with zero asking for closest preservation and one allowing greatest variation.
This direction was approved by the user on 2026-09-07. Unlike reimagine,
standalone generation has no editable base to blend: zero is not an exact-copy guarantee and no
value is a native denoise setting. The optional `reference_strength` record retains the requested
number, applied guidance mode, version and actual provider prompt in the public result, immutable
request and attempt journal, sharing the exclusion-guidance owners. Missing strength leaves existing
requests unchanged. Values must be finite and within `0..1`, and require `--ref`; invalid intent is
refused before reference/library/provider work. A reference the adapter cannot send makes explicit
strength a usage error before any paid attempt, rather than silently buying unrelated text generation.
The abbreviated reference-only `generate --ref` form
means a new variation of the supplied image, preserving its main subject and composition while
allowing detail changes. A versioned default instruction is used only when `--prompt` is absent;
an explicitly empty prompt is still invalid. The pinned reference and resolved instruction remain
inspectable, and the input file is never imported or modified. This is generation, not a byte-copy
or an exact-reconstruction promise. A model that cannot receive the reference must refuse this
reference-only request before buying an unrelated text-only result. Explicit prompt+reference
requests keep their existing unsupported-reference warning policy.

Reference-only command verification passes eight generation checks and command typechecking.
The public dispatcher first failed with the old mandatory-prompt error, then passed while
the real HTTP fixture observed the resolved instruction on the edit route. A separate RED
proved that an unsupported adapter bought an unrelated text-only image; its correction
leaves both catalog and provider-attempt journal empty. Existing explicit-prompt, reference
retention, upscale and provider-failure checks remain green. This is deterministic command
and transport evidence, not live provider acceptance or photographic variation quality.

The combined `fill --move … --scale` form uses the shared density preparation and one vacancy
revision; [Slice 12](12-fill.md#combined-movement-and-scale) owns its coordinate and failure contract.
[Existing-photo path lookup](01-first-jpeg.md#existing-photo-path-lookup) is implemented without
implicit import; Slice 08 owns the implemented filter and sampled white-balance commands.

## 13a upscaler quality spike (non-blocking)

The fake adapter is the contract gate. When an upscaler is explicitly configured, `wb upscale-spike` uses identical inputs to make
separate contact sheets for: (1) guarded inherited vs minimal prompt; (2) balanced control strength; then validation-only sheets for
face/hair, fabric/foliage, repeating architecture, generated text/logo as an expected danger case, and a mask crossing detailed
texture. Never mix prompt and strength judgments in one sheet. Each sheet records source/provider/target dimensions, resolved
adapter/model/version and controls, latency/cost, prompts, mask, and crop. Run `compare-screenshots` for candidate-against-source
telemetry and `screenshot-critique` last. Open with `preview-shots`; wait about five minutes, then choose from evidence and record the
release default/control values if the user is silent. Missing credentials records `not_run:unconfigured` and does not block the slice.

The deterministic runner accepts an explicit experiment manifest, rather than borrowing ambient credentials or changing library
settings. The [runnable fixture and report evidence](../assets/upscale-spike/) demonstrate separate prompt, single-control, and
category-validation sheets. Category labels are operator declarations, not image classification or quality acceptance; missing
categories remain explicit. Provider-reported normalized controls are currently unavailable and must not be inferred from requests.
Completed provider work is shared by exact request identity across inspection cases within one run; crop/category changes do not
purchase identical work again. Source/detail files and provider-accounting evidence remain separate from photographic acceptance.
Live photographic comparison and release-default selection remain unverified.

## Paid response retention — shared artifact and attempt ownership

The [bounded format measurement](../assets/artifact-storage/) distinguishes exact original encoded
responses from canonical working pixels. Original paid generation/upscaler bytes stay unchanged
through the existing artifact owner, linked to their library attempt, while the graph uses exact linear
TIFFs inside the graph. Do not introduce a second publication, availability, or retention lifecycle.
Historical missing originals remain explicitly unavailable; never re-encode working pixels and label
them the original response or replay a paid request during repair/inspection.

The provider boundary now awaits exact decoded response capture before PNG normalization, separately
from the working image. Generation and upscaling share that contract, including refresh and
transform-triggered density work. Mapped upscales retain the whole response before its working crop
and keep the adapter's coordinate mapping in provenance. A custom adapter that omits required capture
cannot commit a successful library execution; artifact persistence failures cannot become ordinary
upscale fallbacks.

Content classification, not execution role, validates stored artifacts. Migration20 adds the artifact
validation profile and backfills working RGB TIFFs, mask TIFFs, and reference PNGs without relaxing
their validators. A provider TIFF that passes strict canonical validation has the same classification,
hash, and file as identical working bytes; an ordinary encoded TIFF must never enter the working
reader merely because its MIME type is `image/tiff`. Sniff the actual format and intrinsic dimensions,
retain unchanged bytes, and dispatch availability checks by that content classification.

The current adapter accepts more Sharp-decodable formats than PNG/JPEG/WebP. Preserve successful
format acceptance (including encoded metadata and extra frames) while leaving current working-image
conversion semantics unchanged; do not silently narrow acceptance or call a converted PNG original.
Working readers remain strict. Both artifacts must be durable before a successful execution/revision
transaction links them; an upscale fallback cannot hide failed original publication and claim retention.

**One attempt record owns the returned image, including rejected work.** Success-only execution links
would miss valid images rejected before a node exists. Use a library-owned provider-image attempt
journal now, and a nullable execution→attempt foreign key, rather than implementing a success-only
original link that immediately needs another owner. Standalone generation creates no dummy photo or
node. Historical NULL means not retained; a linked missing/corrupt file means unavailable.

The journal records a sanitized typed request, observed provider provenance, exact original artifact
link, state/outcome, and timestamps. Commit `started` before sending, then publish/register valid
returned bytes and commit `retained` before aspect, frame, density, or whole-frame policy checks.
Rejecting the image records `rejected` without losing it. The existing successful revision transaction
attaches the execution and marks `committed` atomically; later conversion/commit failure records
`failed` when possible. A crash can leave `started` or `retained`: incomplete is not proof of provider
failure, and cannot trigger an automatic retry. A publication/registration failure can still leave an
orphan; never claim filesystem/database atomicity. Corrupt/non-image bodies have no invented image
artifact or dimensions.

One attempt is one application-level provider invocation, not every transport retry. Record observed
retry counts and nullable reported cost. Explicit repeat invocations get distinct attempts even when
their bytes deduplicate; reusing purchased work retains its existing attempt link. Every attempt's
original is a retention root independent of photo deletion or revision activation. Provide bounded
read-only list/detail inspection and include attempt IDs in rejection/fallback diagnostics, so a user
can find retained work. Do not add speculative grouping/configuration fields or automatic pruning.
The projectless workbench remains outside library retention unless given an explicit library context.

Verify exact bytes and distinct original/working dimensions, same-response deduplication, undo/history
reachability, pre-migration absence, backup/restore with intact/missing/corrupt files, and publication
or revision-conflict failures through real command flows with zero automatic provider replay.
Metadata-only backups do not become portable image-byte backups. These checkpoints do not enable
automatic deletion: representative undo-history measurements must separately choose count/age/storage
limits.

The implementation boundary is [`provider-images/`](../../../packages/render/src/provider-images/):
the journal orchestrates the existing artifact owner, and revision commits attach prepared executions
atomically. One attempt may be referenced by multiple execution aliases when graph intent changes
without buying the image again. Historical execution links remain NULL rather than inventing an original.
`graph attempts` is a bounded metadata listing: `recorded_available` is the catalog's last-known state.
`graph attempt <uuid>` validates that original's current bytes and returns `available`; neither command
repairs files or invokes providers. Lists omit image bytes; oversized detail records are explicitly truncated.

The schema20 fixture comes from accepted and rejected public fake-gateway generation calls. Public
regressions cover retention before policy, mapped pre-crop bytes, refresh and density work, reuse,
independent-attempt deduplication, typed commit/cache failures and metadata-only restore. Format tests
preserve metadata, orientation and extra encoded frames while independently enforcing working validators.
No live provider or photographic quality claim is made by these retention checks.

Photo removal clears the selected photo's graph references inside the existing catalog-removal
transaction before deleting the photo. This ordering satisfies immutable graph foreign keys without
weakening them. Attempts and artifacts remain library-owned, including originals shared by other
photos. The public generated-photo removal journey retains inspectable originals without provider
replay; a forced post-teardown failure restores the graph together with staged source/cache files.

The editable develop input is an immutable RGB branch, not necessarily a source leaf. The shared
[`base-input`](../../../packages/render/src/graph/base-input.ts) reader unwraps only the direct editable
develop node beneath the base output. It preserves a purchased upscale and any exact final resample
as the input for later edits, rather than tracing back to generation and discarding processing.
Public show/develop/export regressions prove unchanged target dimensions, replacement rather than
stacking of exposure edits, matching current delivery pixels and no additional provider work.

## Checkpoints: one artifact per sub-slice, one variable each; all inherit the root visual gates and non-blocking review rule.

Firewall: `unblur` cut; no generic local generative runners. A future local UpscaleAdapter is allowed only as a separately configured
external-boundary implementation; this slice does not add one.

## 13b public auto-enhance checkpoint — 2026-09-05

The public develop command sends the current graph render as a 1024-pixel-long-edge sRGB JPEG to the fixed structured-model purpose.
Its stats contract uses transfer-decoded linear light for Rec.709 luminance and gray-world McCamy temperature, type-7 interpolated
percentiles, encoded-sRGB mean saturation, and the literal C4 clipping fields `clipped_lo_pct` and `clipped_hi_pct`. The versioned C4
prompt owns its narrower proposal ranges; accepted values are clamped there and then enter the ordinary develop mutation owner as
one batch.

The resulting revision atomically stores a versioned auto-enhance discriminator, `develop_before_auto`, and the structured execution
identity in generic revision metadata.
Only an active auto-enhance revision can be undone, so a later manual edit cannot silently discard newer intent. Provider or schema
failure leaves the active revision unchanged. Preview materialization remains current and lazy: auto-enhance renders because pixels
are its required model input, while the newly committed develop result is not rendered until the next consuming command.

The deterministic visual checkpoint and its no-op/geometry telemetry live in [`../assets/auto-enhance/`](../assets/auto-enhance/).

## 13c vector-markup checkpoint — 2026-09-05

Markup is one ordered vector document owned by the photo. Its strict public item schemas are the durable editing contract; the
active render graph carries the same document in a deterministic final `markup` node so previews and exports share one flattening
path. Adding, updating, removing, clearing, and revision undo keep the table, active revision, and render identity atomic.

Coordinates remain in oriented, uncropped base space. The renderer rasterizes there, then projects premultiplied color and coverage
through the active develop geometry before compositing over the final RGB result. That preserves crop, quarter-turn, and straighten
semantics without rewriting stored vectors. Display-sRGB style colors are converted to scene-linear Rec. 2020 before blending, and
the bundled Inter font makes text deterministic without a host-font dependency.

The deterministic checkpoint in [`../assets/markup/`](../assets/markup/) shows the exact unchanged base, the flattened red rectangle,
and the same base-space rectangle after crop plus rotation. The CLI journey also proves lazy materialization, exact restoration after
removal, and bit-exact pixels outside the primitive for the identity-geometry case.
