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
