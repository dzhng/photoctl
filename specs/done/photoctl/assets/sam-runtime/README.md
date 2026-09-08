# Native SAM resource evidence

The [runtime probe](../../../../../scripts/probe-sam2.mjs) exercises the real segmenter, including
letterboxing, native encoder/decoder calls, base-mask projection, and feature-cache eviction.
It uses synthetic display RGB to isolate execution resources; it cannot establish photographic
mask quality, full-resolution source preparation cost, or total CLI/daemon memory.

Run with `bun run probe:sam2 --models <directory>` after building the native and TypeScript packages.
Model files are explicit local inputs, never downloaded by this probe. Each report records their
hashes rather than declaring an unreviewed candidate a release. The process fails on exceeded
spec limits; missing models, invalid tensors, or inconsistent masks also fail loudly.

## Controlled comparison, 2026-09-06

Historical measurements below retain the limits used when they ran. The current
[segmentation contract](../../README.md#segmentation) uses an adjustable 5 GB peak-RSS investigation canary,
not a hard release ceiling; the [user policy](../../README.md#next-agent-prompt) governs further work.
Changing that policy does not relabel historical failures or complete interrupted runs.
Repeated-request/cache correctness still matters; a canary crossing alone is not a reason
for extended optimization or speculative accounting work.

[Merged correctness checks](merged-projection-checks.json) cover native loading and
segmentation after acquisition/composite/projection integration, not G6 resource acceptance.

The [merged scene-decode witness](merged-scene-resource.json) separately passes the
full-resolution cropped/rotated canvas journey under the approved budget. All three
public requests use one daemon and preserve the expected mask. Peak RSS is 3.477 GB,
the encoder runs once in 1.264 seconds, and the daemon exits cleanly. Source, models,
helper and release-addon hashes bind the report to its inputs. No forced collection
or provider work is used. This is a recorded-host resource pass, not photographic
edge acceptance or a guarantee for every input/platform.

The additional [sixteen-input full-resolution runtime check](merged-fullres-cache.json)
completes all requests with identical masks and 2.660 GB peak RSS, but remains **red**:
one encoder execution takes 4.124 seconds against the unchanged four-second gate.
[Verification](merged-fullres-cache-verification.json) records the failed request and
exact invocation. This supports bounded memory for that run, not overall acceptance.
One [fresh-process recheck](merged-fullres-cache-recheck.json), after other implementing
agents held heavy checks, completes all sixteen inputs at 3.057 GB peak RSS and 1.678
seconds maximum encode time. The prior failure is retained. Passive host observations
still showed substantial browser activity, so the recheck establishes that the timing
overrun did not repeat, not its cause or a latency guarantee under arbitrary contention.

[Before](before.json) and [after](after.json) use the same normalized SAM candidate, input, sixteen
photo identities, default libuv pool, and Apple M5 Pro. The original mutex-serialized runtime
peaked at 4,306,599,936 bytes; the dedicated inference thread peaked at 2,818,965,504 bytes.
Both produced the same exact mask hash. Every after-run encode was below 1.22 seconds.
The old production source was restored and rebuilt to falsify the final probe, then the worker
implementation was restored; this is not a comparison against a different decoder or easier input.

Single-worker libuv diagnostics removed the amplification, but changing that global pool would
also constrain unrelated native work. Disabling ONNX memory patterns alone failed the real
segmenter workload; disabling its CPU arena worsened it. Neither experimental setting remains.
The runtime instead gives its already-serial model execution one stable allocation thread.

This passes the native inference resource band for the recorded candidate and host, not all of
Slice 11. Real photographic probes, hair/foliage inspection, full-command resource evidence, and
release hosting remain separate acceptance requirements. No model binary is committed here.

## Pointwise conversion allocation checkpoint

Camera-front and display-back conversion reuse their task-owned float vector as output. The asynchronous boundary still
snapshots caller-owned input; no JavaScript buffer is mutated and no color, develop, or resampling arithmetic is reordered.
Allocation identity and public Float32-word regressions pin those separate guarantees. Deliberately reintroducing an output
clone fails the allocation test; mutating caller input fails the public test.

[Full-command measurements](pointwise-memory.json) remain **red**: three of six sky/road runs exceeded the unchanged 3 GB
RSS band, despite exact baseline mask hashes in every run. Each full RGB buffer is 392.9 MB. Reusing the vector removes one
allocation per pointwise conversion, but does not promise lower process RSS: JavaScript external buffers await collection,
the resampler still snapshots a full frame, and freed native storage can remain resident. NAPI drops each asynchronous task
after resolve/finally; this is not evidence of a task-reference leak. No forced GC or allocator/thread tuning was applied.

Reproduce with `/usr/bin/time -l node apps/cli/dist/bin.js segment <id> --at <point>` in a no-daemon library containing the
linked fixture and pinned models, alternating sky `4000,600` and road `4400,3500` three times. Use an isolated cache and the
fixture-volume mapping. The recorded runs observed native-boundary timings without changing operation results. This is an
exact-allocation checkpoint, not full-command resource acceptance or photographic mask-quality acceptance.

## Cache mapping ownership

A cached coordinate mapping owns dimensions, never the source image. TypeScript's dimensions annotation does not remove
runtime image properties: spreading the source copied its pixel-array reference into every cached encoder result. The
dimension-only snapshot prevents that retention without changing normalization, projection, image hashing, or LRU policy.
The regression passes a real image through native encoder preprocessing and verifies the mapping cannot carry its pixels.

[Cache measurements](cache-memory.json) use distinct pixel buffers, not only distinct photo IDs. Full-resolution before/after
probes both stopped after two requests at the unchanged 3 GB safety band: peaks were 3.872 GB and 3.369 GB, with the same exact
mask hash. A separate 4000×2667 run completed ten requests through the eight-entry cache at 2.783 GB. That smaller-frame
eviction check does **not** replace the failed full-resolution resource check. Reproduce with the runtime probe's dimensions,
run count, and `--stop-on-memory-limit` options; defaults retain the original sixteen-request 1024-square benchmark.

The report also preserves the rejected delayed-session experiment: constructing sessions only after encoder preprocessing
increased RSS in both cold CLI comparisons. No such lifecycle change is implemented. Cache cleanup alone does not constrain
command-owned images, the resampler snapshot, or allocator residency; full-command G6 remains open.

## Pixel-free prepared inputs

The command's segmentation dependencies retain a prepared handle and geometry, not the full display image. A handle owns
normalized encoder input or pins an existing feature entry for the active command. Image hash, letterboxing, grounding JPEG,
and base-mask projection are unchanged. Source-pixel WeakRef tests explicitly collect garbage before first inference;
reintroducing an image-bearing metadata reference makes that test fail. Production never forces collection.

Preparation only peeks at the existing feature cache. Insertion, recency updates, and encoder singleflight remain at first
segmentation, so empty grounding results neither encode nor evict other photos. Concurrent cold preparations may duplicate
bounded preprocessing; they share encoding once used. A prepared handle is a pixel snapshot, not a persistent second cache.
Active handles can keep their feature entry alive through eviction until that command finishes. New photo pixels require a
new preparation. Failed commands can retry through fresh preparation without retaining rejected cache entries.

The intentional timing tradeoff is that preprocessing now finishes before the external grounding request. Empty results
still avoid inference, but incur preparation work; preprocessing errors surface before external spend. The grounding JPEG
is generated from the same display pixels before they become unreachable. Regression tests pin its pre-change HTTP bytes,
zero-result behavior, concurrent prompts, cache invalidation/eviction, retry, and projected masks.

[Prepared-input measurements](prepared-memory.json) preserve exact sky/road masks in six no-GC full CLI runs, but three still
exceed the 3 GB RSS band. The largest observed peak precedes input preparation, at display-conversion enqueue. A separate
full CLI WeakRef diagnostic confirms display pixels are collectible at encoder entry; its explicit test GC result is
ownership evidence only, never resource acceptance. This establishes an earlier release point, not full-command G6 or
photographic quality acceptance.

## Native task allocation accounting

Scene-linear consumers can request that output space from the existing decoder contract. LibRaw
then moves its decoded, already-scaled vector through the same camera-front conversion before
publishing pixels to JavaScript. Default decode still returns camera samples and calibration;
scene output carries canonical levels and no stale camera-only calibration fields. File and CIRAW
already produce scene-linear pixels, and generic camera conversion remains idempotent for scene
input. Decoder selection, orientation, crop dimensions, and resize-before-color ordering do not change.

This avoids the full camera Float32 round trip through JavaScript and the next native snapshot.
A Rust allocation-identity regression fails on a deliberate clone; the public quarter-scale exact
hash fails when color conversion is moved before resizing. Full-source 7008×4672 output matches
the original two-step conversion exactly (SHA-256 `c65b76a77523358b919f8492227f7f70b7fca81b0bc6089035977701d9ded35b`).
This is pixel/allocation evidence, not an RSS or G6 pass. Decode allocations arise on the worker;
no predicted Node memory reservation or worker-thread Node-API call is added.

The shared [supported RGB projection](../../../../../packages/render/src/graph/projection.ts) plans
ordered native sampling stages and final visible-frame restrictions. Stage matrices map each input
to its next output; restriction matrices map final output centers into an authored visible frame.
The native worker snapshots RGB once, alternates two owned vectors, and clips the final pixels
without publishing intermediate RGB or materializing support masks. It uses the existing sampler
and the mask clipper's shared containment predicate: folding successive transforms would change
fractional sampling, while forgetting earlier frame restrictions would restore cropped-away pixels.

The task charges actual allocated vector capacities, including its reusable workspace. Before
transferring final pixels, it frees the other vector and tightens output capacity to the exposed
typed-array length, which is all Node accounts. This can reallocate; it is not a promise of constant
RSS. Public tests pin exact staged/fractional pixels, signed zero, invocation snapshots, queued
charges, output transfer, and rejection after an intermediate stage. Deliberately reversing stages,
disabling clipping/zero normalization, delaying the snapshot, and omitting a buffer charge fail
their respective regressions. The independent static review found no actionable defect.

[Supported-projection measurement](supported-projection-resource.json) remains **red** at
3,747,168,256 bytes. The unchanged safety rule stopped after the first of three required requests;
its mask remains exact and encoding took 939 ms. The own release build uses the old default ORT,
matched helper and models, and no forced GC. High-water RSS reaches 2.692 GB after camera-front
conversion, 3.405 GB after supported projection, then 3.747 GB during display conversion before
inference. This removes demonstrable intermediate allocations, but does not close G6 or establish
a reliable RSS ranking against separate historical runs. Source/front lifetimes and allocator
residency remain separate from the task's exact allocation accounting.

The [composite allocation audit](composite-memory.md) extends the same ownership principle to
masked operations and separates exact allocation/counter proofs from full-command RSS acceptance.

Rust snapshots owned by asynchronous pixel tasks are separate from JavaScript backing stores. The task reports its actual
vector capacity to Node's external-memory accounting until disposal or output transfer. For pointwise color conversion,
Node already accounts the transferred typed-array backing store, so the manual charge ends before that transfer. The shared guard stays on the task while its
vector moves through worker computation; only the originating Node thread may adjust the counter. Task destruction covers
completion errors that bypass `finally`. A pre-existing scheduler failure that leaks the entire task also retains its real
allocation and charge; accounting does not claim to repair that platform leak or guarantee cleanup after process teardown.

Resampling and affine transformation borrow their task-owned inputs to produce separate output allocations. Their input
charge therefore survives output registration until task destruction frees the input; it is not transferred to the output.
Only allocated input capacity is reported, not predicted worker buffers. [Resampler accounting evidence](resample-accounting.json)
pins queued capacity, settled output-only accounting, rejection cleanup, and exact caller-snapshot pixels. Full-resolution
RSS must be measured separately without forced GC; counter correctness alone cannot close a resource witness.

[Accounting evidence](task-accounting.json) separates two V8 metrics: Node 24's public `external` memory statistic reads
backing-store bytes, while `--trace-gc-verbose` prints the manual external-memory counter separately. The consumer regression
uses the latter at controlled phases, with test-only GC to print diagnostics. It does not add a product inspection API,
force production collection, or establish an RSS improvement. Pending, transferred, and rejected work are measured through
the real native bindings; pixel and caller-snapshot tests independently preserve the color contract.

[Full-command accounting measurements](task-accounting-cli.json) record six subsequent sky/road runs with no forced GC:
all preserve the baseline masks and stay below the 3 GB RSS limit, ranging from 2.04 to 2.27 GB. Peak memory footprint is a
different metric and ranges from 3.00 to 3.32 GB. This passes the recorded RSS witness on this host and fixture, not the
photographic-quality gate or every platform. The historical prepared-input runs are not an interleaved A/B experiment;
allocator residency and memory compression can influence causal comparisons. Other native snapshots remain unaccounted.

[Repeated full-resolution cache recheck](fullres-cache-accounting.json) is the historical **red** on color-only accounting: the unchanged
7008×4672 distinct-buffer probe stopped after two of sixteen requested images at 3.161 GB peak RSS. Both masks retain the
historical exact hash. Its display-RGB input bypasses pointwise color conversion; the full-frame resampler snapshot was
unaccounted in that run. End-of-request RSS below the limit does not erase the measured peak. This failed before cache eviction was
exercised and is not superseded by the six passing independent CLI runs.

[Full-resolution resampler-accounting recheck](fullres-cache-resample-accounting.json) passes all sixteen distinct-buffer
requests through the existing cache at 2.842 GB peak RSS, with unchanged model and mask hashes. No forced GC was used. The
competing ORT build container was fully paused; roughly 1 GiB idle VM memory remained resident on the 48 GiB host. This is a
measured runtime-cache pass, not an interleaved pristine-host A/B comparison. It supersedes the preceding resource result
for this runtime witness, while preserving the historical failure. Source/develop preparation, command dispatch and library
commit are absent from this probe, and the passing independent CLI runs started fresh processes.

[Persistent-daemon measurements](daemon-accounting.json) cover six public sky/road requests on the same full-resolution
photograph through one daemon. All preserve exact masks; cumulative daemon peak RSS is 2.221 GB, including cold preparation,
with one 1.297-second encoder execution reused across six decoder calls. The observer records the daemon's native-boundary
timings and cumulative OS high-water counter, not client-process RSS. No forced GC or allocator tuning is used; the daemon
stops cleanly afterward. An idle ORT build VM remained resident, so this is not a pristine-host causal comparison.

The [combined public multi-photo witness](daemon-multiphoto-accounting.json) passes at 2.625 GB peak daemon RSS.
Nine tail-distinct fixture copies have separate catalog identities and cold encoder entries; revisiting the first after
eviction re-encodes, while revisiting the most recent reuses its entry. All eleven masks remain exact, and the slowest of ten
encoder executions is 2.160 seconds. Source preparation, command dispatch and library commits run through the public CLI;
the daemon stops cleanly afterward. The existing fixture generator supplies identity diversity, not different photographic
scenes or real-drive acceptance. The idle-VM and no-forced-GC controls remain explicit. These recorded host witnesses pass
the resource band; photographic edge quality, arbitrary-image worst cases and other-platform resources remain separate.
