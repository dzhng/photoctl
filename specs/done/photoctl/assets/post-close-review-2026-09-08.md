# Post-close correctness review

The review of `a7c115f..5f4f82f` verified the retained full closeout log and
found two transport gaps. A separate source audit reproduced the archived
standalone-generation pixel mismatch. These corrections preserve the accepted
v1 scope; they do not reopen camera, fine-edge, platform or live-provider gates.

## Corrected contracts

- Keepalive timers belong to a connection and stop on its response or closure.
  Repeated request frames cannot orphan an older timer. This changes neither
  purchase cancellation nor individual handlers' progress-error policies.
- The silent-handler regression exceeds the actual client idle ceiling.
- A generated original resized after upscaling uses the same scene-linear
  Lanczos calculation as its stored recipe. Its first view cannot silently
  substitute differently resized pixels. The evaluator is unchanged, so no
  renderer semantic revision is needed.
- Releasing the final SAM runtime owner waits for native session destruction.
  The worker queue closes before joining its thread; failed initialization
  follows the same cleanup path. No CLI, schema or inference API changes.

## Evidence and review

The disconnect regression failed on the old code with three writes after
closure, then passed with cleanup. Disabling heartbeat emission made the
long-handler test fail with the expected daemon timeout; restoration passed.
Removing timer replacement also failed the repeated-frame disconnect case
with writes after closure; the replacement is restored.
The generation regression uses spatially varying provider pixels and failed
before the correction. It now compares the initial artifact with the first
evaluated view exactly, while retaining no-repeat-purchase checks.

Typechecking and the integrated four-file, 36-test sweep passed before the
additional repeated-frame case. Independent Claude `opus` review was read-only;
its test execution was denied, so execution evidence belongs to the root agent.
Root accepted its public-import simplification, frame-chunk resilience,
repeated-frame coverage and narrower documentation. Its predicted typecheck
failure was not reproduced. Root independently reviewed the generation change
and its agreement with the graph evaluator. The Codex CLI review could not run:
the installed CLI rejects the configured model as requiring a newer version.
After the review changes, typechecking and all three transport tests passed;
the repeated-frame test passed again after its falsification was restored.
Targeted lint, formatting and whitespace checks pass.

## Current handoff

Generation correction is integrated as `9ef99cc`; transport is `17caf24`.
The integrated gate built and passed static checks on that production source.
Host TypeScript finished with 1,119 passes and one failure in the existing
embedding-responsiveness benchmark (rate p95 about 800 ms versus a 496 ms
bound). That unchanged file passed its focused rerun. Heavy unrelated host CPU
work was observed afterward; contention is plausible, not a proven cause.
No threshold or product code was changed. This is not an uninterrupted green run.

Rust passed all 85 tests. Docker also finished with 1,119 passes and one
failure: the RAW treatment correctness test exceeded Vitest's default
five-second timeout. The embedding-responsiveness benchmark and all new
regressions passed there. The RAW test performs two full camera decodes, not
a speed assertion; its hang guard is now an explicit 60 seconds, matching
related source-treatment checks. All pixel assertions are unchanged. It passed
locally and in the same Docker image with only the updated test mounted
read-only (5.2 seconds for the previously timed-out case). Docker's three
real-model checks passed afterward.

Mac completed with all ten packed-install tests passing, plus decoder, linkage
and native-load checks. Two failures remained: SAM aborted during native teardown,
and warm-show p50 was 325 ms against the unchanged 250 ms target. The crash report
`node-2026-09-08-123415.ips` in the host DiagnosticReports directory placed
`ReleaseEnv` on the SAM worker while the main thread was in C++ process teardown.
An unchanged focused SAM rerun passed; this did not dismiss the lifetime defect.

The SAM owner now joins its worker after closing the queue. A Rust regression
observing session-owned resource release failed before this fix and passed
afterward. Six addon tests pass, including sixteen tiny-model subprocess exits;
those subprocesses also passed before the fix and are boundary coverage, not
the red witness. The rebuilt native addon passes the real-SAM test. The warm-show
benchmark also passes its focused rerun with no timing or preview-code changes;
host contention remains a plausible explanation, not a proven cause. All 86
Rust tests pass, and the rebuilt addon passes both native-load checks, including
packing and loading outside the checkout. Independent read-only review confirmed ownership, initialization
error cleanup, and absence of a self-join path. Typechecking and scoped lint pass
(lint retains an existing function-scoping warning).

Invocations and logs are `/private/tmp/photoctl-review-closeout.tJpUBj/`:
`gate.sh`, `gate.log`, `embed-drain-focused.log`, `remaining-gates.sh`,
`remaining-gates.log`, `final-gates.sh`, `final-gates.log`,
`mac-sam-focused.log`, `mac-sam-shutdown-fixed.log`,
`rust-sam-shutdown-fixed.log`, and `native-load-sam-shutdown-fixed.log`.
The final bounded requirement audit found no remaining implementation or
acceptance gate in the user-approved v1 scope. All identified failures have
focused passing evidence on their applicable corrected source. Historical
audit references to unresolved selection/pairing are explicitly superseded by
S94/S95. Public publication and live-provider quality remain unverified;
automatic fine edges remain the accepted limitation. There is no next
implementation pickup for this spec. Review corrections are committed locally,
not pushed or published.
Do not rerun the entire host suite as a feedback loop or treat the earlier
pre-correction gate as covering these changes.

Three independent read-only archive audits checked core/storage, rendering,
and historical/visual-provenance claims. Root verified and corrected omitted
qualifications: the accepted same-volume relocation inference, engine versus
schema compatibility, actual import admission, preview size ceiling,
conditional develop compensation, valid-image retention, visual-review
fallbacks, live mask refusal, and historical CI wording. These are documentation
corrections after the gate began; no production code changed during the run.
