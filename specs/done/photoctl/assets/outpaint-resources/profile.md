# Expanded-export latency diagnosis

**P1, supported: affine Lanczos weight recomputation dominates cold native
outpaint export.** A normal full-size export after an upstream edit takes about
42 seconds on the recorded host. This is bounded computation, not a retry loop:
the command completes, stores deterministic results, and the next identical
export reuses them. The diagnosis below preserves the original measurements;
implementation verification is recorded separately at the end.

## Controlled request and observed stacks

The retained JPEG library from the resource witness was changed only through
public `undo` (restore its border), then `develop --set exposure=0.125`. The
new photographic state requires a cold deterministic render. One cold PNG export
and one unchanged warm export ran with Node `--cpu-prof` and macOS `sample` at
10 ms intervals. The native sampler observed the first 30 seconds of cold work
and requested eight seconds for the warm process, which exited sooner.

Cold elapsed time was 42.470 seconds, warm 6.154 seconds (6.90×). The delivered
7264×4928 PNGs are byte-identical, SHA-256
`ea591435a43389e0d3f7c3e7f07b0d17a9066ee0344b41b0cbb42f9fe7510e46`.
The fake gateway was already closed; these deterministic commands need no paid
generation. Ordinary desktop activity and other agents' tests/builds were not
held during profiling, so this is attribution evidence, not a clean benchmark
against the earlier timings or a latency distribution.

In the cold sample's 2,490 observations per long-lived worker thread:

- `TransformF32Task::compute` appears in 1,554 samples, under `transform_into`
  and repeated `sin` calls.
- `MaskTask::compute` appears in 664 samples, also under the same Lanczos
  transform. A supported-base projection has 35 additional transform samples.
- The V8 profile spends 37.196 seconds in main-thread idle, consistent with
  awaiting native work. Its largest non-idle buckets are hashing (1.555 s),
  artifact normalization (0.775 s), and float-TIFF decode (0.537 s).

These counts are thread-stack occupancy during the sampled window, not mutually
exclusive percentages of the complete export. The window ends before cold PNG
delivery, so absence of PNG frames there does not prove encoding is free.
The warm sample has no `transform_into` frames and does show PNG/deflate work;
the V8 profile retains hashing and artifact validation. Canonical float TIFFs
are uncompressed (the existing encoder writes Compression=1), so canonical
compression is not the missing 36-second cold cost. Validation/hashing remains
measurable, but is not the first optimization target.

## Amplification and smallest general correction

The shared native [affine sampler](../../../../../crates/photoctl-image/src/resample.rs)
owns both RGB and mask sampling. In the ordinary magnifying Lanczos case, each
output pixel has a 6×6 footprint. It recomputes six Y weights and 36 X weights
**per channel**; each nontrivial weight evaluates two sine functions. The RGB
path repeats identical weights three times. The projected provider image is
1536×1042 while the canvas has 35,796,992 pixels: a full RGB projection entails
4,510,420,992 weight evaluations; the analogous mask projection entails
1,503,473,664. These are loop-derived workload counts for that full footprint,
not instrumented counts of calls that survive zero/support checks.

Recommendation: prepare the X and Y weights once per output pixel in the same
sampler and reuse them across rows/channels. Preserve tap traversal, each
channel's accumulation order, normalization, transparent edges, support scaling,
and ordered projection stages. That removes repeated trigonometry without a
second resampling owner, altered filter, stage fusion or approximate color math.
Do not begin with a separable two-pass resampler: changing summation order can
change exact pixels. Existing integer-transform shortcuts and the 4,096-tap
per-pixel guard stay in force; the guard bounds pathological kernels but does
not make billions of legitimate repeated weights cheap.

Acceptance belongs at the existing native transform/mask consumers: compare
Float32 words for fractional/scaled/rotated projections, edge transparency and
downsampling support, then rerun this public full-canvas export with exact
protected interior, removal, and no provider replay. Falsify the work reduction
with a deterministic operation-count check, not a noisy wall-clock assertion.
Only a new measured profile can establish the speedup. Preserve source promotion
and cache invalidation; suppressing cold renders would hide new edits, not fix
their cost.

## Retained evidence

Full native/V8 profiles, commands, results and PNGs remain at
`/private/tmp/photoctl-outpaint-resource-measurement/profile`. The compact
[profile measurements](profile.json) retain source-profile hashes and top V8
buckets. The runtime addon hash matches the original resource witness; profiling
used root revision `5fa235e` without changing production code. Scratch profiling
instrumentation is not committed. No broader experiment or speculative fix was
needed to select the next owner.

## Exact-order implementation verification

The sampler now prepares each axis's weights once per output pixel and reuses
them across channels, with reusable bounded scratch storage. It retains the
same tap order and per-channel normalization; neither filters nor cache identity
change. No new image-sized buffer or public control is introduced.

The focused work-budget witness failed on the original loop (1,470 evaluations
for a 35-pixel monochrome transform versus the 420 axis-weight budget). It passes
with shared weights, including equal RGB work and identical channel samples.
Bitwise Float32 comparisons cover fractional translation, enlargement, reduction,
rotation, reflection and transparent boundaries for one, three and four channels.
Perturbing a weight deliberately made that comparison fail at its first pixel;
restoring the arithmetic passes all 17 native resampler tests. The optimized
native build also succeeds using the documented isolated CMake/Ninja tool path.

Independent code review `01a07554-303e-7cb2-b71c-49dfe50b1e09` found no actionable
correctness issue. Its attempted test lacked CMake on PATH; the successful main
test run above is separate evidence, not a claimed reviewer execution. The complete
native crate passes 75 tests; the freshly packaged addon also passes 65 shared
projection, mask, allocation-accounting and graph-evaluator consumer tests.
The [public full-canvas recheck](README.md#isolated-optimized-runtime-verification)
records measured elapsed-time improvement and exact before/after PNGs for both
original formats. Operation counts alone do not establish speedup, and these
focused checks do not establish release acceptance.
