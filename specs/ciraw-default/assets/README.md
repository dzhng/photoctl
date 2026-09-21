# Production rendering evidence

The target is the selected neutral CIRAW reconstruction rendering, preserving
usable bright-region separation without adding a development preset or highlight
compression. Camera JPEG matching is not the quality criterion.

The before and after directories contain default `show` previews and JPEG exports
from the same two RAW originals in the [camera fixtures](../../../fixtures/camera/highlights/README.md).
Exports use quality 95 and a 1752-pixel long edge; previews use the default view.
Each capture used a fresh isolated library, linked RAW-only imports, and the
public command dispatcher. Receipts in each directory record source treatment,
dimensions, render identities, and command results. The before capture used the
prior default preview and LibRaw export paths; the after capture uses CIRAW.

[Pixel measurements](comparison/metrics.json) confirm every output changed.
Before images are resized to the corresponding after dimensions for comparison;
this matters because the embedded preview's aspect ratio differs slightly from
the RAW crop. The measurements locate differences, not photographic correctness.
The comparison directory retains enlarged highlight crops for all four pairs.

An independent unprimed reviewer inspected all eight full images and eight crops.
After previews resemble their exports more closely, with better bright-foliage
and pale-wall separation. Shadows are darker than the camera previews; the
brightest sky gaps remain white. Export differences are modest, with slightly
greener foliage. Orientation, framing and visible fine detail remain intact;
no new blocking artifact was found. This is acceptance for these two scenes,
not a claim that all clipped highlights can be recovered.

A fresh capture after rebuilding the native addon produced byte-identical output
for all four reviewed JPEGs. [Rebuild hashes](rebuild-verification.json) identify
the tested binaries and outputs.

The final release addon and packaged helper also reproduce every reviewed JPEG
byte-for-byte. [Release hashes](release-verification.json) record that check;
the after directory retains the final release command receipts.
