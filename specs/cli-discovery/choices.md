# Implementation choices

## Sound — separate fixture watchdog from response deadline (medium confidence)

**When:** full closeout. The foreground-tag test already asserts that the tag
operation finishes within two seconds. Vitest's implicit five-second watchdog
also included library creation, RAW import, worker settlement and database
verification, and expired during the full run. Its explicit fixture watchdog is
now twenty seconds; the two-second operation assertion and all persisted-result
checks remain unchanged.

**Gap:** the existing test conflated fixture lifetime with its responsiveness
contract. **Reach:** only this test's total lifetime allowance changes; no
product timeout, general runner default or tagging requirement is relaxed.
**Verdict:** sound; the whole-run red was a harness deadline, and the focused
retry passes the existing response and recovery assertions. **Confidence:**
medium; twenty seconds is a conservative watchdog, not a measured product bound.

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

## Sound — one executable discovery inventory (high confidence)

**When:** CLI help. A fresh agent can ask for help before any library exists.
Each command entry now couples its existing execution adapter with its usage,
description and examples; the same entries generate root discovery. Existing
handlers still validate execution. This replaces the dispatch ladder rather
than adding a separate list that could advertise commands the CLI cannot run.

**Gap:** the request required comprehensive discovery but did not dictate its
owner or output format. **Reach:** help uses the existing JSON envelope by
default, with readable `--human` rendering. Help is intercepted before library,
credential or daemon work; the existing configure/settings help bodies remain
authoritative for their special details. Daemon control keeps its execution
transport owner and contributes a descriptive entry. The root-linked guide owns
workflow concepts, not another exhaustive command roster. **Verdict:** sound;
the actual CLI exposes every advertised command without creating runtime state.
**Confidence:** high.

## Sound — retain live failures alongside controls (high confidence)

**When:** live verification. The first person request selected flowers; the
named-axis request corrected that misinterpretation but omitted hair/clothing.
Both results remain in the scene collection, alongside a separate hair control,
instead of keeping only the result that looks strongest.

**Gap:** the user requested reusable references, while these follow-up captures
exposed both an implementation defect and remaining model limits. **Reach:**
future evaluations can distinguish wire-contract correctness from semantic
coverage and reuse exact developed pixels, automatic guidance, scores and masks.
Source crops are shared; no duplicate RAWs, model weights, scratch libraries or
credentials are committed. Quantized alpha remains an observation, never an
ideal target. **Verdict:** sound; it preserves the failure cases without
inflating scene diversity or pretending a successful command proves quality.
**Confidence:** high.
