# Final correctness review — in progress

This is a scoped review ledger, not whole-spec acceptance.

## Fill, generative extras and release requirement reconciliation

A read-only Claude `opus` audit traced slices 12, 13 and 14 into their linked owners
and evidence. It reported no missing implementation in that scope. Root checked the
remaining checkpoint clauses, the retained agent-preview evidence, the upscaler
non-blocking policy, mask-smoke implementation and the current mounted/packed evidence
boundaries before accepting the following dispositions:

- Flat fake fills prove state, placement and protected pixels, not photographic
  texture. The texture variable remains unverified in the conditional live repeat.
- The dedicated mask-smoke key and model were absent. The actual smoke command
  recorded `not_run:unconfigured`, with no verified polarity and no provider call.
- Upscaler quality remains explicitly conditional and unverified, not a missing
  deterministic implementation. Completed original command controls no longer carry
  a misleading “still open” heading.
- The last broad gate predates the final import/removal fixes. A current final local
  closeout remains required at the end; focused regressions do not replace it.
- Actual public publication remains unverified and needs user authority. No tag or
  publish action was taken for verification.

The audit did not prove every earlier slice or consolidate the choices ledger. Pairing
layout and automatic selection quality remain separate, unresolved acceptance items.

## Pairing and source ownership

Claude `opus` performed a read-only review of pairing, source selection, show/export,
render/cache identities, removal and their consumers on source `de92d0f` (subsequent
platform-policy edits do not change those implementations). It reported:

- Import lost the batch result after earlier units committed when a later unit
  threw a non-usage `PhotoctlError`. Root reproduced identity refusal at commit
  and source disappearance at preparation, each with a valid photo before and
  after the failing input. Both returned a terminal error without the already
  committed ID and starved the later photo. Each regression was red before its
  fix and green afterward. Expected per-unit errors now join the existing
  partial result, with successful IDs and conflict paths; unexpected faults
  still throw. All 28 import/reimport tests pass, as do typecheck and scoped lint
  (existing warnings).
- Disk removal trusts a locator without validating original identity. Root reproduced
  this through `dispatch`: replacing a source with different same-length bytes caused
  the replacement to be moved to Trash. The regression failed with `ENOENT` before
  the fix. Removal now shares the source-read identity check, leaving unverifiable
  files untouched while removing the requested catalog entry with a warning.
- An exported pre-pairing source selector and its helper have no consumers. Root
  confirmed this across packages, apps and tests and removed the unused path.

The removal change uses existing sampled identity and a full hash when one is stored;
it does not claim a new full-file identity guarantee or an atomic defense against
concurrent external file replacement. No camera access, schema change or new dependency.
The cull file's 13 tests pass, including ordinary Trash and rollback after catalog
failure. Its seeded source now carries its actual identity so rollback still exercises
a real move rather than silently passing through the new guard.
The paired-import and generated-photo-removal files also pass (21 tests), including
trashing both members of a pair and preserving shared generated originals. Typecheck,
lint (with repository warnings) and whitespace checks pass. Root's shape/diff/docs
review found no further defect in this change; the existing identity owner is reused,
and the unused selector is deleted rather than retained as an alternate path.

An independent Codex CLI review of the fix could not run: installed CLI 0.144.4
rejects the configured model as requiring a newer client. This is not a review pass.

Claude's focused import review proposed rethrowing `file_offline` and `volume_readonly`
as batch-wide failures. Root rejected that classification: `sourceReadError` uses
`file_offline` for individual-file permission/read errors, and `copyIntoLibrary` uses
`volume_readonly` for an individual occupied destination. Neither code proves a
batch-wide outage. The existing partial schema carries paths and human-readable
reasons, not typed per-item error codes; this change retains that contract. Root also
rejected the proposed mtime assertion as rollback proof: identity refusal occurs
before that write. The separate paired-copy failure regression already checks empty
photo/original/locator rows, cleanup of the first copied member and preservation of
the conflicting destination. The new tests prove batch continuation, not rollback
coverage by themselves. Cleanup failures remain ordinary thrown filesystem/database
errors and are not converted to source conflicts.

## Revision navigation and provider retention

Root inspected revision commit/navigation and provider-attempt retention/inspection.
No actionable finding in this bounded scope: new commits clear the redo path, failed
commits roll back, and navigation restores saved roots without provider invocation.
The focused redo/conflict/branch regression passed (one test, seven assertions).
All five provider-attempt tests passed under the configured Node/Vitest runner,
covering corrupt input, transport rejection, retained originals after conversion
failure, omitted capture and registration failure.

The initial direct Bun run of the provider-attempt file crashed loading `fs_ext.node`
before tests executed; the unchanged file passes with Node/Vitest. No product or
test assertions were modified to accommodate that runner failure.
