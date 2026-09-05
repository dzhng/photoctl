# 11 — segment: 11a SAM 2.1 runtime, 11b verbs

## API seam
- **11a** `scripts/export-sam2.py` (pinned `facebook/sam2.1-hiera-small` commit) → `encoder.onnx`, `decoder.onnx`; sha256 + opset in
  `fixtures/models.json`; download base `settings.models_base_url` (public distribution OPEN; local HTTP supported) with hash verification; cache
  `models/` pinned. `photoctl-image::sam2` via `ort` CPU EP (D40); encoder once per `(id, tier)` cached in the daemon; decoder per
  prompt. Input = develop render (offline: 1616 tier) letterboxed to 1024 (mapping in `coordinates.ts`); 256² logits → bilinear
  upsample → threshold 0 → base-res mask. Docker: weights fetched in the Dockerfile with hash check (missing → loud failure).
  G6: encode ≤ 4 s on M5 CPU, RSS ≤ 3 GB. `doctor --fetch-models`.
- **11b** `segment <id> --at x,y… [--dry-run]` (SAM point prompts; may combine with `--box`); `--text "…"` → `StructuredModelAdapter`
  Zod `{instances:[{box_2d:[ymin,xmin,ymax,xmax],label}]}` (0–1000, converted in the adapter) → SAM box prompt per instance, one layer each.
- `fixtures/a7c2.json` gains `sam_probes:[{at:[x,y], min_area_pct, max_area_pct}]` derived from frame content, not model output.
- `wb masks <id>`.

## Verification
`segment-at.test.ts` (mask contains the click; area within the probe band for each probe); `segment-text-fake.test.ts` (canned boxes
→ N layers in base coords; `--dry-run` → zero rows); `cargo test -p photoctl-image sam2::`.

## Delegated: embedding-cache eviction.
## Checkpoint: `wb masks` — edge quality on a hair/foliage crop.
## Must stay green: 01–10. Deps: 09a, 10. Firewall: no SAM 3; no macOS 27 API; CPU EP only.

## 11a keyless checkpoint (2026-09-05)
The pinned export, manifest, hash-fetch/cache, CPU ONNX session, 1024 letterbox, base-mask logit, and daemon encoder-cache contracts are implemented. The real CPU export now supplies both hashes; a configured local HTTP base can supply those files without credentials or public hosting. Public release distribution remains unconfigured. G6 and the `wb masks` visual checkpoint are separate from export parity and remain open here.

## 11b keyless command checkpoint (2026-09-05)

The command boundary accepts repeated base-coordinate point prompts, an optional box, text grounding, and non-mutating dry runs.
Text grounding uses the strict structured-provider schema, whose adapter is the only owner of normalized-box conversion; all
returned masks enter one atomic document revision, one subject layer per instance. Injectable local and structured adapters keep
the command contract keyless and make an empty text match a successful no-op.

## Production integration checkpoint

The command now constructs its local and text adapters, with lazy hash-verified CPU sessions retained by the daemon.
The encoder cache belongs to the SAM runtime and evicts least-recently-used feature sets; it also checks rendered pixels so a
develop or source change cannot reuse stale features. Model loading and failed encodes remain retryable.

SAM consumes the current develop render, including crop and rotation. Shared develop geometry maps base-coordinate prompts
into that render; text boxes belong to the render shown to the grounding provider. Native projection samples decoder logits
directly back into uncropped base coordinates before thresholding, leaving pixels outside the crop unselected. Catalog
dimensions are already oriented and must not receive EXIF orientation a second time. Mask publication is sequential so text
instances do not retain many full-resolution pixel buffers; their catalog state still enters one atomic revision. Dry runs
do not create graph rows or publish masks.
The compositor shares the exact-execution base projection with markup, so a base-size mask remains renderable when the RGB
source is reduced or the develop frame is cropped. Its geometry follows the artifact being consumed, not a newer evaluation
at the same logical node.

