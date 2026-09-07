# RAW + camera-JPEG originals

## User contract

Importing matching RAW and JPEG files defaults to one logical photo retaining both
originals. Ratings, tags and the edit document belong to that photo. Editing and
normal export use the RAW; camera-JPEG viewing/export is explicit and does not apply
the RAW edit document. `raw`, `jpeg` and `both` remain explicit companion-import
alternatives, with `both` creating independent photos on a fresh import.

This supersedes the selection-only proposal and its no-paired-catalog restriction.
The user explicitly chose a clean-start development cutover: change the schema
directly and rebuild disposable test catalogs. Do not build a migration, backfill,
old-format adapter or compatibility layer. Do not automatically delete libraries
outside the disposable fixtures created by the test/build workflow.

## Completed scope map

| Quadrant | Settled ground / consequence |
|---|---|
| Known knowns | Paired default, one logical photo, preserved originals, RAW-led editing and explicit camera-JPEG access are user decisions. Real companions live together in `fixtures/camera/`. |
| Known unknowns | Primary-source policy and catalog compatibility were answered by the user: RAW-led, clean-start. Internal representation is delegated subject to the single-owner constraints below. |
| Previously implicit context | This is a CLI-first product still in development, with no external users. Do not turn the feature into a production migration project or add interactive stdin prompts to daemon commands. |
| Landmines | Existing `photos` owns one byte identity and `files` means equivalent locations. Pairing different bytes in that table without moving identity ownership would corrupt deduplication, source validation and relocation. JPEG dimensions/processing can differ from RAW, so it is not a transparent source fallback. |

The structural evidence is in `packages/library/src/identity.ts`,
`packages/library/src/migrations/0002-photo-core.ts`, `packages/commands/src/handlers/import.ts`,
`packages/commands/src/image-source.ts` and `packages/commands/src/handlers/cull.ts`.
Adobe's [documented Classic behavior](https://helpx.adobe.com/lightroom-classic/desktop/import-photos/file-import-formats-settings.html)
distinguishes separate JPEG entries from a RAW-led sidecar presentation. This is a
behavioral reference, not a requirement to copy Lightroom's catalog or hidden state.

Independent fewest-slices, risk-first and seam-quality reviews agree that original
identity, locator cleanup and source-specific cache ownership must change together.
Keep the four checkpoints below, with ambiguity and corrupt-survivor checks in the
first checkpoint rather than postponed cleanup. The reviews' byte-copy-only JPEG
export alternative is not adopted: selecting a source does not remove existing
export format, size and metadata controls. Their alternate flag spellings and
implicit JPEG selection by filename likewise do not replace the explicit contract.
One review inspected an older fixture checkout and incorrectly reported missing
JPEGs; the committed camera references, not that draft, establish availability.

## Single owners

- `photos` owns logical photo identity, culling and the edit document.
- `originals` owns each distinct original's content identity, detected kind and
  capture metadata, including dimensions/orientation. A photo explicitly identifies
  its primary original. Do not duplicate authoritative byte facts on `photos`.
- `files` owns physical locations of one original. Two RAW copies are locations of
  the same original; the camera JPEG is a different original of the same photo.
- A photo has at most one original of each detected kind. Another location of the
  same JPEG is allowed; a different JPEG cannot silently become a third member of
  an established pair. Import also refuses to reassign an occupied location whose
  bytes now identify a different original.
- Move the existing sampled-content-key/full-hash-promotion owner to originals.
  Pairing is not evidence of byte equality. Preserve collision verification and
  offline refusal when equality cannot be established; do not introduce an
  unconditional whole-RAW hash read during initial import.
- The existing render-source resolver owns validation and selection. Normal graph
  evaluation uses the primary original and its source identity. Explicit camera-JPEG
  access must have its own correct provenance and cache identity, not the RAW
  document's render hash attached to unrelated pixels.

## Passes and gates

### A — Original identity and default paired import

Change fresh schema and identity/location readers together. One public import of a
real same-stem pair must produce one photo, two originals with independent identities,
and two valid locators. Reimport retains that photo and those originals without
duplicating or reparenting them. Existing standalone-image and RAW paths continue
working through the same owner, not a legacy adapter.

Match companions only within a scanned directory, with case-insensitive filename stems and actual
RAW/JPEG content. File extensions may identify candidates but cannot establish
decodability or suppress otherwise valid unknown-extension files. Contradictory
capture metadata or multiple possible counterparts must not trigger an arbitrary
pair. Ambiguous or contradictory groups are reported as conflicts without starving
unrelated valid groups; `both` imports independently and needs no pairing decision.
Explicit `raw` or `jpeg` requires an unambiguous selected original, not an
unambiguous excluded counterpart.
Conflicts use the existing partial-failure result, not warning-only success, so a
caller cannot mistake unadmitted photos for a completed import. Expected per-unit
read, identity and copy errors join that result; successful photo IDs remain visible
and unrelated units continue. Unexpected faults still abort instead of being hidden
as source conflicts. Content inspection
reports progress before catalog admission; total elapsed time includes both phases.
A corrupt counterpart must not hide a valid survivor. An explicit single-file
import remains scoped to that file; directory import discovers companions.

