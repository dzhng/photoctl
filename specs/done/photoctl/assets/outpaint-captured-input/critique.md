The result matches the target.

- Input: 12×8 px.
- Expanded output: 14×10 px, exactly accommodating a 1 px border.
- The blue border is complete on all four sides, including all corners.
- Original content is aligned at offset (+1, +1); there is no unintended shift.
- The retained 12×8 interior is byte-for-byte identical to the input. Their 20× enlargements are also identical.
- The left-edge gradient, red ring, inner black rectangle, and other unsupported black regions retain their exact colors and boundaries.
- Content touching the old edges—including the gradient at the left and red at the right—is preserved rather than clipped or overwritten.
- The 20× images show clean nearest-neighbor blocks with no interpolation, seams, or partial-pixel artifacts.

Limit: these fixtures prove preservation of the prior visible raster only. They cannot establish whether any conceptual content existed beyond the original 12×8 canvas.

Confidence: very high.