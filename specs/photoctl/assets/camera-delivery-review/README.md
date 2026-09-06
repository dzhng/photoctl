# Camera-reference delivery quality

The permanent camera originals are sufficient to reproduce these failures without
reconnecting the camera. This checkpoint separates successful command execution
from photographic deliverability: **the inspected delivery set is rejected**.

## Reproduction and evidence boundary

On 2026-09-06, the built CLI at `89811b3` ran the unchanged `scripts/gold-exam.sh`
against `fixtures/camera` with `--source-kind fixture`, an isolated manual-embedding
library, linked originals, and no daemon or live provider. It imported 18 logical
RAW/JPEG pairs, rated ten, applied the people preset to three, and exported ten
profiled JPEGs without failures or skipped deliveries. The report's photographic
acceptance remains `not_recorded`; it does not encode this subsequent review.

The original run is at `/private/tmp/photoctl-camera-reference-gold.cc9Ux2`.
Its delivery manifest verified all ten JPEGs and both reports. The SHA-256 of
`gold-exam-report.json` is
`48953fdebc8fc3569dd6afd2e7837f10e129260ac19d7c52ca5927e44f4c182e`.
This is local permanent-fixture evidence, not the prescribed mounted-drive exam,
an installed release gate, or a claim that every card image decodes correctly.

Explicit camera-JPEG show and export also succeeded for the differing-resolution
DSC00103 pair: the JPEG is 7008×4672 and names its own original identity; the
RAW-led delivery is 3504×2336. All 36 saved originals were independently rehashed
against their manifests after the run, with no mismatch.

## Visual result and next requirement

Main inspection and a fresh, unprimed reviewer inspected the complete ten-image
delivery set. Native-detail crops enlarged two times exposed defects hidden by
overview downsampling. The reviewer also compared matching camera JPEGs; those
establish scene context, not an exact RAW-processing or exposure baseline.

- Bright lights, flame and reflections have flat artificial pink/magenta cores in
  DSC00104, DSC00107, DSC00122, DSC00442 and DSC07730.
- DSC00434 has pink/cyan bright-sky patches rather than neutral cloud highlights.
- DSC00103 has dense alternating vertical red/dark stripes and thin yellow-green
  edge contamination at native detail, with a strong overall color mismatch.
- Minor colored fringes in DSC00290 deserve later inspection; optical versus
  decoder origin is not established. Subdued exposure in DSC07633 and DSC07668
  alone is not a rendering defect. All ten are recognizable and correctly oriented.

The retained [stripe crop](DSC00103-crop.png) and
[highlight crop](DSC00107-crop.png) are diagnostic excerpts, not the complete
capture set supplied to the reviewer. No image has been accepted merely because
it is nonblank, carries a profile, or matches a hash.

Next, isolate the failure boundary using both RAW decoders, their working-space
samples, and display encoding. Do not hide a decoder defect with preset tuning,
switch every RAW to its companion JPEG, or weaken the decoder oracle. Add a
behavioral regression before correcting the responsible owner, then rerender and
inspect the complete set plus native details. Until that passes, the camera
workflow is not photographically accepted.