Expose original membership and the primary choice through public inspection. The
first useful checkpoint is `import` then `list`/`show`: one entry, with both originals
identified, while default rendering continues to use RAW pixels.

### B — Import policies and original-file lifecycle

Add `import --companions paired|raw|jpeg|both`, default `paired`. The policy applies
to detected companions, not unrelated standalone images. Report logical-photo counts
separately from original-file membership so RAW/JPEG pairs do not inflate photo counts.

Copy both selected originals byte-for-byte, with pair-atomic catalog publication and
cleanup of failed copies. Relocation removes stale locators only for the corresponding
original. Logical removal covers both originals using the established recoverable
trash/rollback owner. A locator is not ownership proof: before moving each source,
verify its stored content identity using the same check as source reads. If it cannot
be verified, leave that file untouched and report catalog-only removal with a warning.
Never silently merge edited photos, split an established pair,
or transfer an original already owned by a different photo during reimport.

Tests cover paired/default and each explicit policy, RAW-only/JPEG-only inputs,
matching names in different directories, false extensions, corrupt counterparts,
ambiguous stems, repeat import, relocation, copy failure and removal rollback. Late
companion attachment may extend one existing RAW-led photo, but must not silently
replace an edited JPEG primary or merge two established photo histories.

XMP target ownership is also logical-photo scoped. RAW and JPEG files sharing a stem
can address the same sidecar. If independent photos created by `both` would address
that same volume-relative sidecar, write/sync reports ambiguity for the affected
items before changing either metadata or sidecar bytes. Same-photo companions are
not competing owners. Reuse the existing sidecar path owner; do not invent alternate
filenames or silently choose one photo's ratings. Compare targets case-insensitively
within a volume: this deliberately favors refusing a possible alias over overwriting
metadata, even if a case-sensitive volume could distinguish the two names.

### C — Explicit JPEG access and all presentation consumers

`show` and `export` accept `--source camera-jpeg` for the camera-produced rendition.
Normal commands remain RAW-led. Explicit JPEG access uses that original's own
orientation, dimensions, metadata and pixel source; it never replays RAW edits or
changes the active document. Existing export format/resize/metadata controls retain
their documented meaning. If that JPEG is unavailable, report it—do not substitute
RAW pixels and call them the camera JPEG.
This checkpoint requires the selected JPEG original online even when a prior derived
view remains cached. Normal RAW pinned-preview fallback is not camera-JPEG offline
support. Source-rendition cache identity shares the renderer's semantic revision,
so a pixel-processing correction invalidates both document and JPEG-derived views.

List/show and the CLI-driven workbench must agree on one photo and its RAW+JPEG
membership. Public tests bind RAW/default and explicit JPEG results to different
originals. The displayed filename and top-level online state describe the primary;
membership separately reports each original's availability. Public tests preserve
document state, check offline behavior and ensure source-specific
cache entries cannot collide. Visual checkpoints use the real companion fixtures:
compare full images and orientation crops with `compare-screenshots`, then run an
unprimed `screenshot-critique` before declaring presentation verified.

Sweep list/search and folder filters, culling, embeddings, source-consuming edit and
generation commands, XMP, removal/cache cleanup, backup/restore and workbench readers.
Both companion paths resolve to the same logical photo; selecting the camera JPEG
remains explicit. Generated-photo and standalone-image behavior must stay green.

### D — Real camera and integrated closeout

Run the existing gold exam on the mounted camera through paired-default import.
It must rate ten logical photos, develop three RAW-led photos and export ten results;
the JPEG companion must not count as a second photograph. Add an explicit camera-JPEG
view/export witness from the same catalog. Record source volume, command results and
byte hashes; retain both originals unchanged. The existing packed CLI and broader
spec gates still apply after consumer integration.

## Delegated implementation choices

Internal names, index shape and focused test structure are delegated. Fresh schema
layout may be simplified rather than extending historical migration scaffolding.
No choice permits duplicate identity owners, a second renderer, implicit source
switching, deleting real originals, or weakening existing non-compatibility contracts.
Record any newly discovered product decision here and in the choices ledger before
building past it.

Implementation evidence and remaining verification limits live in
[the paired-import review](../assets/paired-import-review.md).
