# Implementation choices

## Sound — native runtime diagnostic budget

- **When:** engine cutover, slice 04.
- **The choice:** allow a 10 GB peak in the native diagnostic probe. Selecting
  successive photos with the accepted ViT-L model has a larger warm transient
  than loading and selecting one photo. A cold-only budget would reject that
  ordinary workload even when the cache stays bounded and repeated work
  produces identical masks.
- **The gap:** the plan required measurement but did not set the replacement
  model's operational memory canary. It explicitly separated that canary from
  quality requirements. The former SAM2 budget is not a viable ZIM budget.
- **The reach:** this is a substantial memory requirement on the 48 GiB
  acceptance Mac, not a claim that low-memory computers can run the model.
  The probe still reports and fails budget overruns; no forced collection,
  lower-quality model, extra cache or platform validation was added.
- **Verdict:** sound. The complete repeated-encode workload informs the bound;
  the [runtime audit](assets/zim-contract/runtime-budget.json) retains the failed
  smaller estimate and the observations that distinguish a large working set
  from accumulating per-photo history.
- **Confidence:** medium.

## Restrict point conversion to the grounding response contract

- **When:** slice 02, signed-grounding implementation.
- **The choice:** only the segmentation response schema gives `points` the
  normalized image-coordinate meaning. If another structured request returns
  an annotation such as `[250,750]`, the adapter preserves those numbers.
  A blanket conversion of every field named `points` would instead move the
  annotation merely because an image accompanied the request.
- **The gap:** the plan named the grounding wire format, but the existing
  structured adapter also serves other schemas and recursively converts boxes.
  It did not specify how to keep new point conversion scoped.
- **The reach:** other structured features retain their own point semantics;
  callers requesting segmentation receive image-frame pixel indices.
- **Verdict:** sound. The schema name identifies the requested external
  contract without introducing a second parser framework or a public option.
- **Confidence:** high.

## Coordinate rule clarified during implementation

The implementation retains the frozen research conversion: multiply normalized
x/y by image width/height, divide by 1000 and round once. After validating the
provider coordinate is within 0–1000, an outer-edge result maps to the last valid
pixel index. It does not rescale every point by width-minus-one, and invalid
outside coordinates never become valid through clipping. This was an explicit
orchestrator clarification, not a new implementation choice.

Prompt wording and local parser factoring used the discretion delegated by the
slice. No public flags, command selection behavior, model table, persistence
schema, dependencies, live calls or model-inference policy changed in this pass.

## Acquisition: upstream location belongs to artifact identity

When: slice 01, 2026-09-09.

The choice: retain the official model subdirectory in the pinned manifest. When
doctor downloads ZIM, it now resolves the model's exact revision and its
`zim_vit_l_2092` directory. An explicit mirror still receives requests for the
flat `encoder.onnx` and `decoder.onnx` filenames. Omitting the subdirectory made
both upstream model URLs return 404 even though the revision was correct.

The gap: the plan specified a pinned upstream URL but did not name the directory
inside the upstream repository. The manifest's optional `source.directory`
field supplies that missing part of identity without creating a second URL
registry. This is an additive internal manifest field, not a catalog migration.

The reach: future model updates must retain their actual upstream location;
release files and configured mirrors retain their existing flat layout.

Verdict: sound. The pinned upstream file listing and a successful real download
establish the path. Confidence: high.

## Acquisition: stream model bytes and hashes through the existing fetch owner

When: slice 01, 2026-09-09.

The choice: write incoming chunks to a temporary file while computing their
hash, then publish that file only after the complete hash matches. Inspection
also hashes a stream. Downloading the real 1.24 GB encoder with the inherited
whole-body reader consumed 3.87 GB of peak memory; this became a practical
acquisition cost when adopting the larger model.

The gap: the plan required atomic failure handling but left the byte-transport
implementation open. Buffering the entire response and entire cache read was
unnecessary to enforce that contract. The new path retains one hash state and
bounded transport buffers, while failed downloads remove their temporary file
and leave the previous model untouched.

If either download fails, the fetch owner aborts the other request and awaits
both cleanup paths before returning the original error. Otherwise the CLI could
exit with a second download's temporary file still open. A dedicated regression
failed before this cancellation/settlement change and now verifies cancellation
and an empty temporary directory on return.

The reach: model size no longer determines the fetcher's retained byte buffer.
The change keeps the existing per-file atomic publication semantics; it does
not introduce a second model cache or a transaction across unrelated downloads.

Verdict: sound. A 128 MiB subprocess test failed with 275,431,424 additional
resident bytes, then passed the fixed 96 MiB allowance after streaming. The
interruption regression verifies recovery. Confidence: high.

## Acquisition: one authored manifest, generated release copies

When: slice 01, 2026-09-09.

The choice: keep the verified model identity in the library's pinned manifest.
Both doctor and release preparation consume it. Release verification writes
`models.json` for the distributed artifacts; no separately maintained fixture
manifest remains to drift from runtime identity.

The gap: the old exporter generated both a fixture JSON and a TypeScript copy.
Official ONNX acquisition no longer needs that exporter. Keeping both authored
copies would preserve an unnecessary agreement that tests would have to police.

The reach: a model update changes one manifest, and successful release
verification creates its machine-readable distribution copy. The existing
custom-manifest input remains useful for deterministic acquisition tests.

Verdict: sound. This follows the plan's single-owner rule. Confidence: high.

Delegated implementation details: keep notices in the library's packaged assets;
use named mirror/manifest options on the developer acquisition script; update
all live script callers together. Public OpenPhoto command shapes are unchanged.
