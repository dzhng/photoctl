# Native concepts work; fine boundaries remain unresolved

The official SAM 3 image path preserves the distinction between hair and person,
but does not establish PhotoLab-quality boundaries. Do not adopt it as a finished
quality solution or silently substitute person segmentation for a hair request.

## Evidence and reproducibility

[Provenance](provenance.json) pins the upstream source, checkpoint hash, runtime,
thresholds, prompts and failed portability probes. This is the official SAM 3
image builder, not the SAM 3.1 multiplex video pipeline. The scratch-only
[portability patch](portability.patch) permits CPU float32 inference without
CUDA/Triton-only paths; it is not an upstream-supported runtime claim. Strict
weight loading succeeded. No production implementation or model publication changed.
The checkpoint is governed by the custom SAM License; redistribution and commercial
adoption require a separate review, not reliance on the package's MIT classifier.

The [capture report](capture-report.json) owns exact source hashes, crop bounds,
all-mask retention and difference telemetry. [All visual states](gallery.html)
include native text instances/unions, every interactive candidate and the
highest-predicted-IoU choice, alongside the earlier SAM 2.1 Large masks.
Confidence images are not alpha mattes. Binary black/white composites expose
background retention without inventing transparency. The photographic source
and PhotoLab illustration are differently graded compressed video frames;
neither pixel accuracy nor alpha ground truth can be claimed from that pairing.

## Independent review and parent inspection

Two fresh, unprimed reviewers inspected the complete hair and landscape/person
capture sets and canonical enlarged crops. The parent additionally inspected
full hair/person/road overlays, top/face/bottom hair comparisons, and sky wire
and foliage crops. Their findings agree on rejection as a fine-boundary solution:

- Native text hair retains the isolated top curl and the prominent forehead
  curl better than the selected interactive result. It has no equivalent of
  the SAM 2.1 2048 rectangular interior dropout. This is a coverage improvement,
  not parity: bright background remains filled inside curls and every candidate
  loses substantial long lower loops. The 2048 result keeps a little more lower
  tuft but adds background speckling. No overall fine-edge winner.
- The interactive highest-IoU result deletes most of the dark S-shaped forehead
  curl. Other interactive candidates are retained: one is severely incomplete,
  another spills into face/body. No visual candidate substitution was made.
- Person includes the face, neck, arm and main clothing while excluding flowers,
  coherent with visible-human scope. It still clips flyaways and fills background
  gaps. The lower-left white clothing beyond the forearm is substantially missed
  in the single-portrait result; the parent confirmed this in the full overlay.
- Sky leaves broad unselected blue bands around treetops and misses internal
  canopy holes. Long upper-wire segments remain selected, interrupted by oversized
  exclusion fragments. Earlier masks exclude more wire continuously, albeit with
  excessive surrounding sky removal. Main terrain remains excluded.
- Road preserves the main foreground curve but misses a narrow outer strip;
  distant pavement fragments and a small vegetation island persist. No decisive
  edge improvement over the earlier 1024 candidate.

Missing curls, hard background pockets and wire errors are high-confidence visible
findings. Ranking translucent edge fidelity remains uncertain without alpha truth.
Apple person output preserves some softer wisps but also has haze and a different
semantic target; it cannot establish a hair-only replacement.

## Instance cardinality diagnostic

The [duplicate-instance report](duplicate-cardinality/report.json) records two
pixel-identical portrait copies side by side. Both native concepts return two
separate masks, each containing exactly one fixed copy point; their unions contain
both points. Points are post-hoc membership checks, not prompts or mask selection
substitutions. The [person overview](duplicate-cardinality/person-overview.png)
shows the per-copy separation. This supports caller-side hit testing and union,
not real-world multi-person quality, empty-match handling or a finished CLI policy.
That run took 15.82 seconds including loading, encoding and saved outputs, with
7.10 GB peak RSS; those measurements belong to this CPU diagnostic only.

## Consequence

Preserve target text through the mask-producing backend seam and keep instance
choice independent of edge quality. Next refinement research must recover real
fine boundaries while preserving semantic exclusions across hair, sky and road.
Neither larger coarse coverage nor a broad confidence-derived unknown region is
evidence of that capability. Keep this baseline fixed as a comparison, not a
parameter-tuning loop or an implementation acceptance gate.
