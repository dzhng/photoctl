# Square geometry diagnostic

## Verdict: both mappings fail detailed edges

This is a one-variable diagnostic, not a production change or a replacement baseline. The target
remains clear sky through real foliage/wire boundaries and continuous pavement without adjacent
grass or gravel. Centered letterboxing is still the production contract.

The same canonical source, develop `{}`, display-float conversion, native bilinear resampler,
normalization, pinned models, positive prompts, and strict-positive native logit projection are used
as in the parent capture. Only the aspect mapping changes: the photographic frame is resized to
1024×1024, and each point/projection axis scales independently. An identity resample used by the
existing normalization entry point was checked sample-for-sample. This does **not** reproduce
upstream TorchVision's RGB8 conversion and antialiased resize; that is a separate reference check.
`square-probe.json` pins the input hash, prompts, sample-range measurements, and changed pixels.

Sky changes at 194,247 full-resolution pixels and path at 32,381; both coarse area bands and click
checks still pass. `metrics.json` locates changed coverage in the unchanged detail crop bounds.
Numbers establish that this is a real comparison, not that either mask is good.

A fresh image-only reviewer inspected every matching context, coverage, and overlay capture,
interleaved under neutral A/B labels. Source contexts are identical. The reviewer judged:

- Foliage: letterbox is less wrong, medium confidence; square adds blockier contour steps.
  Both leave a broad band of real sky unselected around tree crowns.
- Wires: square is less wrong, high confidence; excluded corridors narrow somewhat, but remain
  much wider than the actual wires and merge clear sky into the tree/pole exclusion.
- Path: square is less wrong, high confidence; it follows more of the bend and excludes more
  gravel, but remains coarse with a detached distant patch and non-pavement coverage.

Direct inspection agrees that neither meets the target. An overall improvement on two subjects
does not justify silently replacing an explicit preprocessing contract or calling edge quality fixed.

## Capture completeness

All changed captures are retained here: full coverage/overlay for both subjects and coverage/overlay
for each of the three detail regions. The four unchanged context captures are byte-identical to
the parent directory's `context.png`, `sky-foliage-context.png`, `sky-wires-context.png`, and
`road-path-context.png`; those files are shared rather than stored twice. The full original
letterbox capture set remains in the parent directory. Cyan fill and nearest-neighbor 2× detail
presentation are unchanged; neither mask has refinement, erosion, or a tuned threshold.
