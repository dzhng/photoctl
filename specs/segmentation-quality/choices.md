# Grounding decisions

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
