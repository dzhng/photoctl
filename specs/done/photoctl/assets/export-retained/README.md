# Retained output is not a source redecode

Export's current output node identifies the complete immutable recipe, including paid roots; it does
not identify the renderer's pixel semantics or a particular source-quality execution by itself.
The execution owner therefore stores the existing `renderHashForNode` identity and inherits the
base-input source tier beside its realized frame. Pre-render external captures need neither field;
ordinary pinned paid-artifact reuse remains independent of this offline-export fast path.

The retained reader verifies one candidate at a time from density/provenance-ranked metadata pages.
It never selects an arbitrary latest frame, reconstructs reduced geometry from native dimensions,
or stops merely because the highest-ranked artifact is corrupt. Export keeps live-source promotion
and lower-quality fallback outside that reader, in its existing source-selection path.
The caller supplies a fallback's dimensions and tier as minimum supply; the reader applies its same
ordering to that threshold. A retained pinned render therefore cannot suppress a newly available
equal-density embedded JPEG. The fresh execution-frame schema owns this metadata without an upgrade
or backfill path, as required by the clean-start development cutover.

Export currently uses automatic decoder selection. Equal-density executions within the same source
tier use a stable identity tie-break; this is not a claim that different decoders produce identical
pixels. A warm JPEG preview can retain another such execution. Explicit decoder selection would need
to constrain this eligibility policy before adding that user-facing control.

The regression in `packages/commands/src/export-retained.test.ts` starts with a normal cropped,
quarter-turned edit, not a border-specific fixture. An intact current render must export pixel-exactly
offline. Missing/corrupt canonical artifacts must fall back, reconnect must recover original pixels,
and disconnecting again must prefer those pixels over an equal-sized lossy pinned execution.
An artifact from an obsolete renderer identity is ineligible even when its bytes are valid.

On 2026-09-06, the ordinary-photo and built-outpaint tests both failed before the retained path:
the same render hash was delivered with different interior pixels after an offline pinned redecode.
Separate falsifications then removed semantic eligibility and inverted provenance preference; each
failed its intended pixel assertion. Both changes were restored. These are deterministic keyless
pixel checks, not photographic quality or resource-limit acceptance.

Independent review found semantic invalidation and provenance preference gaps; both were addressed.
The final focused follow-up found no actionable correctness issues. Its request for a new migration was deliberately rejected because the
user requires a clean-start schema, not compatibility with existing development catalogs.

Merged verification passes 57 retained-export, paired-import, preview/export, evaluator and fresh-schema
checks after the TypeScript build, with typecheck also green. Explicit camera-JPEG access retains its
separate source-rendition path and does not enter the document's retained-output reader. The packaged
outpaint lifecycle and whole-spec gates remain separate acceptance requirements.
