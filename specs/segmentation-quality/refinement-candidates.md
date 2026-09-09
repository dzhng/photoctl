# Refinement must retain selection intent

The native SAM 3 baseline separates hair from person, but fails fine boundaries.
A useful next experiment must test both detail recovery and semantic exclusion;
softer edges alone do not satisfy the contract.

## Bounded replication: SDMatte

The [measured portrait and holdout results](assets/sdmatte/critique.md) improve
some boundaries but introduce unrelated content. SDMatte is not an accepted
quality candidate. All four fixed predictions and independent reviews are complete.

[SDMatte's official implementation](https://github.com/vivoCameraResearch/SDMatte)
and [paper](https://arxiv.org/abs/2508.00443) provide a trained mask-conditioned
alpha predictor. This differs from constructing an increasingly broad unknown
band for an unconditioned trimap refiner. Whether its guidance actually preserves
hair-only scope remains an empirical question, not a consequence of the API.

Freeze the original portrait and native SAM 3 text-hair mask. Use the full released
model, published one-step/no-noise configuration, mask guidance, empty caption
and ordinary opaque-object category. Keep the official full-frame square resize
before any resolution or crop experiments. Preserve raw fractional output, the
exact supplied guidance, runtime measurements and every visual result.

The model accepts one visual guidance type at a time. Its point pathway has no
positive/negative labels; do not pretend the existing signed point contract maps
directly to it. The current replication uses masks, not a lossy conversion of
negative points. Opacity category is model conditioning, not an instruction to
threshold alpha. Its optional caption field is not proof of text-only selection.

Local execution requires explicit CPU device placement in the forward path.
Keep the actual model and attention mathematics intact; bypassing the benchmark
dataset's ground-truth/file-layout dependencies is a harness adaptation, not a
different inference algorithm. Runtime feasibility and quality get separate
verdicts. The source advertises MIT, but upstream pretrained-weight obligations
remain a separate adoption check.

## Completed text-conditioned reference probe

The distinct question was whether text conditioning during matting preserves
the target more faithfully than refining a mask alone.
[Teaching Diffusion Models to Ground Alpha Matte](https://github.com/xty435768/TeachDiffusionMatting),
with its default SD 2.1 configuration and complete high-resolution refinement, was
[replicated and reviewed](assets/text-matte/critique.md). Both hair phrases
select face/clothing; the person, sky and road holdouts also fail. Do not adopt
this model or mistake its successful CPU execution for useful segmentation.

The checkpoint repository is available on
[ModelScope's international endpoint](https://www.modelscope.ai/models/cstyxiang/TeachDiffusionMatting).
The regional endpoint did not expose this repository. Its model card declares
Apache License 2.0, but this does not resolve the source repository's missing
project-level license or upstream dependencies. Product adoption remains separate.

The [CPU replication evidence](assets/text-matte/replication.md) records strict
weights, sparse-library comparisons, native Mac checks, and an exact upstream
entry-point comparison. Real portrait features also agree through both original
sparse refinement stages. The resulting scope failures are not repaired by
disabling high-resolution inference or silently clipping alpha to a coarse mask.

## Completed trained SAM 3 variant

[SAM2Matting](https://github.com/FudanCVL/SAM2Matting) exposes a SAM3-backed
variant with native text prompts and learned matting. Its project name does not
mean every checkpoint uses SAM 2. The previous
[Tiny replication](assets/sam2matting/replication.md) is not evidence for this
variant. The [complete SAM3 refinement comparison](assets/sam3-matting/critique.md)
uses saved native SAM 3 masks, trained image features and all progressive heads
without rerunning segmentation. It improves forehead exclusion but loses real
hair, fails sky and weakens road coverage. Complementary foreground refinement
followed by inversion also fails sky. Preserve the negative evidence; this is
not an accepted generic pipeline.

## Completed native-resolution human matting comparison

[MatAnyone 2](https://github.com/pq-yang/MatAnyone2) offers an official still-image
demo based on repeated identical frames, with no model-internal size cap by
default. It is documented as human matting, not arbitrary concept selection.
The [fixed comparison](assets/matanyone2/critique.md) used the original portrait
and frozen native SAM 3 person and hair seeds. Person is the supported target;
hair is a separately labeled out-of-domain diagnostic. Both complete on MPS but
lose important curls and clothing. Neither passes independent visual review.

The preserved official image schedule uses two identical frames, ten warmup iterations
as exposed by the demo (thirteen core steps in the actual wrapper), a fresh
processor per seed, and the last floating alpha rather than a visually selected
intermediate. Keep the wrapper's zero morphology settings to preserve the
supplied seed. Retain every prediction, native padding, device and precision.
Use the supported MPS FP32 path on this Mac; do not silently switch to CPU
bfloat16, reduced resolution or fewer steps. Skip unused pretrained-backbone
initialization only after a full strict checkpoint audit proves all state is
supplied. This remains noncommercial research while adoption requirements are
unresolved.

## Other availability checks

- The text-conditioned model's apparent optional-import guard does not remove
  its `spconv` dependency. The completed CPU replication resolved this execution
  prerequisite without disabling the high-resolution stage.
- [MAM2](https://github.com/ChenyiZhang007/Matting-Anything-2) still provides only
  a release-soon README. [DFIMat](https://github.com/JiaoSiyi/DFIMat) currently
  exposes a README and figures, not a runnable model despite its description.
  Neither is an executable next spike on the inspected state.
- [SAMA's paper](https://arxiv.org/abs/2601.12147) describes joint segmentation
  and matting with local-view features. No corresponding official code/weight
  release was located in the paper and targeted search. Same-name repositories
  for video chat, video editing and material selection are unrelated.

These are availability findings as of 2026-09-09. Do not infer inferior quality
from missing code, or infer production suitability from a published benchmark.
