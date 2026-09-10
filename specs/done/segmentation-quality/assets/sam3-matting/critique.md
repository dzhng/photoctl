# Trained SAM 3 matting: better exclusions, incomplete detail

This is SAM2Matting's released **SAM3** variant, not its previously measured
Tiny checkpoint and not the text-guided diffusion model. It receives the frozen
native SAM 3 semantic mask through the documented still-image matting seam.
The [portrait replication report](report.md), [holdout report](holdouts/report.md)
and [polarity-control report](polarity-sky/report.md) own provenance and runtime.
No product model or interface changed.

## Hair-only result

An unprimed reviewer inspected every full view and all six fixed crop regions.
It ranked **ZIM first, trained SAM3 matting second, native SAM 3 last**, with
high confidence. The parent inspected the same regions and confirmed the
tradeoff. The [capture report](review/capture-report.json) maps neutral A/B/C
to the models; `named-` comparison images provide model names for human review.

- Crown and right: refinement opens some curl holes and reduces trapped
  background, but suppresses crossing strands and loses much of the outward
  zigzag curl. ZIM retains more actual hair, despite its remaining haze.
- Forehead: trained matting clears skin inside the hanging curl and tightens
  the cheek edge. It also drops the small terminal curl and makes parts of the
  upper curl unnaturally translucent. Cleaner exclusion is not complete recovery.
- Flowers: all three exclude the sampled flower and nearby skin.
- Bottom: ZIM retains a substantial hanging cluster; trained matting nearly
  removes it. None recovers all longest wisps.
- Supplemental crown: trained matting's coarse holes and lost crossing strands
  create a blotchy transition. Some holes correspond to real source gaps, so
  their existence alone is not a defect; the lost hair and coarse boundaries are.

The mean absolute alpha distance from ZIM is 0.028968; 6.807% of pixels differ
by more than 0.1. Against the frozen native SAM 3 seed, these are 0.026219 and
4.621%. These are disagreement measurements, not accuracy. The named full,
forehead and bottom comparisons were opened in one Preview checkpoint, then
closed after the non-blocking review window. No new user acceptance was inferred.

## Person, sky and road

A separate unprimed reviewer inspected the full image and all seven person
regions, plus all four landscape regions. The
[holdout capture report](review/holdouts/capture-report.json) owns bounds and
metrics. Its neutral labels are P/S/U for native SAM 3, Q/T/V for trained
matting, and R for Apple's accurate person mask.

| Target | Less wrong | Remaining or introduced failures |
| --- | --- | --- |
| Visible person, excluding bouquet | Trained SAM3 matting | Better hair gaps and fewer stray flecks, but missing long curls and the white clothing behind the forearm; soft/blotchy upper transition. Apple retains finer strands but selects the bouquet. |
| Sky | Native SAM 3 | Trained matting is almost empty, with faint wire/contrail traces. Native SAM 3 still misses foliage holes and has inconsistent wire exclusion and broad pole/treetop gaps. |
| Road | Native SAM 3 | Trained matting makes opaque pavement broadly transparent near the bend and loses distant continuity. Softening the foreground edge does not compensate for missing asphalt. |

The relative verdicts have high confidence. None passes the full target. The
trained model's native final alpha is 576×576; the published predictor enlarges
it to the original photograph. Original-size output does not mean native
original-resolution inference.

## Sky polarity control

One additional run preserved the image, weights and inference path but supplied
the exact complement of the sky seed as foreground. The derived sky mask is
exactly `1 - predicted foreground alpha`, with no threshold or cleanup. Both
raw foreground and derived sky predictions are retained and labeled explicitly.

An independent reviewer inspected all full views and four crop regions in the
[polarity comparison](review/polarity/capture-report.json). It ranked native
SAM 3 above both matting conventions with high confidence. Direct refinement
selects almost nothing; complementary refinement followed by inversion selects
sky **and nearly all ground, trees, railway and fence**, leaving mainly a soft
road-shaped exclusion. Approximately 94.75% of pixels exceed 0.5 in the derived
sky alpha. This does not rescue the model's sky behavior.

## Evidence storage and consequence

[Archive manifest](archive-manifest.json) records original-byte hashes for every
copied artifact. Arrays larger than 64 MiB are gzip-compressed losslessly to
keep research files manageable; decompressed bytes were hashed against the
originals. `.npy.gz` can be read with NumPy through `gzip.open`. Native alpha,
original-size alpha, all progressive predictions, seeds, reports and complete
comparison sets remain retained. Weights and runtime environments are excluded.

Do not adopt this refiner as a generic quality upgrade or describe local face
improvement as PhotoLab parity. Keep the useful learned-exclusion observation,
but the current best full-frame hair reference remains ZIM. Noncommercial terms
and the upstream ShareAlike discrepancy also remain unresolved for adoption.
