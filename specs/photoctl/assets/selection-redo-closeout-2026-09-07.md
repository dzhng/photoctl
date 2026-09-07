# Selection refinement and redo closeout

The corrected gate began on `254f2c6`; later changes are documentation only.
Production code, tests, assertions and timeouts remained unchanged during that run.
It follows the root verification stages in order, with explicit Vitest
`--maxWorkers=1 --minWorkers=1` on host, Docker and macOS. Docker's default command
is spelled out only to pass those flags to both unchanged test suites.

| Stage | Result |
| --- | --- |
| Formatting, lint, types and builds | Passed; existing non-fatal warnings remain |
| Host TypeScript | 203 files / 1,108 tests passed; 983.90 s |
| Rust workspace | 9 LibRaw and 78 image tests passed |
| Docker TypeScript | 201 files passed, two failed; 1,106 tests passed, two failed; 1347.67 s |
| Docker real models, subsequent separate stage | All three tests passed; 29.23 s |
| macOS including fresh installed packages | 16 tests passed, warm-show timing failed; 302.75 s |
| Corrected test files, focused host / Docker | All 20 tests passed in each environment |
| Unchanged warm-show check after host conditions changed | Passed; 6.01 s runner duration |

All local contracts have passing evidence after the corrections below, but this
is **not a clean single integrated run**. The complete attempt exited 1 at Docker;
remaining stages ran separately. Do not relabel the original failures or repeat
the full suite as a diagnostic loop. The original complete, interrupted and macOS
logs remain in `/private/tmp/photoctl-refinement-closeout.E9K4im`.

## Invocation correction

The first invocation exported worker environment variables this Vitest version
does not consume. Process inspection found many workers and several five-second
CLI timeouts. That attempt was interrupted (exit 130), not accepted. The unchanged
library-lifecycle and search-embedding files then passed all 18 tests with explicit
worker flags. The corrected complete host stage above also passes. No assertion,
timeout or product behavior was changed to accommodate the failed invocation.

## Corrected test contracts

Concurrent model fetches can arrive in either order after asynchronous cache
checks. The test now compares exact URL arrays without arrival order, preserving
multiplicity, hashes and cache assertions. Deliberately adding duplicate requests
still fails. Production download scheduling is unchanged.

The unavailable-library test recursively deleted a directory while the daemon
wrote its automatic backup, producing `ENOTEMPTY` before disappearance could be
tested. It now atomically renames the path away, retains the existing exit budget,
and requires the old path to remain absent. Disabling the real watcher in an
isolated container fails the exit assertion; the unmodified runtime passes.
Both affected complete files pass on host and Docker. Independent review found
no weakened safety assertion; formatting, lint and types pass.

The first narrow Docker invocation accidentally made Vitest PID 1 rather than
using the full gate's shell wrapper. A process probe confirmed orphan zombies;
those failures are not daemon regressions. The corrected invocation retains the
shell wrapper and passes. No container-init or product-liveness change was added.

## Warm-show timing

The macOS gate measured 312.30 ms p50 against the unchanged 250 ms requirement;
an unchanged focused recheck measured 328.10 ms. An unrelated renderer was using
multiple CPU cores. No authority was assumed to stop it, and no product tuning,
cache shortcut or threshold change was made.

A bounded interleaved comparison subsequently measured the current built CLI at
191.23 ms and the earlier installed CLI at 225.18 ms. Packaging and host conditions
are not controlled causal variables, so this does not isolate the cause of the
earlier slowdown. After the unrelated renderer exited, the original unchanged
test passed. Keep the timing failures as observed results, not as evidence of a
fixed product defect. No unbounded work or no-progress loop was established.

## Evidence boundaries

The [photographic correction witness](selection-refinement/README.md) proves a
bounded manual addition and revision restoration, not automatic fine-edge quality.
Independent reviews found no correctness defect in either pass or their shared
revision/frame consumers. The separate Codex CLI review was unavailable because
the installed CLI cannot use its configured model; it supplied no verdict.

[GitHub CI](https://github.com/dzhng/photoctl/actions/runs/34133673195) passed on
`254f2c6` using the small hosted gate. Neither that pass nor this local gate proves
public release publication, x64 platforms, the pairing browser checkpoint or the
remaining camera-JPEG access witness from the mounted gold catalog.

Docker downloaded both pinned models from a temporary local server, verified
their committed hashes, and retained them inside the test image. The server was
stopped after download. Local serving is not public distribution acceptance.
