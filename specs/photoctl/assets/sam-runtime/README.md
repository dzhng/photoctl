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
