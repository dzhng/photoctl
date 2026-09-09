# Full-resolution preparation without heap inflation

Reproduce `Uint8Array.from(Float32Array, mapper)` allocation in the actual
encoder-input and grounding pixel paths using a small subprocess workload.
An indexed typed-buffer conversion should preserve exact clamp/round semantics
without materializing a boxed JavaScript sample list. Share that conversion in
the render color owner; do not duplicate it or change resampling/color meaning.

One red/green test at a time: constrained-heap subprocess proves the failure;
the same pixel values and prepared tensors must pass after the fix. Its heap
limit is a regression instrument for accidental allocation, not a user runtime
requirement. Verify both consumers and existing pixel/projection tests.

Rerun the previously failing real Docker photographic segmentation test with
unchanged image, prompts, model and assertions. Measure runtime memory separately
from JavaScript heap. Do not lower image quality or ask the user to approve an
arbitrary ceiling. If further runtime sizing is needed, investigate and choose
it using workload and available resources. Keep the native cache and async tensor
ownership intact unless directly implicated by evidence.

Delegated: precise regression size and instrumentation that reliably separates
temporary boxed-heap amplification from required image/model storage.
