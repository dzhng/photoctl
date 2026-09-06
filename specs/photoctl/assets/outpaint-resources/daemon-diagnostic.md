# First-cycle memory diagnostic

The [failed daemon acceptance attempt](daemon.md) remains a failure. A single instrumented
replay investigates what happens after its expanded JPEG export; it does not retry the
six-cycle acceptance gate or change the 5 GB decimal canary.

## Observation

The same isolated runtime and original JPEG execute initialization, import, exposure 0.125,
baseline PNG export, one fixture-only 128-pixel outpaint and expanded PNG export in PID 84469.
A scratch daemon entry samples `process.memoryUsage()` and observes natural GC events.
There is no forced collection, heap limit, allocator setting or production change. Sampling
and synchronous trace writes can change scheduling, so this is not a controlled comparison
of allocator behavior against the uninstrumented run. Node-internal memory values and the
earlier external `ps` samples are different observation mechanisms.

| Phase | Sampled peak RSS | Last idle RSS | Last idle external | Last idle ArrayBuffers |
| --- | ---: | ---: | ---: | ---: |
| Baseline export | 3,035,054,080 B | 2,720,907,264 B | 543,128,266 B | 303,599,391 B |
| Fake outpaint | 2,926,428,160 B | 2,926,428,160 B | 1,310,588,085 B | 501,406,510 B |
| Expanded export | 4,985,651,200 B | 3,747,053,568 B | 573,268,958 B | 331,163,661 B |

Idle observations cover approximately two seconds after command return. The final JS heap
used is 30,697,864 bytes. External and ArrayBuffer counts overlap and must not be summed;
neither is an accounting of every native allocator or resident page. The expanded phase
observes natural GC and falling RSS. That supports reclaimability in this run, not attribution
of the earlier crossing to GC timing, proof of no leak, or a safe repeated-use bound.

Baseline and expanded PNG hashes exactly match the failed attempt's files:

- baseline: `486a833c24fb6dde5e0534a401ff70337a7da9aac6758584ff7d545e48a9dbe3`
- expanded: `18f70fa090ff1a1c95b3e626b7d53e3040928aa26fad36cb3424e6f21502296a`

Exactly one fake image-edit request occurs, source hash is unchanged, and normal daemon stop
succeeds with its PID confirmed absent. No RAW case, removal or later edit cycle is run.
The entry has a 5 GB self-stop guard. No sample exceeds it, but event-loop sampling can miss
native peaks; this diagnostic therefore cannot replace external sampling in acceptance.

## Evidence and next action

Scratch commands, original NDJSON trace, entry and reports remain in
`/private/tmp/photoctl-daemon-memory-diagnostic.Fd9F3H`. Trace SHA-256 is
`ed39f36fddee2c2bae07276f3505333c5dacc6758cec0c77fab849187bf743eb`;
entry SHA-256 is `9db3e076d55a2a7aae1b0ca047541ac712a725eaa37874ad09c7191143b1d8f6`.
The entry loads the unchanged isolated daemon, addon and helper identified by the failed
attempt. This is a scratch diagnostic, not a new product instrumentation owner.

Do not fix this by forcing GC or increasing the canary. Trace large live allocations and
native task lifetimes during expansion, including source/transform/compositor/publication
buffers. The graph's per-evaluation memo stores artifact results, not a permanent RGB cache;
its existence alone is not a demonstrated leak. A buffer owner must be measured before its
lifetime is changed. Retain the original failed witness and exact pixel guards throughout.

## Reduced-canvas ownership probe

A subsequent scratch probe derives a 1200×800 JPEG from DSC08142.JPG, applies the same
exposure and a 32-pixel fake border, and compares fresh normal/instrumented daemon runs.
The instrumented runtime wraps render phase boundaries and tracks backing stores through
weak references, not retained image copies. Both baseline PNGs share SHA-256
`ae9667a05f7e58575795bbf6427fec46048750b1dfad0412b138403539ef1e47`; both expanded PNGs share
`93829ecffdbac196e06f98cf06249042790b59a61059455f115f7605bc89937d`. Exact interior equality
passes and shifted extraction fails. Both daemons stop normally and their PIDs are absent.
This resized diagnostic input does not replace a permanent fixture or photographic review.

The instrumented expanded export observes 1.310 GB RSS after compositing and 1.367 GB
after delivery conversion. Weakly observable backing stores fall from 122.9 MB to 7.66 MB
by encoded delivery while RSS remains elevated: most tracked intermediates are naturally
reclaimed. Untracked allocations, database/runtime pages and allocator retention remain
unresolved. These are boundary samples, not per-operation high-water attribution.

The observer is materially intrusive: the normal arm peaks at 1.073 GB, the instrumented
arm at 1.367 GB. Weak-reference inspection, async wrappers, synchronous logging and fixed
run order prevent treating the difference as an implementation regression or improvement.
No forced GC, native rebuild, full-resolution repeat or threshold change occurs.

The trace confirms five artifact validations during expanded export. Native validation
owns a complete TIFF snapshot without `TaskMemory` accounting; at the reduced size this
copy is 13,105,962 bytes. This is an exercised accounting gap, not proof of the original
5 GB failure's cause. Node's ordinary `external` statistic does not expose the manual
adjustment counter; the existing native task-accounting tests own that distinction.
The bounded validation probe below isolates snapshot lifetime and corruption rejection.

Full scratch evidence is `/private/tmp/photoctl-memory-owner.hTxxr5/REPORT.md` with adjacent
runner, entry, traces and reports. Entry SHA-256 is
`4b5c07118bb7506e7416f83d848f13325696913c50cfe2a64d0f4d846601c3ee`; report SHA-256 is
`59e395a80ce532d26acd27927b72870e87a52b7c522c68c370856a78537f2105`.

### Validation snapshot witness

Three serial validations queue the same reduced artifact behind a bounded worker barrier.
After invocation, the scratch input is changed to NaN: queued validation still succeeds,
fresh validation rejects the corrupt input, and restoring the scratch bytes succeeds again.
The canonical artifact is never changed. This proves invocation-snapshot ownership and
preserves the finite-sample rejection contract; it does not measure the exact free timestamp.

Immediate queued RSS increases are 13.30, 13.12 and 13.14 MB, consistent in scale with the
13.11 MB copy. Ordinary `external` accounting stays flat for both validation and the already
accounted display-conversion control. Natural GC does not supply matched manual-counter
checkpoints, so that counter measurement is explicitly inconclusive. No native leak or
cause of the full-resolution failure is inferred from these numbers.

The probe uses one temporary process with `UV_THREADPOOL_SIZE=1` only to establish the queue
barrier; there is no production setting change, forced collection or performance comparison.
PID 98307 exits, and the artifact hash remains
`8692892237033cd68b02d6475894b51d141de32819af69fdb3af160e3f0377a7`.
`VALIDATION.md`, `validation.mjs` and `validation-report.json` beside the phase report own the
full observations. The next implementation gate is the existing native task-counter test:
charge the pending snapshot and release it after both success and rejection. Its test-only
GC observes the counter; it must not become runtime behavior or an RSS acceptance workaround.
