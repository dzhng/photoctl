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
