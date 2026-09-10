# Orientation sensitivity of the 2048 dropout

The rectangular hair dropout is a prediction defect, not PNG corruption.
The [raw-logit check](raw-logit-check.json) finds finite negative logits at the
missing pixels and exact agreement between thresholded logits and the saved
mask. This does not identify a particular faulty layer or prove a software bug.

## Mirrored input

The [flip experiment](flip-method.json) mirrors the source and all frozen point
coordinates, runs the unchanged 2048 configuration once, then maps every output
back. The [artifact pair](flip-artifact-pair.png) shows original A and flip-back B.
The [retained mask](flip-mask.png) and [distances](flip-distance.json) preserve
the result without visually substituting a different candidate.

An unprimed reviewer confirms that B restores real hair in the rectangular patch
and more top curl detail. But B adds visible eye/eyebrow pixels and a detached
neck patch beside the flower; it also loses some right-edge curl detail. Both
still miss long bottom flyaways. The reviewer inspected all full paired views,
all seven feature/artifact crops in every representation and all three B candidate
masks. Parent inspection agrees on the restored patch and new contamination.

This is evidence of orientation-sensitive model behavior, not a robust fix.

## Fixed two-view mean

The [mean experiment](mean-method.json) averages the two independently selected
native logit maps equally, with no new inference or morphology. It keeps the
original threshold. [Full comparison](full-overlay-ABC.png) and
[artifact comparison](artifact-context-overlay-ABC.png) show A=original,
B=flip-back and C=mean. The [distance record](mean-distance.json) does not measure
accuracy.

A second unprimed reviewer inspected all full states and all eight feature crops.
C removes B's prominent eye/eyebrow and detached neck contamination and restores
much of A's missing patch. However, conspicuous horizontal slits remain in actual
hair, still visible in full composites. C also loses B's isolated crown curl and
does not restore bottom flyaways. It is a useful compromise, not an accepted
artifact fix. Parent inspection agrees.

Complete scratch records remain at `/private/tmp/openphoto-sam21-flip.7lhkit`
and `/private/tmp/openphoto-sam21-mean.6k2uV3`. No production model, mask API or
storage contract changed. The next bounded control tests one intermediate input
resolution before considering more complex aggregation.

That [1536 control](../sam21-intermediate/critique.md) also leaves blocky/horizontal
dropouts. It does not establish a stable higher-resolution setting.
