# Trained mask guidance improves openings but does not close quality

The full SDMatte portrait replication ran successfully. It is not accepted as a
PhotoLab-quality hair solution. A fresh unprimed reviewer ranks direct ZIM less
wrong overall, with a real local advantage for SDMatte at some curl openings.
Person and landscape holdouts are also complete. They confirm local boundary
improvements but substantial semantic leakage, not a verified generic solution.

## Fixed experiment

The [run report](portrait/report.json) pins the official source/checkpoint,
verified hash, dependencies, exact configuration and scratch CPU patch. The
checkpoint loaded strictly with no missing or unexpected keys. Inference used
the unchanged native SAM 3 hair mask, empty caption, ordinary opaque-object
category, full-frame 1024-square preparation and fractional output restored to
the original frame. There was no manual rescue, parameter search or hard output
threshold. The [raw alpha](portrait/alpha-float32.npy) and
[16-bit output](portrait/alpha16.png) retain the prediction.

The forward pass took 70.45 seconds; the complete process took 82.17 seconds and
peaked at 13.85 GB RSS. These describe this CPU float32 reference run, not a
production latency promise. No model was added to the application.

The [capture report](portrait/review/capture-report.json) owns the identical-source
geometry, complete view set and numerical comparisons. A is native SAM 3 binary,
B is original-point ZIM alpha, C is SDMatte alpha. Full-frame mean absolute alpha
differences are 0.02109 for A–C and 0.01485 for B–C; differences above 0.1 occupy
5.65% and 4.92% of the frame respectively. These locate movement, not accuracy.
Display-RGB black/white composites preserve fractional coverage and apply no
foreground-color decontamination. Geometry and fractional-composite probes passed
red/green checks before the outputs were assessed.

## Review verdict

The parent inspected full SDMatte overlay, black and white views and every
canonical feature comparison. The fresh reviewer inspected every full result,
all feature comparison sheets and individual enlarged alpha crops, without model
names, reports or expected outcomes. Findings agree:

- Crown and right edge: substantially better than the coarse binary mask, but
  ZIM retains more fine fringe. SDMatte opens some large loops more cleanly while
  simplifying intervening strands into smoother contours. Both mattes retain
  pale/yellow boundary contamination.
- Forehead curl: SDMatte follows its open interior more convincingly; ZIM and
  native SAM 3 include visible skin inside the bend. However, SDMatte separately
  selects eyebrow and faint eye-area fragments. A correct local curl does not
  excuse those disconnected non-hair selections.
- Lower wisps: SDMatte faintly restores some distant loops, but strongly
  attenuates the central hanging tuft and adds diffuse coverage between strands.
  ZIM preserves more substantial tuft detail; neither captures the complete
  source structure convincingly.
- Flowers/skin: SDMatte selects a visible isolated skin wedge next to the large
  flower, including an orange petal edge. In the frozen no-hair flower crop,
  466 pixels exceed alpha 0.5 and the maximum is 0.778. Native SAM 3 and ZIM
  exclude this wedge. Fragments also remain at the upper flower boundary.
- Dense hair: neither reviewer found a high-confidence large false interior
  hole. Bright source openings explain several deeper depressions; do not call
  every alpha depression missing hair.
- Image edge: both inspections spotted a faint straight line across the extreme
  bottom of the full matte. Bottom-row maximum alpha is 0.570 and mean is 0.0893.
  This is a suspicious image-edge artifact, not evidence of recovered hair.

The [face comparison](portrait/review/comparison-face-black.png),
[lower-strand comparison](portrait/review/comparison-bottom-black.png) and
[flower exclusion comparison](portrait/review/comparison-flowers-black.png)
make the tradeoffs visible. Missing hair and non-hair leakage are high-confidence;
the exact ranking of translucent strand coverage is less certain without alpha
ground truth. The small, graded PhotoLab overlay establishes qualitative intent,
not a pixel-accurate matte oracle.

Do not promote this candidate or hide its errors with a threshold or blanket
component deletion. Preserve it as evidence that trained mask conditioning can
improve some semantic boundaries but does not guarantee the requested scope.

## Person and landscape holdouts

The [batch report](holdouts/report.json) records one unchanged-config prediction
per target, reusing one strictly loaded model. The complete process took 204.73
seconds, with 19.20 GB peak RSS; individual forwards took 71.86 seconds for person,
64.32 for sky and 54.54 for road. All predictions preserve full-frame geometry and
fractional alpha. The [capture report](holdouts/visuals/capture-report.json) owns
the complete views, canonical crops, clothing and distant-path supplements, and
difference telemetry.

A second fresh reviewer assessed the entire holdout set without model identities,
then reviewed all supplementary distant-path views before closing the verdict.
The parent inspected full target overlays, clothing/lower-hair, foliage, wires,
pavement and distant-path comparisons. Findings agree on the important tradeoff:

- **Person:** SDMatte (Q) preserves more distinct lower hair loops than native
  SAM 3 (P) and the Apple accurate-person comparator (R), while leaving translucent
  backing haze and faint petal ghosts. The principal visible human regions remain
  selected. The large white fabric area left of the forearm is absent in all
  three; the reviewers interpret it as missing clothing, although exact ownership
  of that partly occluded fabric lacks a labeled reference. P also drops a thin
  bottom strip and has a slit in the clothing to the right of the forearm.
- **Scope caveat:** R includes the bouquet. That conflicts with this diagnostic's
  visible-human-only target, but could be appropriate for an explicitly broader
  person-with-held-objects request. Do not turn that target-dependent judgment
  into a claim that the Apple result is universally wrong.
- **Sky:** SDMatte (T) follows individual tree peaks better than the rounded
  native mask (S). Both miss internal sky holes. T retains thin wires and leaks
  onto poles, crossbars and fence lines below the horizon; S excludes poles but
  breaks wire exclusions into oversized dashes. T wins narrowly on coverage,
  not on clean isolation. S also has erroneous strips at image edges where the
  source shows uninterrupted sky.
- **Road:** SDMatte (V) restores real distant pavement and more of the near bend
  than native SAM 3 (U), but selects unrelated field fence strands and posts,
  with green/brown verge contamination. The distant-path supplement confirms
  that this diagonal line is a fence, not pavement. U is less wrong overall
  for isolation despite its missing road coverage.

See [person scope](holdouts/visuals/person-full-overlay.png),
[sky wire retention](holdouts/visuals/sky-wires-black.png), and
[road/fence separation](holdouts/visuals/road-far-path-supplement-black.png).
These are observed failures, not assertions about an untested resolution or
alternate checkpoint. No candidate is accepted for production and no production
closeout gate was run for this research-only pass.
