# Implementation choices

All entries concern the CIRAW default implementation pass. The user selected
neutral CIRAW reconstruction, no extra preset, no automatic fallback and no
backward compatibility. Those are requirements, not agent-made decisions.

## Sound — medium confidence

**Preserve authored generated images when invalidating rendering caches.** A saved
AI edit represents an accepted result, potentially from a paid request. Changing
the RAW decoder recomputes deterministic source/development pixels, but does not
request a new AI image. The requirement to invalidate caches did not distinguish
computed previews from authored generated content. Preserving the latter avoids
changing an accepted edit or spending money implicitly. Future changes must keep
that distinction; a user can explicitly regenerate an edit. Sound because saved
creative content is not a disposable decoder cache.

**Keep explicit diagnostic decoder selection.** A user who explicitly invokes
`decode --with libraw` can still inspect that decoder. Automatic RAW processing
requires CIRAW. The scope rejected automatic fallback, without requesting removal
of diagnostic tools or their native dependency. Keeping them preserves useful
comparisons without adding an alternative automatic rendering policy. Sound
because the choice is explicit at the command boundary.

**Reuse the last successful capability probe while its files are unchanged.**
Repeatedly showing the same RAW otherwise starts Core Image even when its pixels
are already cached. The implementation retains one probe in memory and validates
both the original and the absolute helper executable using filesystem stamps.
Replacement, removal, or permission changes force ordinary probing; PATH-resolved
helper names are uncached. The plan did not specify warm-preview performance.
A larger cache or time-based expiry adds policy without helping the measured
single-photo path. This bounds memory and preserves helper availability errors;
future multi-photo optimization must justify its own scope. Sound because it
removes measured repeated work without changing pixels or the performance bar.

## Sound — high confidence

**Reuse the existing renderer identity to invalidate old computed pixels.** Opening
a photo after this change recalculates its deterministic render identity, so old
computed previews and graph outputs cannot stand in for the new source treatment.
No database migration or version-compatibility path was added. The requirement
specified invalidation but not its mechanism. The shared identity also invalidates
ordinary-image computed outputs once; that costs regeneration but avoids a second
RAW-only cache-version mechanism. Sound because the renderer already owns this
contract.

**Use a portable helper fixture plus real-Mac acceptance.** Portable command tests
receive a tiny executable that speaks CIRAW's external wire format and emits known
linear pixels or deliberate errors. This tests routing and error behavior without
pretending Linux provides Apple's decoder. A real-Mac public CLI test and retained
camera comparisons verify the actual helper and photographs. The requirement did
not prescribe test architecture. Future changes must preserve both layers; the
synthetic helper cannot certify photographic quality. The same model-selection
journey runs against a photographic PNG portably and the real RAW on macOS, so
platform separation retains RAW-to-model coverage. Sound because the platform
boundary stays explicit and the real decoder remains tested.

**Separate permanent references from experiments.** Original RAW/JPEG pairs,
metadata, and the two selected CIRAW renditions remain fixtures. Production-route
review evidence belongs with this record; rejected comparison outputs remain in
ignored scratch storage. The obsolete decision map is deleted. The cleanup request
left the retained evidence set unspecified. Sound because each retained artifact
has a durable role without putting implementation planning into camera fixtures.
