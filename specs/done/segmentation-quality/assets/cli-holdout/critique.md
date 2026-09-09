# Actual CLI photographic holdouts: fine-detail gate fails

Target: selecting sky includes visible sky and small foliage gaps, but excludes
wires, poles and vegetation. Selecting the paved path retains its visible extent
and excludes foreground fence posts, rope and surrounding grass.

The exact authored point prompts ran through the built CLI, native ZIM and the
persisted fractional mask store. All four decoder candidates were captured
unchanged; score argmax selected candidate 3 for both images. The source for
every overlay is the pre-segmentation CLI PNG export, not the differently graded
embedded JPEG used by earlier research. Those earlier images cannot support a
pixel-parity claim. No gateway call, manual correction or candidate substitution
was used.

| Selection | CLI duration | Alpha-sum area | Interior alpha | Exterior alpha |
| --- | ---: | ---: | ---: | --- |
| Sky | 18.285 s | 32.8266% | 0.99999994 | 0.00003059, 0.000000096 |
| Road | 15.946 s | 5.05445% | 1 | 0.00000000027, 0.0000000042 |

Both masks satisfy the original coarse area bands and confident interior/exterior
probes. Neither result demonstrates the required fine-detail quality.

## Independent visual findings

A fresh reviewer inspected all 24 source/alpha/overlay review PNGs across both
overviews and the wire, foliage and path crops. The main reviewer independently
inspected the corresponding full views and feature crops and agrees with the
high-confidence findings:

- Most overhead wires remain selected as sky, despite their strong visibility
  in the source crop.
- Foliage boundaries become thick, smooth silhouettes. Fine branch structure
  is lost, cyan spills over sparse branches, and many small sky gaps are omitted.
- The bright face of the large pole leaks into the sky selection.
- Road selection includes fence posts and rope where they cross the asphalt.
- Road edges are simplified and feathered into portions of adjacent grass.

The reviewer additionally identified a possible premature fade at the distant
road endpoint, medium confidence in the overview. The existing path crop does
not cover that endpoint; do not elevate this to a separately verified finding.

Verdict: sensible broad selection, failed generic fine-detail acceptance. The
portrait engineering checkpoint remains useful, but does not close this gate.
The next automatic-text evidence still requires the configured gateway key;
neither mock grounding nor hand-selected local crops can substitute for it.

## Evidence identity

The complete retained capture is at `/tmp/openphoto-zim-cli-holdout.62UaeP`:
scratch library, result/stderr JSON, source, mask TIFF/f32, alpha16, full overlays,
all 24 review images, encoder input, prompt/attention tensors, all raw candidate
logits/scores and capture scripts. `report.json` owns exact file/model hashes
and `scene-metrics.json` owns single-image content telemetry. Scene metrics help
locate content; low entropy in a mostly black mask is not itself a defect.

Both frames are 7008×4672. The CLI source PNG SHA-256 is
`2f2a76b2868823ee668d9601bf546194ff950c54c72d1f19f6b06ab8e78e8839`.
The built-file hashes in the report identify the capture, independently of
concurrent documentation-only commits on the shared branch.
