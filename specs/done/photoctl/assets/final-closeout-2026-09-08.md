# Current local closeout — continuation passed

The full host suite tested production source `ea76aed`. The later stages use that
source plus the shared-cache correction described below. Documentation-only updates
do not change code, tests, assertions or timeouts. This is the remaining
integrated local gate, not a GitHub run or Intel/Linux support-verification effort.

Formatting, lint and typechecking passed. The initial root invocation stopped at
the native build because this shell lacked CMake on its path; no tests ran in that
attempt. The already-approved isolated CMake/Ninja environment remains intact.
The continuation uses it and resumes at the build stage, which passed.

The host TypeScript suite terminated with 205 files passed and one failed:
1,127 tests passed and one failed in 983.59 seconds. The failing CLI test expected
an unusable shared cache destination to return `volume_readonly` (exit 69), but
per-photo error collection converted it to `partial` (exit 65).

The correction prepares the shared cache directory before photo admission while
leaving individual failures isolated. An unsupported-only scan does not require
cache setup. The focused import/cache suite passes all 40 tests across four files.
Making setup unconditional falsified the unsupported-only assertion (exit 69
instead of 0); restoring the condition and rebuilding passed the focused test again.
These are narrow correction checks, not a clean rerun of the full host suite.
Logs are `cache-focused.log`, `cache-falsification.log` and `cache-restored.log` below.

The remaining-stage continuation passed Rust (9 + 78 tests), all Docker functional
tests (206 files, 1,128 tests in 1,253.65 seconds) and real-model checks (two files,
three tests in 23.05 seconds). The Swift build and all macOS checks passed: seven
files, 18 tests in 235.65 seconds, including all ten fresh packed-install cases,
decoder-oracle checks, real SAM, native loading/linkage and daemon performance.
The continuation terminated with exit 0. This is not one clean root invocation:
the initial host failure and its focused correction remain recorded above.
Single-worker Vitest flags remain explicit. `remaining.sh` and `remaining.log`
retain this continuation separately from the failed host run.

A later [dead source-hint cleanup](final-correctness-review.md#sourcedelivery-boundary-cleanup)
passed the TypeScript build and 33 focused tests. It changed no behavior assertions
or delivery policy and does not turn the earlier failed host run into a clean one.
The subsequent [D34 confirmation correction](final-correctness-review.md#disk-removal-confirmation)
also owns separate focused verification; it is not included in the completed
full-stage continuation's source scope.

Logs and the exact continuation invocation are in
`/private/tmp/photoctl-final-closeout.j54Do5/`. `verify.log` retains the prerequisite
failure; `continued.log` records the resumed stages; `continue.sh` is the executable
stage sequence. Do not restart the complete suite because an observation times out.

Docker model acquisition uses a temporary loopback-only HTTP server on port 18764,
serving the existing model-only directory. Both model hashes match the committed
manifest, and Docker fetched both verified files into its image. The task-owned
server was then stopped; the model files remain intact. Local fixture serving is
not public model distribution or provider consent.

Pairing layout, automatic fine-edge selection quality, final choices reconciliation
and actual public publication keep their separate evidence boundaries. This file
does not close those requirements.
