Compared all 14 lossless diagnostics with the corresponding earlier full and bottom-right captures.

| State | Comparison result | Triage against stated target | Confidence |
|---|---|---|---|
| **01 cropped** | Remains clean. No fringe, seam, or residue appears in the lossless full or crop. | No visible issue | High |
| **02 border A** | The dark magenta glow and softened/rounded corner disappear. The boundary is now hard, square, and consistently red. | Earlier fringe was introduced by the preview path | High |
| **03 orientation tail** | The rotated edge still meets the viewport at the opposing limits, but the apparent bowing and broad fuzzy fringe disappear. A narrow stair-stepped/antialiased diagonal remains. | Viewport contact is consistent with the specified inscribed viewport; not a clipping defect. Remaining single-edge rasterization is minor | High |
| **04 restored A** | Same improvement as state 02. Lossless state 04 is byte-for-byte identical to lossless state 02 in both full and crop. | Restoration remains stable; preview fringe disappears | High |
| **05 border B** | The red lower-right wedge remains clearly present. Its boundary is much sharper; the surrounding purple/magenta bleed largely disappears. | Consistent with the target that B retains prior A pixels inside the captured interior | High |
| **06 A disabled** | The black lower-right wedge remains, with a crisp diagonal and only minor raster stepping. The prior soft dark halo disappears. | Consistent with the target that unsupported captured interior becomes black rather than being refilled with B | High |
| **07 both disabled** | Remains clean and content-only, with no red, blue, or black residue. | No visible issue | High |

Revised findings:

- **Disappears:** broad magenta/purple boundary glow around A, B, and the rotated edge.
- **Disappears:** visibly softened or rounded border-A corner.
- **Disappears:** apparent curvature/bowing of the orientation tail; the lossless boundary reads as a straight rasterized diagonal.
- **Remains:** orientation geometry touching the viewport limits, but this matches the specified inscribed-viewport behavior.
- **Remains:** red A wedge inside state 05’s captured interior, matching the stated stacking target.
- **Remains:** unsupported black wedge after disabling A in state 06, matching the stated non-refill target.
- **Remains:** very narrow stair-step/antialias pixels on diagonal boundaries. These are substantially smaller and sharper than the earlier preview fringes.

No unexplained high-confidence visual defect remains in the lossless set. The conspicuous red and black wedges remain visible, but the supplied product rules classify them as expected output.

Evidence limits: the lossless images demonstrate that the large fringes are path-dependent, but they do not by themselves prove which path is correct. Both sets are opaque RGB captures, so alpha, off-viewport pixels, and intermediate layer contents remain unobservable. Only bottom-right 3× crops were supplied for this diagnostic set; other boundaries were compared through the full images rather than equivalent magnified crops.