The tensor contract is grounded in the [pinned ONNX Runtime exporter](https://github.com/microsoft/onnxruntime/tree/3af6be475c8ce64d3fb0851706ec7e432ad2223c/onnxruntime/python/tools/transformers/models/sam2):
one encoder execution returns all feature levels, the decoder's own prompt encoder adds its padding token, and the local
mask path consumes floating-point low-resolution logits rather than the exporter's thresholded output.

Production construction, point/text routing, geometry, cache reuse/eviction/retry, and dry-run behavior have deterministic
tests. These are wiring evidence, not model-quality evidence. The checked-in release now pins a real export;
real `segment-at` probes now pass the independently authored `a7c2` area/click checks.
The portable real-model probe belongs to both default Docker and macOS gates, alongside their
existing test coverage. Docker's functional image inherits the hash-verified model stage; its gateway
fixture stops at the built application stage. [Model provisioning](../../../fixtures/README.md)
requires an explicit base URL for Docker or an existing host model directory. No public release host
is invented, and missing prerequisites cannot silently select an empty or skipped model suite.
Detailed edge acceptance and full-command G6 remain open independently.
[Export evidence](../assets/sam-export/README.md) records the real Hydra resolution regression, raw-logit ranking normalization,
unchanged parity tolerances, and fail-closed publication boundary. Export-process RSS is not inference-process RSS.

## Linux runtime initialization — causal proof, integration next

The mandatory Linux model gate is red before inference: loading the ARM64 addon emits an ORT
CPU-vendor warning outside the NDJSON stderr contract. The
[portable gate evidence](../assets/sam-photographic/README.md#portable-gate-checkpoint) identifies
the native static initializer. Do not filter stderr, make this test optional, disable CPU features,
change model hashes, or downgrade ORT to hide it.

The [bounded source-build proof](../assets/ort-lazy-proof/README.md) changes initialization timing:
replace eagerly initialized CPU facts and CPU-reading dispatch selections with function-local
cached accessors, updating every consumer. It uses ORT source
`da9b5e364c465de65c49d91e696cd6485270757f` (1.28.0, reported by the shipped archive), the same
explicitly pinned artifact-builder recipe and its existing patches for baseline and candidate,
and unchanged CPU build flags. The served archive's exact builder provenance has not been
established: this is a same-recipe causal comparison, not binary equivalence or release acceptance.

The real compiled baseline reproduces raw stderr. Deferring only three KleidiAI CPU facts also
fails; compiled inspection exposes three NEON dispatch objects and four CPU-reading kernel
selections that initialize early independently. Deferring those too produces empty raw stderr,
preserves the warning through the explicit logger, and retains identical feature values,
identity output and invalid-model rejection. Fixed non-CPU-reading selections are unchanged.
This tiny witness does not establish failed-worker diagnostic delivery, model parity or CLI
acceptance; those are the next integration proof, using the existing runtime-library override.

Only after that proof, resolve production diagnostic delivery and runtime acquisition together.
The existing native worker's ready/job result boundaries and the command's stderr-event transport
are the candidate owners; initialization and job errors must retain typed diagnostics. A cached
runtime must never retain a request's event callback. Avoid a second Rust stderr emitter, global
request routing, or deferred-warning queue unless the proof demonstrates an actual need.

A production patch must have one pinned, reproducible source/patch/build identity selected by host,
Docker, and release builds; none may silently fall back to the old archive. The supported
`ORT_LIB_PATH` static-link seam is available, but distribution details remain to be decided from
the proof. Public artifact hosting stays unconfigured until explicitly supplied. Acceptance requires
load/identity/error tests, unchanged model parity, actual strict CLI model gates, and packaged-target
load checks; coarse Mac success alone cannot close Linux or release compatibility. No database
migration or backward-compatibility shim is required by this proof.

## Mask inspection contract

`wb masks` reads committed active masks beside the highest-resolution available cached execution of the current develop root,
with newest-created execution breaking equal-area ties. This is not necessarily the source tier last reused by `show`.
It names the RGB
artifact and execution separately from the immutable mask identity: current context is not a replay of the original SAM input.
Missing cached context asks for `photoctl show`; inspection never invokes a model or fetches a source. Layer staleness remains
visible. The compositor and report share exact-execution geometry, preserving crop, rotation, reduced source density, and
fractional mask coverage.

Each layer exposes one bounded native-detail crop at its first covered edge, with context, coverage, and an edge overlay.
The fixed crop is an inspection starting point, not an automatic hair/foliage selection or quality verdict. Synthetic report
tests verify pixel alignment and identity only; the real-weight hair/foliage checkpoint remains open.
[Synthetic capture evidence](../assets/segment-masks/README.md) records the report-only visual review.

## Photographic checkpoint

[Real-photo evidence](../assets/sam-photographic/README.md) records passing coarse subject probes,
failed foliage/wire and distant-path edges, and a full-command RSS breach before inference.
The default scan-order workbench crop is not sufficient to reveal these defects; targeted detail
crops remain necessary. Exact pointwise buffer reuse and pixel-free cached dimensions are integrated,
and prepared handles release full-frame captures before inference. Native color snapshots now
report their capacity to Node; six no-forced-GC CLI runs preserve exact masks and pass the unchanged
3 GB RSS band on the fixture host. With resampler snapshot accounting, the unchanged sixteen-input
full-resolution cache probe also passes at 2.842 GB peak RSS, preserving exact masks. The
[resource evidence](../assets/sam-runtime/) records host conditions and separates that runtime
probe from public commands in one persistent daemon. Six repeated same-photo public requests pass
at 2.221 GB peak RSS with one 1.297-second encoder run and exact masks. The combined public
nine-identity eviction/reuse witness also passes all eleven requests at 2.625 GB peak RSS and
2.160 seconds maximum encoder time. Tail-distinct copies preserve the same photographic pixels;
this records host/fixture resource acceptance, not arbitrary-image bounds, other platforms or
photographic edge quality.
The actual photographic tensor now agrees with pinned PyTorch at the unchanged tolerance, including
all but two full-resolution mask pixels. Controlled square geometry improves wires/path but worsens
foliage; both fail the target. The full upstream predictor also fails with single-mask and automatic
highest-score multi-mask output. Refinement beyond the specified projection remains a separate
decision, not an accepted implicit change. Neither numerical parity nor coarse area bands closes
edge quality.
