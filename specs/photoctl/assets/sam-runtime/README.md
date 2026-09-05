# Native SAM resource evidence

The [runtime probe](../../../../scripts/probe-sam2.mjs) exercises the real segmenter, including
letterboxing, native encoder/decoder calls, base-mask projection, and feature-cache eviction.
It uses synthetic display RGB to isolate execution resources; it cannot establish photographic
mask quality, full-resolution source preparation cost, or total CLI/daemon memory.

Run with `bun run probe:sam2 --models <directory>` after building the native and TypeScript packages.
Model files are explicit local inputs, never downloaded by this probe. Each report records their
hashes rather than declaring an unreviewed candidate a release. The process fails on exceeded
spec limits; missing models, invalid tensors, or inconsistent masks also fail loudly.

## Controlled comparison, 2026-09-06

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

Rust snapshots owned by asynchronous color tasks are separate from JavaScript backing stores. The task reports its actual
vector capacity to Node's external-memory accounting until disposal or output transfer. Node already accounts returned
typed-array backing stores, so the manual charge ends before that transfer. The shared guard stays on the task while its
vector moves through worker computation; only the originating Node thread may adjust the counter. Task destruction covers
completion errors that bypass `finally`. A pre-existing scheduler failure that leaks the entire task also retains its real
allocation and charge; accounting does not claim to repair that platform leak or guarantee cleanup after process teardown.

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

[Repeated full-resolution cache recheck](fullres-cache-accounting.json) remains **red** on the same code: the unchanged
7008×4672 distinct-buffer probe stopped after two of sixteen requested images at 3.161 GB peak RSS. Both masks retain the
historical exact hash. Its display-RGB input bypasses pointwise color conversion; the full-frame resampler snapshot remains
unaccounted. End-of-request RSS below the limit does not erase the measured peak. This fails before cache eviction is
exercised and is not superseded by the six passing independent CLI runs.
