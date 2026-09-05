# Photographic SAM evidence

## Verdict: coarse subject checks pass; edge quality is not accepted

The target is clear sky up to the actual tree and wire boundaries, and the continuous paved
path without adjacent grass or gravel. The committed fixture's bands were authored from the
source image before model results were inspected: an independent image-only reviewer estimated
sky at 28–38% and path at 4–9%. These broad area checks cannot certify fine boundaries.

`test/macos/segment-at.test.ts` runs the built CLI against the actual ARW and hash-pinned models,
then reads the published masks. Both probes passed together in 48.19 seconds on 2026-09-06;
click inclusion, excluded grass/sky points, and zero gateway calls also passed. Run it with
`PHOTOCTL_SAM_MODELS_DIR` pointing to the exported model directory. Missing models fail rather
than skip. This is a host integration test, not the full release gate.
The production-route falsification forced returned coverage to one: the test failed at 100%
against the unchanged 38% sky maximum. Restoring the built runtime returned both probes to green
in 50.31 seconds. Manifest preservation separately failed when annotation carry-forward was absent
and when its same-image hash guard was removed; both generator tests pass with the guard restored.

## What the captures show

`context.png` is the cached full-resolution current-develop image at review size. Sky and road
overviews share that context. Cyan fill marks selected pixels at 40% opacity; it is not a
proposed color edit. Coverage images preserve the published binary selection, white for selected.
Detail crops are nearest-neighbor 2× views of the coordinates in `capture.json`; no mask
refinement, erosion, or favorable re-thresholding was applied. The complete capture set is retained.

The production `wb masks` panels are `0.png`–`2.png` for sky and `3.png`–`5.png` for road, in
context/coverage/contour order. Their scan-order anchor is a poor quality checkpoint here:
the sky panel mostly shows blank sky near the image border, not foliage. The additional labeled
crops expose the relevant edges instead of treating the default panel as acceptance evidence.

Adversarial visual review (fresh-agent spawn hit the thread limit; a fresh image-only Codex
review subsequently inspected the complete set and independently confirmed all four findings):

- **Foliage:** the strongest failure case is the broad unselected blue band between the cyan
  sky and the actual branches, visible in both overview and detail. A sky adjustment would
  leave an obvious halo; verdict: failed, high confidence.
- **Wires:** the exclusion is much wider than the thin wire itself and leaves irregular islands
  of selected sky between broad unselected bands. This is not a usable wire boundary;
  verdict: failed, high confidence.
- **Road:** the near curve is mostly selected, but coverage terminates across intact pavement
  at the distant bend and resumes in disconnected patches. The requested continuous path is
  incomplete despite passing its coarse area band; verdict: failed, high confidence.
- **Workbench framing:** a nearly uniform sky crop cannot expose the treeline defect.
  `metrics.json` records the coverage and color distribution of every capture; these numbers
  diagnose framing, not segmentation correctness. Verdict: insufficient for this checkpoint.

The comparison skill's bundled helper could not load its optional `pngjs` dependency. Metrics
were instead measured from the PNGs using the repository's existing Sharp dependency; their
method is recorded in the JSON. No new project dependency was introduced.

The code review flagged missing model provisioning in the default macOS suite. Moving this test
to an optional suite would weaken the spec's explicit missing-weights-must-fail gate, so that
recommendation was not adopted. The model-directory prerequisite is documented in the fixture hub;
clean-checkout provisioning/public hosting and Docker model-stage integration remain release work.
The existing Docker functional stage does not yet consume its separate model-fetch stage.

## Photographic reference parity

`photo-reference.json` compares the actual normalized photographic tensor and mapped positive
prompts through the pinned PyTorch CPU encoder/decoder and production ONNX runtime. Replaying
the captured production inputs reproduces both published masks exactly. With the unchanged
export tolerance (0.005 absolute plus 0.0001 relative), neither photographic probe has a logit
mismatch; maximum absolute errors are below 0.000106. Projecting PyTorch logits through the
production full-resolution mapping differs at only two sky pixels and zero road pixels out of
32,741,376. The ready model identities and source are the ones recorded below; the JSON pins
the actual input tensor hash. Scratch tensors are not release artifacts.

This rules out substantial ONNX numerical drift for these inputs, not inappropriate input
preprocessing or insufficient model quality. The pinned upstream SAM2 transforms resize directly
to a square, whereas this spec prescribes centered letterboxing. Next: a controlled photographic
comparison of those coordinate/preprocessing contracts before changing the explicit letterbox
decision. Do not weaken the edge target or claim the coarse test proves it.

## Identity and resource boundaries

The capture uses the ready model hashes in `fixtures/models.json`, develop `{}`, and the fixture's
7008×4672 oriented frame. The source artifact and crop coordinates are in `capture.json`.
Published masks from real CLI calls:

| Subject | Selected pixels | Mask artifact |
|---|---:|---|
| Sky | 10,158,306 | `a_cc54532b813dc8ac19ca6f7f978219c45f1d3d724a835fb5d85db76b5cf0ca45` |
| Road | 1,599,827 | `a_8999e4476ec21a1308f4a122e6dc4578d451e9fb3a2d7d119e296ec0e139b162` |

Whole-command `/usr/bin/time -l` measurements were 24.03 s / 2,690,809,856 B max RSS for sky,
and 25.21 s / 3,056,254,976 B for road. macOS also reported peak memory footprints of
3,977,001,360 B and 3,967,105,112 B respectively; footprint is not the RSS metric specified by G6.
The road run violates the unchanged 3 GB RSS gate. A separate phase-traced CLI reproduction
peaked at 3,119,792,128 B before inference, during full-resolution color conversion.
The [native inference probe](../sam-runtime/README.md) passing its narrower band does not close
this whole-command failure. Resource fixes must preserve the same output and be remeasured.
