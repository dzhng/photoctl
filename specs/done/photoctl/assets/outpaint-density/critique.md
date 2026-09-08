# Fresh visual review and disposition

An image-only Codex session (`01a073d3-fb00-7532-8b20-9db3c84a3d9e`) received all twenty
native/zoom images with neutral A/B labels. No code or session history was supplied. It reported:

- A/a versus B/a: reduced sampling loses tonal steps and apparently loses padding asymmetry (high).
- Both b states apparently lose their right black padding (high).
- Both c states rotate clockwise without mirroring, but apparently do not preserve a's framing (high).
- B/a–c have coarser color steps and whole-pixel boundary rounding (high).
- Both d states retain identical clean red borders and centered interiors (high).
- Both e states retain the same localized red mark without halo or surrounding displacement
  (medium); a same-sized unmarked control was not supplied.
- Every enlarged image shows deliberate nearest-neighbor squares, not interpolation blur (high).

The initial verdict was that neither set preserved all framing relationships. That verdict was
investigated rather than accepted or silently discarded. Direct RGB bounds establish:

| Set/state | Full raster | Nonblack x bounds | Nonblack y bounds |
| --- | --- | --- | --- |
| A/a | 24×12 | 4–19 | 0–11 |
| B/a | 12×6 | 2–9 | 0–5 |
| A/b | 25×12 | 3–18 | 0–11 |
| B/b | 13×6 | 2–9 | 0–5 |
| A/c | 12×25 | 0–11 | 3–18 |
| B/c | 6×13 | 0–5 | 2–9 |

Thus a has symmetric padding in both sets, and b has six/three black right columns respectively.
The two claimed padding defects are pixel-reading errors, likely made harder to see by black image
edges against a dark viewing background. State c rotates **b**, not a. In both sets its decoded RGB
bytes are exactly equal to b rotated clockwise, resolving the claimed rotation mismatch without
changing any pixels. The coarser B sampling is real and intended: only an 8×6 original preview was
available. The asymmetric odd crop retains its catalog mapping with nearest-pixel rounding.

Disposition: accept the depicted sampling and placement mechanics. Border and small-marker controls
are byte-identical between sets. The absent unmarked control limits this visual comparison; public
tests independently pin the shrunken-border native dimensions and mapping. This report does not
claim photographic quality, recovered original detail, or full canvas lifecycle acceptance.

The integrated old/new odd crop, corrected quarter-turn and native-border zooms were opened for a
non-blocking review window. With no contrary response after five minutes, the evidence-based
sampling/placement verdict above stands provisionally; the opened Preview window was closed.
