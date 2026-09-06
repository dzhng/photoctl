# Integrated reconstruction across saved references

This is the breadth witness for ordinary RAW rendering: every permanent camera RAW
is imported as a RAW-led pair, rendered at native size and exported through the
default public CLI. Camera JPEGs supply scene context, not target RAW pixels or
evidence of reconstruction's causal effect. The separate gold comparison owns the
same-RAW previous/current delivery judgment.

## Captured contract

[Command and capture evidence](evidence.json) records the built CLI/native/helper
hashes, public envelopes, selected original IDs, actual treatment, delivery hashes,
source-manifest snapshots, crop coordinates and every PNG's checksum.
[Verification](verification.json) owns the measured format/crop/orientation groups
and explicit assertion results.

The run used the root's actual built runtime at source commit
`dbe550a77eed97775bb41ee403a69819d3684031`, with the integrated B TypeScript/helper
and the unchanged A native addon. Its isolated evidence worktree began at `8ba2f68`.
No runtime was rebuilt for this pass. A fresh scratch library linked the permanent
fixture directory. Native `show` forced actual RAW rendering rather than the cheap
embedded-JPEG overview; default native JPEG export followed without a preset or
other develop edit. Commands ran sequentially, with one CLI process at a time.

All 18 exports succeeded. Public inspection and export agree on each RAW original
and render identity, and every logical photo retains both originals. Seventeen
native renders report requested `reconstruct`, actual `applied`, decoder
`libraw`/`0.22.2-Release`, method `libraw-spatial-float-v1`, scale 1. The reduced
complete-RGB DSC00103 reports `unsupported`, null method, and still renders its RAW.
Unsupported is not misreported as applied, and no JPEG substitutes for that RAW.
All 36 original files match their permanent manifests before and after the run.

The saved set exercises 13 measured combinations of RAW storage, default crop and
orientation. This is coverage of the retained references, not a fresh inventory of
the disconnected physical card. Full native JPEG deliveries and native show paths
remain at the scratch locations recorded in the evidence.

## Image evidence and direct findings

The complete capture set contains 36 full-frame overviews/context images and 50
native detail crops. Full frames fit within 1000 pixels. Native crops are lossless
PNG encodings of decoded delivery/JPEG samples without resizing; the reduced
DSC00103 RAW and larger camera JPEG use proportionally scaled coordinate boxes.
The crop inventory names the inspected skin, fabric, lights, sky and fine edges.
Every capture was inspected directly, full frames first and native details second.

- All scenes are upright and recognizable, with matching left/right landmarks and
  framing between RAW and camera context. No broad alternating-column striping is
  visible; the reduced label retains coherent characters and surface noise.
- The candle, alley lamp and rooftop light cluster have neutral, textureless white
  cores. The orange panel retains its orange color and repeating fine pattern;
  warm bokeh remains yellow/orange. These images do not claim restored texture
  inside clipped lights or establish their original spectra.
- Thin colored boundaries remain visible: pink points along the bridge railing,
  blue along the aquarium lamp, and yellow/cool edging around the alley lamp.
  Branches against sky and street wires/sign edges show cyan/magenta fringing in
  RAW detail. The camera context also has some colored boundaries, with different
  exposure and processing. This pass cannot attribute those differences to
  reconstruction or dismiss them as optical.
- Skin, eyelashes, hair, lace, elephant wrinkles and distant rock structure remain
  recognizable. RAW native views are generally darker, softer and noisier than
  camera context; fine colored speckle is visible on the coastal portrait's bright
  nose/hair detail. The smooth dress crop has little visible texture in either
  rendition. None of these differences is by itself a causal regression finding.
- Sunset and mountain-sky crops show smooth tonal transitions without conspicuous
  banding. Restaurant-window and street-sky highlights remain largely white and
  lose detail. Shallow-focus glass/bokeh and blurred foreground elements remain
  blurred; reconstruction is not a focus or texture restoration operation.

Comparison telemetry uses matched 96 × 96 grayscale overview reductions. Its
per-scene luminance and mean absolute differences locate exposure/processing
differences; the camera/RAW distance is not a quality score. Native crops, not those
coarse measurements, support the edge and texture observations above.

## Verdict boundary

The default-path, source-identity, treatment-reporting, saved-format coverage and
original-integrity checks pass. Broad false-magenta light interiors are absent in
the inspected current deliveries. Remaining fine-edge colors and flat highlights
are recorded rather than waived. Root directly inspected all 86 captures and
verified their immutable checksums. Independent PNG-only review
`01a07600-860d-7ab2-9bde-2f08d912d0e9` inspected the same complete set and agreed on
orientation, absence of broad striping, smooth sky gradients and the visible
fine-edge/noise concerns. Its preliminary count was corrected to 86 before its
final report; the manifest contains 36 full views and 50 details.

The reviewer singled out DSC09314's translucent branch contours, colored fine
edges, low-light chroma noise and soft portrait/wildlife detail. Root also sees
the branch contours in the camera context, at different contrast; their origin
is not established by these two renderings. The next bounded comparison holds
the RAW, native scale and display transform fixed and toggles reconstruction
for the branch, coastal-portrait and street-wire regions. This accepts breadth
and source correctness, not complete photographic fidelity, a human image
checkpoint or an attribution of every JPEG/RAW difference to a decoder bug.

The [controlled follow-up](../residual-causal/README.md) now establishes exact
unchanged scene floats in the reported branch, nose and lower-wire regions.
Reconstruction is therefore not their cause in these captures. Root opened the
RAW/camera branch-detail pair in Preview at 09:32:11 UTC on 2026-09-06 and closed
only those two documents at 09:38:06, with no user response. The checkpoint
retains the bounded diagnostic conclusion, not whole-camera acceptance.

There is no disabled/current same-RAW comparison in this folder. Any claim that
reconstruction introduced or exaggerated branch echoes or colored fringes needs
that bounded comparison. This fresh catalog is also not evidence for old-cache
retention, physical-camera disconnect/reconnect, installed-package behavior, G3,
or the final whole-spec gate. Concurrent host work means command timestamps are
not resource/latency benchmark results. No camera access, browser workaround,
Preview opening, original write or product-code change occurred in this pass.
