# Final correctness review — in progress

This is a scoped review ledger, not whole-spec acceptance.

## Choices consolidation dispositions

The catalog and deterministic-render proposals contain useful grouping suggestions,
but also claims that must not enter the final ledger unchanged:

- Import's per-unit conflicts retain paths and message text and produce `partial`;
  the separate batch-envelope owner preserves typed, order-independent all-failure
  codes. The proposed catalog entry incorrectly combined those two contracts.
- Reusing an occupied copy destination checks sampled identity, plus a full hash
  when stored. It is not an unconditional byte-for-byte equivalence check.
- Raster growth, standalone generation size, text-raster allocation and the fake
  upscaler's advertised capability happen to share some current numbers. They are
  different contracts: source-sized growth remains valid above the growth default,
  and provider limits are deliberately independent. Reject the proposed global
  constant refactor; the existing frame owner already centralizes canvas growth.

Root checked these against the import/copy and batch owners, frame-size guard,
generation parser, markup schema and fake adapter. These are corrections to audit
text, not newly identified product defects. The final ledger still needs the
cross-domain and build/verification coverage audits before replacement.

## Full-frame request controls

The later choices audit exposed a missed contract in the earlier slice-level review:
`reimagine` and `relight` rejected the global per-command upscale overrides. Root
confirmed this in both parsers and reproduced each missing flag through public
dispatch. Both commands now forward request intent into the existing shared density
policy, without a new provider, schema or consent mechanism. The enable/disable and
model-override regressions each failed before implementation and passed afterward.
Contradictory-flag tests were falsified by removing the guards, then passed with
the guards restored; they check no purchase or document change.

The same audit's claim that standalone `generate` must automatically upscale was
rejected: slice 13 explicitly gives it no base-density target. Its claim that
full-frame edits still refuse cropped/reduced inputs is also stale; the current
authored-frame implementation and relight regressions cover those cases. Proposed
ledger text is review input, not an authoritative replacement without root checking.

The focused full-frame, relight and existing fill-policy checks passed (27 tests),
followed by both contradictory-flag regressions. Typechecking passed. This is not
the final integrated local closeout or live-provider quality acceptance.

The remaining standalone parser gap was corrected in the same pass: `generate`
accepts an explicit upscale model and the no-upscale flag without changing its
native-raster default. The existing generation journey was parameterized to prove
that a requested model overrides a different saved model, retains both purchases
and reaches the requested size. It failed on the old parser before passing.
The no-upscale journey similarly failed on the old parser and passed alongside
the unchanged default; contradictory flags fail before library opening. All 12
generation tests pass. No new policy choices were introduced: request precedence
and configured-provider consent remain owned by the existing fill policy.

Independent Claude `opus` review found no behavior defect. Its two coverage findings
were accepted: the tests now use an available-but-unconfigured adapter, and exercise
model override together with `--no-upscale` on all three verbs. Removing the shared
consent condition and rebuilding its TypeScript output made all three consent cases
fail; restoring and rebuilding made them pass. An initial source-only falsification
did not reach the package's emitted consumer and is not counted as evidence.
Both changed test files pass in full (25 tests), with scoped lint/typechecking clean.
Root's shape/diff/docs review keeps policy in its existing owner; only CLI argument
forwarding changed. The independent review was static, not a second test execution.

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

The root's later executable-policy sweep found that the tag workflow still ran
Intel/Linux model checks despite the documented scope removal. Its model download,
native/model verification and packed-runtime verification now target only the
Apple Silicon matrix entry. Existing platform builds and artifact publication remain
unchanged. A parsed-YAML policy check failed on the old workflow and passed afterward;
this is configuration verification, not execution of a release or hosted native gate.

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

The independent choices audit covered the redo/navigation entries, both public-undo
entries, undo-auto, encoded-response retention, attempt journaling/classification and
list/detail inspection. Root verified the reported relationships in the public
history/develop handlers, revision commit/navigation, attempt inspection and artifact
reachability. No missing behavior was found in this domain. The stale “no redo” clause
is corrected; undo-auto's new-revision interaction and bounded inspection versus
retention are now explicit. These are partial-ledger corrections, not the final
whole-ledger consolidation.
The auditor's suggestion to keep encoded-response preservation under “needs-user”
was not adopted: the user's accepted retention/redo and original-response inspection
requests settle preservation. Future storage/deletion policy is a different decision.

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
