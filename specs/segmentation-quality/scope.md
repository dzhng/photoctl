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

Instance selection belongs to the current command and source revision; it does
not create reusable candidate identifiers. Existing geometry projection, layer
storage and revision ownership remain authoritative.

## Text and instance selection

The current [segment command](../../packages/commands/src/handlers/segment.ts)
asks a structured vision model for signed guidance for every matching instance.
Each instance's positive and negative points drive its own local mask. A locating
box is not a decoder prompt for text selection.

Text describes what to select. Adding `--at` chooses which instances by testing
the actual projected masks, so overlapping locating boxes cannot decide the
answer. Every click must hit exactly one mask. Repeated clicks select each hit
instance once, retaining grounding order; no-match or ambiguity creates no
revision. Without clicks, text returns all matching instances. Clicks select
among automatic masks without changing their guidance.

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
