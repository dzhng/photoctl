# Learned-trimap experiment

This is a feasibility test, not a product selection. The primary implementation is
[MattePro](https://github.com/ChenyiZhang007/MattePro), revision
`5ef19eb06a308ea88321f9bbd939867ced48af20`. Its author-linked checkpoint SHA-256 is
`c1c0a47a8737f5bc540076339d558439c4a22921792d431516bc128358b81e6f`.
The experiment predicts a three-class trimap (definite background, uncertain edge,
definite foreground), then gives that unchanged trimap to the pinned ViTMatte-S.
The measured [initial](mattepro-initial-report.json),
[feedback](mattepro-feedback-report.json), and
[zoom-verified](mattepro-verified-report.json) reports retain model, input and output
identities. The [comparison](mattepro-comparison.json) measures changes between
predicted masks, not accuracy against a ground-truth alpha. The final
[trimap](mattepro-verified-trimap.png) and [alpha](mattepro-verified-alpha.png)
preserve its unresolved errors.

The CPU probe executes the upstream model class unchanged, with source-inspected
constructor settings in place of Detectron2's configuration loader. It preserves
the demo's square RGB resize, normalization, integer click scaling, absent-box
sentinel, LoRA rank override and evaluation mode. LoRA is the checkpoint's learned
small weight adjustment, not a new training step. Output probabilities are resized
before choosing classes, as in the demo. The unused detail-decoder allocation and
training-only imports are omitted; they do not participate in the executed path.

All 1,126 state keys load strictly with safe tensor-only deserialization. This
proves compatible weights, not numerical parity with the complete original demo.
Constructor transcription and newer Torch/PEFT versions remain replication risks.
No model result has been accepted on loading success or point inclusion alone.

## Prompt experiments

The first pass keeps the original automatic five foreground/seven background
points. It selects skin as definite foreground; refinement cannot repair that.
The independent full-frame and five-region crop review rejects its face/neck spill,
stair-stepped skin boundaries, missing wisps and background-contaminated gaps.

One feedback pass shows the VLM only the source and current overlay and permits
sixteen additional foreground/background/uncertain clicks. It reduces face spill
but adds flowers: some newly proposed “hair” coordinates land on flower petals.
The model also ceases to honor an original background click. A zero-error point
check is therefore necessary diagnostic evidence but never a quality verdict.

A separate zoom-verification pass shows the source plus labeled, fixed-center
crops of all proposed points, without their proposed classes. The VLM reclassifies
the same coordinates. This tests grounding separately from selection; no human
corrects or drops individual points. Neither extra calls nor zoom verification are
yet product architecture. They must earn their cost and demonstrate quality on
holdouts before entering the implementation plan.

The zoom-verified result is the least wrong of the three, not accepted. Independent
review rejects its damaged hanging forehead curl, selected cheek strip with a long
straight boundary, missing hair wedge beside the upper flowers and missing outer
wisps. It successfully excludes the bouquet. Original RGB contamination contributes
to colored fringes, so the critique distinguishes that from actual alpha errors.

A final diagnostic marks only neighboring definite foreground/background classes
as uncertain within one model-output cell (seven source pixels here). It changes
9,693 trimap pixels and softens the hard steps, but retains the wrong inner contour.
This is not a product fix: smoothing an incorrect semantic boundary does not make
the selection correct. No larger-radius tuning follows this failed hypothesis.
