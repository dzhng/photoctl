# Captured input after an earlier border moves

The target is exact preservation of the whole visible input when adding the next exterior
border. Moving an earlier border must not make the next expansion reconstruct an older,
smaller viewport and clip already-visible pixels.

These are lossless canonical display conversions after public `show`, not JPEG previews.
The asymmetric original is 16×12. Its crop gets a red border, which moves four pixels right;
the resulting 12×8 input then gets a one-pixel blue border. Native full captures and 20×
nearest-neighbor enlargements keep every boundary visible. The extracted 12×8 interior
has the same PNG hash as the input; the public regression also compares every Float32 row
at the independently known offset, not only image hashes.

The [fresh image-only review](critique.md) inspected all six images. It found the complete
blue exterior aligned at (+1,+1), unchanged gradient/red/black regions, and no clipped old
edge. Local inspection agrees. The comparison was opened in one Preview window and closed
after the non-blocking review interval.

This accepts the deterministic input-preservation witness. The intentionally tiny color
fixture does not establish photographic quality, content outside the prior viewport, or
offline/purchased-density behavior. Black regions already present in the input are retained
unsupported coordinates, not a new rendering defect.
