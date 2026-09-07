# Current local closeout — in progress

The tested production source is `ea76aed`. Documentation-only updates during this
run do not change its code, tests, assertions or timeouts. This is the remaining
integrated local gate, not a GitHub run or Intel/Linux support-verification effort.

Formatting, lint and typechecking passed. The initial root invocation stopped at
the native build because this shell lacked CMake on its path; no tests ran in that
attempt. The already-approved isolated CMake/Ninja environment remains intact.
The continuation uses it and resumes at the build stage, which passed.

The host TypeScript suite is running. Rust, the existing Docker functional/model
seam and macOS/packed checks follow in the same fail-fast script. None is claimed
as passed until its terminal result is collected. The existing single-worker
Vitest flags are explicit, preserving coverage without saturating the host.

Logs and the exact continuation invocation are in
`/private/tmp/photoctl-final-closeout.j54Do5/`. `verify.log` retains the prerequisite
failure; `continued.log` records the resumed stages; `continue.sh` is the executable
stage sequence. Do not restart the complete suite because an observation times out.

Docker model acquisition uses a temporary loopback-only HTTP server on port 18764,
serving the existing model-only directory. Both model hashes match the committed
manifest, and Docker connectivity was checked. Stop this task-owned server after
the Docker image has fetched its models. Local fixture serving is not public model
distribution or provider consent.

Pairing layout, automatic fine-edge selection quality, final choices reconciliation
and actual public publication keep their separate evidence boundaries. This file
does not close those requirements.
