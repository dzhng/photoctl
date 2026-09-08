# Persistent-daemon resource canary

The first expanded JPEG export completed, then the persistent daemon crossed the
5 GB decimal investigation canary. The observer stopped that daemon immediately.
This is a failed acceptance attempt, not evidence of a leak, indefinite growth,
or a universal memory limit. No threshold was raised to continue the experiment.

## Workload and outcome

The [measurement report](daemon-report.json) records one fresh library and daemon
PID 63901 on macOS, Node 24.14.0, at checkout `31d84a6`. The intended workload was
three exposure-edit/export cycles for each permanent DSC08142 JPEG and RAW,
removing each 128-pixel border before the next cycle. Only the first JPEG cycle
reached expanded export; removal, later cycles and the RAW case were not run.

The source remained uncropped at 7008×4672. Exposure 0.125, baseline PNG export,
fake outpaint and expanded PNG export all succeeded through the real public CLI.
The expanded image is 7264×4928. After the daemon exited, an observer compared
every protected PNG RGB pixel at offset (128,128) with the baseline: exact.
A deliberately one-pixel-shifted extraction failed equality. This checks delivered
PNG pixels, not canonical float equality or photographic generation quality.
No removal output exists and no restoration equality is claimed.

Exactly one fixture HTTP image-edit request occurred, using the explicit
`photoctl/fake-image-edit-v1` model and `--no-upscale`. The JPEG's before/after
SHA-256 is unchanged. No camera, live provider, source mutation or native build
was involved. The partial library and deliveries remain available for diagnosis.

## Process scope and timeline

| Completed command | Elapsed | Sampled daemon peak | Post-command idle RSS |
| --- | ---: | ---: | ---: |
| Baseline export | 6.013 s | 3,027,156,992 B | 3,027,550,208 B |
| Fake outpaint | 4.686 s | 3,024,830,464 B | 2,961,522,688–2,961,735,680 B |
| Expanded export | 15.337 s | 4,998,119,424 B | 5,005,983,744 B; stopped |

The crossing was the first idle sample at **2026-09-06T10:46:14.967Z**, 339 ms
after the last active-command sample. Idle sampling waits 200 ms after the active
observer drains. The runner did not record an absolute command-return timestamp,
so an exact return-to-crossing duration cannot be reconstructed. It happened
after successful CLI completion, not during a subsequent edit or pixel comparison.

Active sampling uses `ps` RSS in KiB converted to bytes, with a 100 ms sleep after
each observation. Actual sample gaps include observer overhead; the largest
recorded gap was 217 ms. Completed earlier commands have ten idle samples over
approximately two seconds, with no forced GC. Samples are observations, not an
OS high-water guarantee: shorter peaks may be missed. SIGTERM was sent at the
crossing and the PID was subsequently confirmed absent.

RSS above is the daemon alone. Sampled descendant lists were empty; that does
not exclude helpers shorter than the sampling interval. `/usr/bin/time -l`
separately records each CLI invocation, about 110 MB for render-dispatch commands;
initialization was an in-process operation with a 1.735 GB high-water mark.
These values are not added into a process-tree peak. The observer/fake gateway
and its image-comparison buffers are outside the daemon measurement.

Ordinary desktop work remained active: a spot check observed media analysis near
100% CPU, filesystem events near 83%, and browser activity. Root was conducting
CI diagnostics concurrently. There is no quiet-host latency comparison or latency
pass threshold. The earlier no-daemon observations cannot establish retention in
this long-lived process, and different runtime/source-treatment states prevent
attributing their numerical difference solely to daemon lifetime.

## Reproduction and next boundary

The isolated runtime is `/private/tmp/photoctl-outpaint-daemon-resources`; its
dependencies resolve within that worktree. Existing root-built TypeScript output,
native addon and helper were copied there without rebuilding or changing root.
The report pins addon, helper and scratch-runner SHA-256 identities.
The runner is `/private/tmp/photoctl-outpaint-resource-measurement/daemon.mjs`;
its retained output is `/private/tmp/photoctl-outpaint-daemon-measurement`.
The report pins the complete scratch report hash; committed JSON summarizes
active samples while retaining every recorded idle sample and command result.

The runner accepts a new output-directory argument and explicitly selects a
fixture volume, localhost fake gateway, disposable library/cache and persistent
daemon. Do not repeat it merely to finish the requested cycle count: first
diagnose retained versus reclaimable memory at this bounded first-cycle state.
One original float RGB canvas alone is 392,896,512 bytes; several simultaneous
full-resolution buffers can be substantial without proving a leak. No buffer
owner or lifetime has yet been attributed by this observation.

A [single instrumented replay](daemon-diagnostic.md) observes natural reclamation and
byte-identical output, without closing this failed acceptance or attributing its cause.

The next acceptance attempt must retain the same canary, same PID requirement,
fixed canvas, exact interior/removal checks and both source cases. Stopping here
does not waive those unrun requirements or authorize forced collection, allocator
tuning or production changes. Evidence review found no new permanent runner,
schema or product owner necessary; only these failure records are committed.
