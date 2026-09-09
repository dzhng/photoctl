# Developed-source CLI evaluation

Recorded on 2026-09-09 from the built CLI capture identified by the
[case manifest](manifest.json). The parent review inspected the full images and
feature crops and agreed with a fresh reviewer who inspected all 24 retained
source/alpha/overlay [review PNGs](review/). This collection preserves that verdict;
copying the images is not a new model run or visual assessment.

Sky selection should include visible sky and small foliage gaps, excluding wires,
poles and vegetation. Paved-path selection should retain its visible extent while
excluding foreground fence posts, rope and surrounding grass. The
[capture report](metadata/capture-report.json) establishes exact source, prompts,
model scores and result identity. Score argmax selected candidate 3 of four in
both runs. No gateway call, manual correction or visual candidate substitution
was used.

Both results satisfy their original coarse area bands and confident
interior/exterior sample checks. They do not satisfy fine-detail acceptance.

## High-confidence observations

- Most overhead wires remain selected as sky despite being clearly visible in
  the [wire source](review/sky-wires-source-2x.png) and
  [overlay](review/sky-wires-overlay-2x.png).
- Foliage becomes thick, smooth silhouettes. Fine branches are lost, cyan spills
  over sparse branches, and small sky gaps are omitted in the
  [foliage crop](review/sky-foliage-overlay-2x.png).
- The bright face of the large pole leaks into the sky selection.
- Fence posts and rope crossing the asphalt remain in the path mask, and its
  boundaries feather into adjacent grass in the
  [path crop](review/road-path-overlay-2x.png).

The fresh reviewer also noted possible premature fading at the distant path
endpoint, with medium confidence in the overview. The retained path crop does
not cover that endpoint, so it is not a separately verified finding.

Verdict: sensible broad selection, failed fine-detail acceptance. No ideal alpha
is available to turn the visual judgment into ground-truth pixel scores. The
[presentation measurements](metadata/scene-metrics.json) help locate structure;
low entropy in a mostly black mask is not itself a defect. Earlier embedded-JPEG
research used different pixels and does not establish parity with this capture.
