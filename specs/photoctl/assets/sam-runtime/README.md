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
