# CI failure triage

## Current integrated result

[Run 34036649789](https://github.com/dzhng/photoctl/actions/runs/34036649789), on
`b8728d7` with both daemon fixes, passes all 18 daemon lifecycle cases and the
embedding drain (89.516 seconds). The full host gate still fails: 48 failing files,
152 passing files, 97 failing tests and 985 passing tests. Of the failures, 96 hit
test deadlines and one asserts on a startup deadline. Retained logs contain no
socket EPIPE crash. Missing-database logs are consistent with timed-out tests
removing catalogs while child work continues, not evidence of a new database defect.
These targeted passes do not make the whole gate green or establish host saturation.

The existing Test step now records processor count, initial memory totals and
five-second `vmstat` samples alongside failed-test daemon logs. The first vmstat row
is a since-boot average; subsequent rows describe intervals. Use timestamps to
compare runnable/blocked work, free memory, swapping, CPU busy/idle and I/O wait
with failures before changing scheduling or deadlines. This is aggregate host data,
not per-process attribution, proof of OOM or a production memory limit. No process
arguments, environment, catalogs or images are sampled; the failure artifact retains
the small log for the existing three days.

The actual workflow shell was checked in an existing Debian Linux container with
procps vmstat: dummy test exits 0 and 23 remained unchanged, both initial and interval
rows were recorded, and the sampler was absent after both exits. YAML parsing and
artifact path checks passed. The old workflow failed the missing-telemetry assertion.
This is shell/cleanup evidence, not Ubuntu CI pressure evidence; the next integrated
run must supply that. Scratch proof is `/private/tmp/photoctl-ci-host-load-proof.sOKG2v`.

## Earlier uninstrumented runs

Completed [run 34033139818](https://github.com/dzhng/photoctl/actions/runs/34033139818)
on `7ceed67` has 25 failing files and 53 failing tests, with 173 files and 1,018 tests passing.
Several daemon startups now expose child exit 1 with no signal; other requests report an
unresponsive daemon. This is not proof of OOM or a timeout-only defect. That run retained no
artifacts, so the child stack traces were lost. CI now uses the job's temporary directory for
host test processes and preserves daemon log files after test failure, for three days. No catalogs,
images or environment dumps are uploaded. Docker-container logs are outside this scope.
Read the retained host logs before changing startup behavior.
This run predates the embedding drain fix; its 1,496-row failure does not test that correction.

The subsequent [run 34033861168](https://github.com/dzhng/photoctl/actions/runs/34033861168)
on `56f5a5b` has 44 failing files/90 failing tests, 154 passing files/981 passing tests,
and one unhandled rejection. Its embedding drain times out waiting for background work to
settle; successful same-PID status replies continue until the 60-second deadline. It never
reaches the final row-count or latency assertions, so the fix is not CI-accepted. This is a
different failure from premature stopping at 1,496 rows. Diagnose actual progress and retry
state rather than increasing the deadline. That run also predates the disconnected-socket
and redundant-startup-probe fixes, and retained no child-log artifacts.

[Run 34034506032](https://github.com/dzhng/photoctl/actions/runs/34034506032) on `9980c1f`
has 27 failing files/54 failing tests and 171 passing files/1,021 passing tests.
Embedding fails earlier, during warm-up, with daemon exit 1/no signal; it supplies no
drain-completion or latency verdict. It also predates both daemon fixes and retains no
child-log artifacts. A backup timeout is not yet a separate reproduced defect: its setup
checks successful initialization, which can legitimately include an optional daemon-start
warning. Read current-run child logs before attributing that failure to backup scheduling.

The later Docker functional gate also has a confirmed configuration prerequisite:
[public model distribution](ort-acquisition/README.md#public-model-distribution) is not set up.
Fixing host tests will not supply the missing model-download URL. Keep that external
prerequisite separate from production defects and do not skip the model gate.

## First retained CI crash logs

[Run 34035723656](https://github.com/dzhng/photoctl/actions/runs/34035723656) on `920ad40`
fails 95 tests across 46 files, with 981 tests/153 files passing. Its retained
`daemon-startup-logs` artifact contains nine unhandled socket `EPIPE` crashes in
`DaemonServer.respond` → `DaemonServer.route` on Node 24.20.0. This directly connects
CI child exits to the locally reproduced disconnected-client defect below. The run
predates the socket-error and duplicate-status-probe fixes; it does not reject either.

The artifact also contains one unhandled rejection with only `#<ErrnoError>` as its
reason, a queue-test catalog-open failure, and the deliberately missing daemon module
from the optional-start regression. The queue library maps to a startup timeout whose
test cleanup deletes the directory without stopping the still-starting daemon; this
supports a cleanup race, but log timestamps do not prove ordering. The anonymous
rejection cannot be mapped to an exposed failing library and remains unattributed.
These logs do not establish OOM, a backup defect or a need for larger deadlines. Downloaded
logs are retained at `/private/tmp/photoctl-ci-daemon-logs.A7tFwH` after the CI artifact
expires. The integrated run remains the next acceptance evidence.

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

The remaining recovery envelope came from a second status probe after startup had already
received a valid acknowledgement. A deterministic real-socket regression sends one valid
snapshot and closes the redundant probe: old `daemon start` fails with the same “not responding”
message. Startup now returns its verified snapshot directly; seven focused lifecycle cases
pass, including recovery, disconnect survival and no replay. This removes the duplicate
observation, not a timeout or a claim that every CI timing failure is resolved.

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

A bounded current-source Linux ARM64/Node 24.20 witness on `b8728d7` passes unchanged
in 28.191 seconds under three CPUs/6 GiB with a reaping init. All 1,500 rows are persisted,
the same daemon reports settled background work, and the foreground latency bound passes.
The 1,508 provider responses progress continuously over 23.188 seconds, with a largest gap
of 111 ms; the child log is empty. The existing native binary is retained, so this is not
fresh-native or x64 CI acceptance. Scratch `drain.json` and `drain-logs.json` in the directory
above preserve the observation. This does not explain the older shared-run timeout and
does not justify changing scheduling, memory limits or deadlines. Await the integrated run;
capture progress at timeout only if the drain failure repeats.
