# Deterministic canvas core

This is a geometry/compositing checkpoint, not full 12f2 acceptance or photographic generation
quality. The complete evidence set contains seven public native-show states, two 3× nearest-neighbor
edge crops per state, and seven lossless display-converted canonical rasters with bottom-right3×
crops. Synthetic red/blue borders make ownership visible; the asymmetric gradient does not assess
texture preservation or photographic seam quality.

## Target and comparability

An expanded border must preserve the captured interior. Later orientation changes replace an
inscribed viewport rather than accumulating shrink. A later border retains earlier generated pixels
inside its captured interior; disabling their supporting border leaves a black hole, not freshly
revealed original pixels or a blue refill. Disabling all borders restores current absolute develop
geometry on the original.

All states use the same 1000×800 source and production graph publication followed by public show.
The first crop is `[100,200,400,200]`, rotate 90, straighten 10: 135×382. A adds 20 per edge: 175×422.
Straighten 5 replaces that viewport with 139×411; restoring 10 returns exactly to 175×422.
The later crop `[180,230,200,120]`, rotate 180, straighten 5 is 191×103; B adds 10: 211×123.
Its lower-right interior includes a narrow part of A. Disabling A preserves B's dimensions and
changes that part to black. Disabling B as well restores the 191×103 original-based crop.

Preview captures decode the actual public JPEG, without hiding compression artifacts. Lossless
diagnostics use the existing display conversion of the exact evaluated canonical artifact, encoded
as PNG, and are explicitly not replacements for those public preview captures. Top-left crops
start at 0,0; bottom-right crops end at the full raster boundary. Each crop covers up to 90×100
source pixels and is enlarged 3× without smoothing. Full images retain context.

## Comparison and fresh critique

The A/restored-A public PNGs and corresponding crops are byte-identical. Their full-frame grayscale
MAE and RMSE are 0. B versus A-disabled has MAE 0.7152, RMSE 7.6372, 5.4945% nonidentical grayscale
pixels and 0.7860% above delta 16; this locates the lower-right change, not a quality score.
Public A versus lossless A has MAE 0.8672 and RMSE 3.5439, isolating preview-path differences.
Per-state dimensions, hashes, channel statistics, entropy, frames and warnings are in `metrics.json`.
The low-detail gradient and dominant synthetic borders are deliberate content limitations, not
evidence of general visual quality. Distance across differently sized states is not meaningful.

The initial unprimed review inspected every one of the 21 public captures/crops and flagged the retained red
wedge, exposed black wedge, tight orientation crop, and 1–2-pixel boundary halos. All 14 supplemental
lossless images were then reviewed to distinguish stored pixels from preview artifacts. The complete
initial and supplemental verdicts are retained in `critique.md` and `lossless-critique.md`.

Triage: the red wedge is A's retained content in B's interior; the black wedge is its explicitly
unsupported replacement after A is disabled. The tight crop is the required inscribed viewport.
The broad magenta halos and apparent corner rounding disappear in lossless output; ordinary
diagonal raster stepping remains. The independent reviewer found no unexplained high-confidence
defect in that lossless set. No preview codec change is made by this geometry pass.

The five relevant public full captures were opened together in one Preview window for nonblocking
review, then Preview was closed on unattended continuation. Acceptance is limited to this
deterministic core. Full restriction activation, geometry undo, SAM, offline/purchased density,
native exterior detail, duplicate/reorder/rotated-support coverage and the complete journey remain
in the owning outpaint plan.
