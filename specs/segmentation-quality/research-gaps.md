# The remaining gap is not softer edges

The completed [spikes](spikes.md) establish useful semantic selection. The
[reference-framing audit](assets/reference-audit/critique.md) additionally accepts
direct ZIM as comparable to the supplied PhotoLab portrait at its visible
viewport. That is narrower than error-free alpha or generic boundary quality.
Success on this portrait does not imply sky or road quality.

## What the evidence separates

| Contract | Current evidence | Still missing |
| --- | --- | --- |
| Selection intent | Native SAM 3 distinguishes hair, person and separate instances. | Correct scope must survive refinement. |
| Fine coverage | ZIM retains the most hair among measured full-frame candidates; local photographic crops can recover wires and foliage. | Complete curl continuity, clear holes and no skin/background leakage in one automatic full-frame result. |
| Context and resolution | Higher-resolution SAM improves detail but has prediction dropout; automatic ZIM crops regress on hair. | A resolution-aware method that retains context without hand-combining regional winners. |
| Runtime | Several official/adapted Python paths execute on this Mac. | A quality-qualified model integrated through the existing CLI, projection and fractional mask store. |
| Reference fidelity | Matched clean/overlay video frames establish the visible target. | Original photography and exported ground-truth alpha are unavailable; pixel-distance metrics cannot certify parity. |

Do not repeat generic trimap widening or nearest-point guards. Their failure is
not simply poor parameter choice: they allow non-target skin or flowers into an
uncertain region without giving the matte predictor enough semantic information.
Do not combine successful authored crops into a purported automatic solution.

## Native-resolution result and remaining control

Can a released native-resolution, mask-conditioned progressive refiner recover
missing strands while preserving the frozen SAM 3 selection intent?

[MGMatting](https://github.com/yucornetto/MGMatting) is a distinct
reference for that question. The [completed portrait comparison](assets/mgmatting/critique.md)
recovers lower strands but adds facial ghosts and loses clothing; neither output
passes. Its released inference uses three progressive alpha
heads and image-aligned refinement, without the fixed-square encoder used by
several rejected candidates. Its
[automatic-system showcase](https://github.com/yucornetto/MGMatting/blob/main/result/RESULT.md)
uses extra private training data: do not attribute that showcase to the public
checkpoint. The published RWP checkpoint is the portrait probe; hair-only remains
a scope-stress test. Its official mask preprocessing is binary even though the
paper discusses broader guidance: a soft-mask run would be a separate experiment.

The [completed guidance control](assets/mgmatting/critique.md#frozen-zim-guidance-control)
changes only the supplied hair guidance to the saved full-frame ZIM result,
using the released binary threshold. It recovers more outer curls but still
selects the eyebrow and skin. Close this branch rather than sweep thresholds.
It does not test soft guidance, new prompts or a hand-combined output. The
portrait result does not establish generic segmentation quality.

## Lower-priority leads

[Phoenix](https://github.com/naver-ai/Phoenix) is a newly available coarse-mask
repair model with separate instance and fine-segmentation checkpoints. Its public
API returns a Boolean mask, not alpha coverage. It may address region repair,
but cannot by itself satisfy the matting contract; do not reinterpret sigmoid
confidence as physical coverage. Defer a run until a concrete seed defect makes
that separate question useful.

The pending commercial-use decision still matters before adoption. Published
research code and downloadable weights do not establish permission to ship them.
Training a replacement or acquiring private data would be a new, explicitly
scoped project, not an unannounced continuation of checkpoint evaluation.
