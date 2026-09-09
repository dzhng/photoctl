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

## Sound — named axes on the provider wire (high confidence)

**When:** first live whole-person capture. The provider returned sensible
normalized coordinates in vertical/horizontal order, although a schema
description requested horizontal/vertical order. Reading the pair as instructed
put positive points on flowers and negative points on the person. The wire now
requires `at: { x, y }`; the adapter converts these to the existing pixel pair.

**Gap:** the earlier contract assumed a tuple description would disambiguate
axes reliably. **Reach:** only segmentation's external structured response
changes. CLI coordinates, internal signed points, boxes, saved masks and other
structured schemas keep their meanings. Ordered wire pairs fail instead of
triggering a heuristic transpose; no compatibility parser can reintroduce the
ambiguity. **Verdict:** sound; the fresh live response uses named axes correctly,
although the score-selected model still misses hair/clothing for the person
request. Wire correctness is not a promise of semantic completeness.
**Confidence:** high.
