# Selection intent survives the backend boundary

The user explicitly wants both fine hair selection and whole-person selection.
The PhotoLab hair reference remains a quality target for the former; it must not
turn into a universal rule that selecting a face or clothing is always wrong.
Correctness is relative to the requested target.

Held objects need an explicit interpretation too: visible human pixels and a
person-with-bouquet foreground group are different valid requests. The
[person comparison](assets/sdmatte/critique.md) shows why a backend's broader
foreground behavior must be disclosed instead of treated as an interchangeable
person mask. Exact preset names and grouping syntax remain design work.

## Separate meanings

Target identifies what to select: hair, a person, sky, a road, or a descriptive
concept. Instance selection identifies which matching object, or all matches.
Positive/negative spatial prompts correct membership. Quality controls boundary
detail and computation, not semantic extent. Combining instance masks into one
layer is an output operation, not another meaning of scope.

A broad/narrow slider would conflate these meanings. Prefer explicit target text
and instance selection, with presets in a future UI rather than a closed list of
hard-coded object classes. CLI and UI should submit the same typed request.
Candidate selection must be tied to the source revision; a candidate identifier
from an earlier render cannot silently refer to a different object.

The exact new flags, defaults, response metadata and candidate-selection lifetime
remain design proposals, not implemented interfaces. Existing geometry projection,
layer storage and revision ownership must remain authoritative.

## Existing seam and required change

The current [segment command](../../packages/commands/src/handlers/segment.ts)
asks a structured vision model for every matching instance, then forwards only
boxes and positive points to the local segmenter. Text no longer reaches the
mask-producing model. Combining text with points currently applies the same
points to every returned candidate; it is not an instance hit-test.

The user has now approved changing that combination: text describes the kind
of thing and `--at` chooses which matching instance. No-match and ambiguity must
be explicit errors rather than broadcasting the click or guessing. The command
slice in the [implementation ladder](implementation.md) owns that cutover.

Preserve target intent through that seam. Grounding may help locate an object,
but a bounding box must not become the entire definition of "hair" or "person".
The [configured segmentation path](../../packages/commands/src/segmentation.ts)
already owns image preparation and coordinate projection; do not build another
coordinate system to add model routing. The existing
[response schemas](../../packages/protocol/src/verbs/layers.ts) already expose
per-instance layers and masks.

Backend selection must respect capability. Apple's current person mask is a
legitimate candidate for a person request, not a fallback that silently enlarges
a hair request. An unsupported target should remain visible as unsupported or
be handled by a capable backend under the same intent. Detailed edges do not
excuse changes to semantic exclusions.

## Verification implications

Use the same portrait for distinct hair and whole-person requests, and assess
each against its own scope. Add a multi-instance case before claiming point
selection or all-matches behavior. Verify positive/negative corrections, empty
matches, ambiguity, source-revision binding and output grouping at the API seam.
Quality changes must preserve requested scope. Saved masks remain replayable
without rerunning a model or silently changing its revision.

The [SAM 3 native concept baseline](assets/sam3-native/critique.md) demonstrates
distinct hair/person output and per-instance masks on a synthetic duplicate
case. It remains a seam feasibility result, not a proven implementation choice:
fine boundaries fail review, and real multi-person behavior remains unverified.
Scope and edge quality must both pass before adoption.
