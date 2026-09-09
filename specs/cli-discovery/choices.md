# Implementation choices

## Sound — direct typed-buffer quantization (high confidence)

**When:** memory fix. A full-resolution image is already a compact floating-point
buffer. The iterable conversion temporarily expanded its samples into boxed
JavaScript values before creating the byte output. Both encoder preparation and
text grounding now allocate the required byte buffer directly and fill it by
index, keeping the same clamp and rounding expression.

**Gap:** the failure initially looked like runtime sizing; the implementation
choice was whether to enlarge the heap or remove unnecessary allocation first.
**Reach:** one render color helper owns conversion for both consumers. No model,
pixel resolution, native tensor ownership, process heap setting or user-facing
memory control changes. The small-heap regression setting is an instrument that
detects accidental boxed allocation, not a product memory requirement.
**Verdict:** sound; the exact failed Docker workload passes without raising its
heap limit. **Confidence:** high.
