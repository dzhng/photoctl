# MGMatting — detail recovery without reliable hair scope

The released RWP model recovers substantially more lower strands than the
coarse SAM 3 seed, but admits recognizable eyebrow/eye ghosts into a hair-only
request. Its published connected-component cleanup does not repair that scope
failure. This is useful evidence for native-resolution refinement, not accepted
PhotoLab parity or permission to integrate the model.

## Reproduction boundary

[Acquisition](acquisition.json) pins official source, public RWP checkpoint,
size and SHA-256. The model's separately showcased automatic portrait system
uses extra private training data; it is not the checkpoint tested here.
The [runner](probe.py) uses unchanged upstream preprocessing and the official
single-image entry point with [recorded device/observation substitutions](adapted-source/device-observation.patch).
The original source remains unchanged. No size cap, alternate mask, new prompt,
or visually selected intermediate enters these two runs.

[Person provenance](person/provenance.json) and [hair provenance](hair/provenance.json)
record strict complete state loading with restricted weight deserialization,
modern dependency versions and original source/input hashes. Both fresh models
execute CPU FP32 at original 1614×1080 resolution with reflected native padding.
The source's RWP mask threshold and progressive refinement are preserved.

[Fidelity reconstruction](fidelity.json) matches all pixels through the two
progressive replacement stages, padded connected-component cleanup, cropping,
quantization and PNG decoding. [Red/green tests](test_adapter.py) exercise the
CPU entry point and preservation of fractional alpha before cleanup. These are
adaptation checks, not original-CUDA numerical parity or quality tests.

## Visual result

Raw and published outputs are both compared against identical source coordinates.
The published operation retains the largest component above its threshold and
removes the remaining alpha; it is not an additional learned prediction.
[Hair metrics](review/hair/capture-report.json) and
[person metrics](review/person/capture-report.json) measure alpha/edge disagreement,
not correctness. All full images and fixed 2× crops are retained in four views:
alpha, black, white and green overlay. No foreground color correction is applied.

- Hair detail: more lower wisps and local curl structure survive than in native
  SAM 3 or ZIM. Some crown/outer spaces remain pale and filled on black.
- Hair scope: the forehead crop retains a visible eyebrow and eye, plus skin
  around the curl. Both raw and published outputs fail that exclusion.
- Cleanup: removes low-level scattered alpha but can leave a harder irregular
  cutoff through the faint fringe. Pixel-count changes alone exaggerate its
  significance because raw near-zero coverage is widespread.
- Person: more fine hair survives while the bouquet is mostly excluded. The
  white garment left of the arm remains weak/translucent or absent, and petal
  boundaries remain imperfect. Apple includes the entire bouquet instead.

The unprimed reviewer inspected all sixty comparison sheets and fourteen
individual 2× crops. Hair ranks ZIM > raw ≈ published MGMatting > native SAM 3;
person ranks raw MGMatting > published MGMatting > native SAM 3 > Apple under
the explicit bouquet-exclusion contract. Neither raw nor published output is
accepted. The reviewer additionally confirms truncation of the prominent right
corkscrew and patchier faint-hair/sleeve boundaries after cleanup. Those findings
are visible in the main-agent crop inspection too. Better bottom-strand recall
must not conceal losses elsewhere.

## Runtime and retention

[Person](person/report.json) took 3.03 seconds for forward/output and 3.84 seconds
within the runner, peaking at 5.60 GB RSS. [Hair](hair/report.json) took 1.95 and
2.73 seconds, peaking at 6.48 GB. These are single observations, not a benchmark.
Each fresh process completed under its bounded watchdog.

The [archive manifest](archive-manifest.json) preserves outputs, intermediate
heads/refinement masks, adapted-source evidence and reproducibility scripts.
Weights, environments and temporary public-link session cookies are excluded.
[Upstream terms](upstream-LICENCE.md) remain research-only; adoption is separate.

For a compact comparison, inspect the [full hair overlay](review/hair/named-full-overlay.png),
[lower strands](review/hair/named-bottom-black.png),
[forehead exclusion](review/hair/named-face-white.png), and
[person overlay](review/person/named-full-overlay.png).

## Frozen ZIM-guidance control

One additional run changes only the hair guidance to the saved full-frame ZIM
result. [Conversion evidence](zim-guidance/conversion.json) preserves original
16-bit alpha and the rounded 8-bit guidance; exhaustive red/green checks prove
the released binary threshold selects exactly the original values ≥32768.
This is a binary-guidance control, not soft-alpha inference or a threshold sweep.
The model, source, native resolution, device and progressive refinement remain
unchanged. [Fidelity checks](zim-guidance/fidelity.json) again reconstruct all
output pixels exactly; the [runtime report](zim-guidance/report.json) records
2.07 seconds forward/output, 2.87 seconds within the runner, and 6.50 GB peak RSS.

The [control comparison](review-zim/named-full-overlay.png) improves top/right
curl separation and retains much more lower hair than direct ZIM. It reduces
the eye ghost versus SAM3-guided MGMatting but makes the eyebrow conspicuously
selected. Skin inside curls and a cheek fringe remain. Published cleanup again
turns faint regions into more abrupt, irregular cutoffs rather than resolving
the semantic mistake.

A fresh unprimed reviewer inspected all twenty-eight control sheets plus
full-detail crops. It ranks ZIM-guided raw ≳ ZIM-guided cleaned > direct ZIM >
SAM3-guided raw MGMatting, with moderate confidence in that tradeoff ordering
and high confidence in the visible failures. This is not inconsistent with the
earlier comparison: the new guidance improves the previously weak outer curls.
Direct ZIM still has cleaner facial exclusion. No candidate meets both goals.
Main-agent inspection confirms these defects across every crop.

The [control metrics](review-zim/capture-report.json) and separate
[archive manifest](archive-zim-manifest.json) preserve the complete new state.
Close this guidance branch without further threshold tuning. Native-resolution
detail recovery is demonstrated; reliable semantic exclusion is still missing.
