# Final correctness review — in progress

This is a scoped review ledger, not whole-spec acceptance.

## Pairing and source ownership

Claude `opus` performed a read-only review of pairing, source selection, show/export,
render/cache identities, removal and their consumers on source `de92d0f` (subsequent
platform-policy edits do not change those implementations). It reported:

- Import may lose the batch result after earlier units committed when a later unit
  throws a non-usage `PhotoctlError`. **Pending root reproduction and correction.**
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
