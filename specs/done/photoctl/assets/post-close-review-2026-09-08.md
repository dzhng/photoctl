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

Generation correction is integrated as `9ef99cc`; transport and docs are the
following focused pass. Next run the one
final integrated local gate. The prepared invocation and upcoming log are
`/private/tmp/photoctl-review-closeout.tJpUBj/{gate.sh,gate.log}`.
Do not treat the earlier full gate as covering these later corrections.
