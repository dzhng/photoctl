# Automatic crop guidance: mixed result, no generic pipeline acceptance

An unprimed reviewer inspected the portrait and photographic source context,
all seven tight crop states, both wider portrait states and their five feature
crops. Each state included source, prior alpha, candidate alpha, overlay and
original-RGB white composite. Candidate selection was score argmax, never manual.

## Tight crops

The same fixed rule samples up to four positives and four negatives from confident
coarse alpha on a regular grid. It selects a central sample then spreads the
remaining samples by distance. No new VLM calls or manual points are used, but the
evaluation crop placement is authored: this is not an automatic whole-image path.
The [report](tight-report.json) owns coordinates, timing and distance metrics.

The reviewer accepts the local [wire](tight-wires-alpha.png) and
[foliage](tight-foliage-alpha.png) results as less wrong than full-image inference.
Wires are excluded continuously; branch tips and sky gaps replace blurred masses.
This local foliage verdict is stronger than the earlier manually prompted crop's
verdict; neither substitutes for full-image acceptance or labelled alpha truth.

All four hair-detail crops regress with high confidence:

- [Top](tight-hair-top-alpha.png): filled curl loops and simplified silhouette.
- [Right](tight-hair-right-alpha.png): clipped corkscrew tip and lost fine strands.
- [Face](tight-hair-face-alpha.png): eyebrow included while hanging curl disappears.
- [Bottom](tight-hair-bottom-alpha.png): fringe contracts to a short blurred stub.

The [flower crop](tight-hair-flowers-alpha.png) has no confident foreground and
retains its existing alpha without inference; clean exclusion is not evidence of
successful refinement.

## Wider portrait context

Holding the grid rule fixed while providing a wider portrait region restores
some top/right structure, but does not beat the original full-image ZIM result.
Reusing only original automatic VLM points within that same region is less wrong
than grid-derived prompts, but also rejected as a replacement. The
[grid report](context-grid-report.json) and
[original-point report](context-original-report.json) retain both experiments;
their [grid alpha](context-grid-alpha16.png) and
[original-point alpha](context-original-alpha16.png) preserve the measured masks.

Both fill the isolated top ring, lose the right corkscrew tip, weaken the face
curl and lose lower fringe. Original points preserve more face/lower hair and
exclude flowers better; the grid state adds a faint flower-shaped selection.
Wider context reduces the tight crop's eyebrow error but leaves a faint smear.

Resolution helps the photographic details, but context and prompt propagation
can damage semantic hair selection. Do not promote this experiment into a
generic tiled architecture or combine region-specific winners by hand.
