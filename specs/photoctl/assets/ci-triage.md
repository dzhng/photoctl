# CI failure triage

The newer completed [run 34033139818](https://github.com/dzhng/photoctl/actions/runs/34033139818)
on `7ceed67` has 25 failing files and 53 failing tests, with 173 files and 1,018 tests passing.
Several daemon startups now expose child exit 1 with no signal; other requests report an
unresponsive daemon. This is not proof of OOM or a timeout-only defect. That run retained no
artifacts, so the child stack traces were lost. CI now uses the job's temporary directory for
host test processes and preserves only its daemon log files after test failure, for three days. No catalogs,
images or environment dumps are uploaded. Docker-container logs are outside this scope.
Read the retained host logs before changing startup behavior.
This run predates the embedding drain fix; its 1,496-row failure does not test that correction.

## Reproduced disconnected-client crash

A bounded Linux ARM64/Node 24.20 comparison reproduced startup child exit 1 with an
actual stack trace: unhandled socket `EPIPE` in `DaemonServer.respond` while routing a
control response. A caller had disconnected before the reply. The isolated startup subset
passed, while the concurrent comparison exposed the crash; this is not evidence of OOM.
Scratch logs and runner results are retained at `/private/tmp/photoctl-startup-repro.nq8bTw`.

The regression pauses a real daemon, sends and closes a control client, then resumes it
and requires the same daemon PID to answer status and an ordinary command. It fails
against the old server. Handling errors on each accepted socket closes only that socket;
the deterministic regression passes on Mac and Linux, alongside the existing no-replay check.
The subsequent concurrent Linux comparison no longer records an EPIPE crash, but one
impostor-recovery case still reports an unresponsive daemon. That run overlapped the new
regression, so it is not a controlled performance comparison or a full CI pass. No timeout,
queue policy, process-wide exception handler or command retry is added.

## Earlier CI evidence

The completed [Linux run 34023344394](https://github.com/dzhng/photoctl/actions/runs/34023344394)
tested `dbe550a77eed97775bb41ee403a69819d3684031`: native build and lint passed;
TypeScript tests failed (103 failed, 961 passed; 51 failing files). The later root gates
did not run. The entire failed-test section was inspected, not only its final summary.

## Independent causes

- Fixture manifest refusal contradicted a stale test. The immutable-byte policy remains intact;
  focused tests now exercise refusal without losing annotations and explicit regeneration.
- Provider CLI tests omitted portable volume mapping; all four pass on Linux with the mapping.
  Native policy and memory-rejection tests also contained stale assertions. Markup tests passed
  the deleted frame shape; current-frame tests now catch ignored crop positioning.
- The gold-script fixture assumed checkout-local executable links created during installation.
  Its disposable command directory now invokes the actual built entry points. This tests the
  existing exam, not package installation; the packed-install gate remains separate.
- Offline export's lost volume/mount hints are restored from the selected original; a distinct-drive
  companion regression proves explicit camera-JPEG failures do not point at the RAW's drive.
  Unsupported-file import now supplies portable fixture volume mapping; production's authoritative
  offline check still precedes inspection. Targeted Linux cases pass, as do the complete local
  first-JPEG, pairing and original-protection files (46 tests).
- Daemon starts return exit 69 in several CLI tests; one subsequent unchecked PID causes a
  secondary type error. Isolated Linux reimport succeeds, so the CI startup cause is unresolved.
- Many tests exceed runner deadlines, including 5, 15, 30 and 60 seconds. Directory-removal
  errors follow some timeouts. These are not evidence that larger deadlines are correct;
  investigate resource contention and unfinished test work. The upscale spy failure follows
  a timed-out test in the same file; both tests pass unchanged in an isolated local run,
  which does not establish the CI cause.

Focused green results prove their stated scope only. A subsequent full integrated run is
required; camera delivery quality, native RSS and encoder latency gates are not replaced by
test-runner timing. Do not discard historical failures or cancel unrelated CI jobs as a fix.

## Timing boundaries

The two export-integrity cases that materialize a full 7008×4672 RAW fail the implicit five-second
runner limit even alone. An unchanged diagnostic run with an observation budget completes in
6.195 and 6.601 seconds. Those cases now use the existing neighboring RAW-journey 30-second hang
guard, retaining every assertion. All eight export-integrity tests pass together afterward.
This does not change any native speed requirement or the default timeout for other tests.

A current-source Linux experiment under a fixed three-CPU/6-GiB container quota compares three
small database/CLI cases with one and three workers. Both pass the unchanged five-second limit;
individual durations rise from 1.05–1.99 seconds to 2.09–3.69 seconds while total wall time falls
from 5.22 to 4.04 seconds. This demonstrates a latency/throughput tradeoff, not CI saturation.
The existing container native artifact is older and no RAW rendering is exercised, so this is
not native-runtime acceptance. A daemon replay starts successfully; its stop encounters a zombie
because the container lacks a reaping init. That is not reproduction of CI's startup failure.

CI's debug-profile image and LibRaw crates already have optimization level three. Neither the
build label nor the total test count proves the cause of the camera timeouts. Actual CI resource
telemetry and actionable startup failure details remain missing. The audit's complete scratch
record is `/private/tmp/photoctl-highlight-measure/ci-performance-audit.md`; no runner or native
configuration was changed on the strength of this bounded experiment.

Startup failures now report observed child exit/signal and the existing private log path
without serializing log contents. Signal termination is detected promptly. Focused public
tests cover both terminal modes, lock reacquisition and later successful startup, alongside
lost-response no-replay and optional-init behavior. This enables diagnosis, not a claim that
the earlier CI startup failure's cause has been reproduced or fixed.

The contention tests now retain the complete startup result in assertion failures.
An injected child exit 23 verifies that the failure exposes `daemon_unavailable`,
exit/signal and log path instead of only exit 69. Both unchanged concurrency cases
pass locally and in the existing Linux ARM64/Node 24.20 runtime. The latter is not
CI's x64 environment and retains its existing native binary; no queue policy,
timeout or workflow change follows from these focused results.

## Embedding drain completion

Run 34027448298 stopped the drain at 1,496 persisted rows; the unchanged test reproduced locally
at 1,493 instead of 1,500. Its HTTP response counter included canceled requests and could advance
before database writes. Waiting for the daemon's existing background worker state to settle fixes
the observation boundary without changing embedding scheduling. The test checks busy then settled
state on the same PID and still requires exactly 1,500 persisted rows and the unchanged foreground
latency bound. The new status assertion failed against the old runtime before implementation;
the corrected built-runtime drain passes. This does not settle the other CI failures.
