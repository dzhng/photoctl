# Final implementation choices

All surviving choices are sound; none requires a pending user decision. The user
imposed no memory ceiling. Review the medium-confidence fixture watchdog first,
then the named-axis wire contract that future grounding work inherits.

## Sound — medium confidence

### Separate fixture lifetime from the response requirement

**When:** full closeout, `2124096`.

**Choice and scenario:** The foreground-tag test measures the actual tag call
against an explicit two-second response requirement. Its implicit five-second
test watchdog also covered library initialization, RAW import, background-worker
settlement and database verification. That total expired during the full run.
The fixture now has twenty seconds to finish, while the tag operation still has
to meet the same two-second assertion and preserve the same stored results.

**Gap:** the earlier test conflated fixture lifetime with product response time.
**Reach:** only this test's watchdog changes. Product timeouts, runner defaults,
worker recovery and persisted tag/embedding checks remain intact. The alternative
of raising the operation assertion would weaken the behavior under test.

**Verdict:** sound. The focused retry passes the unchanged response and recovery
checks; twenty seconds is a conservative harness allowance, not a product bound.
**Confidence:** medium.

## Sound — high confidence

### Name external point axes instead of guessing tuple order

**When:** grounding repair, `8d3e440`.

**Choice and scenario:** A live provider placed plausible coordinates in
vertical/horizontal order despite an instruction requesting horizontal/vertical
order. The caller consequently included flowers and excluded the person. The
provider response now names `x` and `y`; the existing adapter converts those
normalized positions into internal pixel pairs. Old ordered responses fail
rather than triggering an image-dependent guess.

**Gap:** the earlier design assumed a tuple description reliably communicated
axis order. **Reach:** only segmentation's external structured response changes.
CLI coordinates, internal signed points, boxes and saved masks keep their
meanings. Other structured schemas retain their own coordinate interpretation.
The alternative—detecting and transposing suspicious points—would make geometry
depend on a heuristic that could silently choose the wrong interpretation.

**Verdict:** sound. Named fields remove format ambiguity without promising that
every suggested point or model mask is semantically correct. The subsequent
person result still misses hair and clothing, which remains a separate recorded
failure. **Confidence:** high.

### Fill typed pixel storage directly

**When:** segmentation memory fix, `0c0a2fc`.

**Choice and scenario:** A full-resolution image already occupies a compact
floating-point buffer. Iterable conversion expanded its samples into temporary
JavaScript values before making the byte image. Both model preparation and
grounding delivery now allocate the byte buffer and fill it by index, preserving
the same clipping and rounding.

**Gap:** the heap failure initially suggested raising Node's memory allowance;
the implementation had to distinguish necessary storage from accidental
amplification. **Reach:** one render color helper owns conversion for both
consumers. No model, resolution, native tensor ownership or runtime heap setting
changes. The small-heap subprocess test detects accidental allocation; it is
not a user or product memory budget.

**Verdict:** sound. The original Docker workload completes without increasing
its heap limit. **Confidence:** high.

### Couple discovery to the existing command inventory

**When:** CLI help, `99d361d`.

**Choice and scenario:** An agent needs to learn how to initialize and operate
a library before one exists. Execution command entries join their existing
adapters with usage and examples; daemon contributes discovery while retaining
its transport owner. Those entries also produce root help.
Execution still goes through the existing handler parsers. A second handwritten
command roster would allow documentation and dispatch to diverge.

**Gap:** comprehensive discovery was requested without prescribing its owner
or output format. **Reach:** help uses the existing JSON envelope by default and
readable human output when requested. It runs before credential, library and
daemon work. Configure/settings keep specialized help, while daemon control
keeps its transport owner. The root-linked guide explains workflows instead of
duplicating all command syntax.

**Verdict:** sound. The built CLI exposes every advertised command without
creating runtime state; this does not add another parser framework.
**Confidence:** high.

### Retain failed live cases alongside the hair control

**When:** live evaluation record, `9987eb3`.

**Choice and scenario:** The first person request selected flowers. The
named-axis request corrected that interpretation but still missed hair and
clothing. Both remain in the collection alongside a distinct hair request,
instead of retaining only whichever image looks strongest.

**Gap:** the requested reference collection needed to capture both the newly
exposed interface defect and remaining model limitations. **Reach:** future work
can separate coordinate correctness from semantic coverage using exact developed
pixels, automatic guidance, scores and observations. Source crops are shared;
model weights, raw tensor intermediates, scratch libraries and credentials are
not shipped. Quantized alpha is not relabeled as ideal ground truth, and these
variants do not increase the number of independent photographed scenes.

**Verdict:** sound. The record preserves useful failures with explicit replay
and rights limitations. **Confidence:** high.
