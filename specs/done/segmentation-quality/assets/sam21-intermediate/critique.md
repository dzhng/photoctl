# Intermediate resolution is not a stability fix

A single 1536 portrait run reduces the conspicuous 2048 rectangular dropout
and improves some contours over 1024, but still creates smaller blocky holes,
a horizontal missing strip through the right curl and isolated cheek/eye pixels.
It is an improvement in some regions, not an accepted artifact fix.

The [method](method-and-results.json) records one strict-loaded run with matching
1536 prompt/backbone dimensions, unchanged source and prompts, and the same
candidate selection. Inference took 10.17 seconds. This remains an
out-of-training-resolution experiment.

[Full](full-overlay-ABC.png) and [artifact](artifact-context-overlay-ABC.png)
comparisons use A=1024, B=1536 and C=2048. The [distances](distance-metrics.json)
measure changes rather than accuracy.

An unprimed reviewer inspected full source, all four full representations for
each state, all five hair features plus exact/wider artifact and neck crops, and
all three raw 1536 candidates. Parent inspection agrees on the principal findings:

- B retains more bottom curl than A and more continuously than C, but all miss
  most long dangling strands and retain background in the coarse edge.
- B follows the face curl somewhat better than A, with remaining skin inclusion
  and new isolated selected cheek/eye pixels.
- B reduces C's large interior hole but keeps artificial-looking smaller gaps.
- Flowers remain excluded. No candidate substitution removes the observed
  defects without changing the frozen selection policy.

Complete raw evidence remains at `/private/tmp/openphoto-sam21-1536.3WTrua`.
Do not continue searching input sizes as though a smaller dropout proved stable
segmentation. The next separate hypothesis is whether trained image matting can
repair low-confidence interior prediction while preserving semantic exclusions.
