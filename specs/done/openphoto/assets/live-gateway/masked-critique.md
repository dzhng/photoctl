# Masked-edit visual review

The target is a bright-green-glass replacement inside the authored central
256×256 square, with everything outside that selection unchanged. The input is
a synthetic red circle on blue, not a camera photograph. Full before/after PNGs
are display conversions of the retained canonical artifacts:
[before](masked-before.png), [after](masked-after.png) and
[coverage](masked-selection.png). Center crops show a 320×320 region at 3×
nearest-neighbor zoom: [before detail](masked-before-detail.png) and
[after detail](masked-after-detail.png). The
[raw provider PNG](masked-provider.png) is unmodified.

A fresh reviewer with no implementation history inspected the full images,
both center crops, coverage, raw provider output, and all JPEG session/replay
captures: [captured result](masked.jpg), [pre-replay result](masked-edited.jpg)
and [replayed result](masked-replayed.jpg). It reported:

- High confidence: the green square aligns with the coverage image; the circle
  outline, position and blue background appear unchanged.
- High confidence: straight edges and square corners make the final replacement
  look pasted, with no bevel or contact shadow. This is visible at full size.
- Low confidence in a specifically glass appearance: the final patch has soft
  diagonal highlights, but no clear thickness, transparency, refraction or edge
  reflection. Glass and glossy plastic cannot be distinguished confidently.
- High confidence: the raw provider image has strong glass/acrylic cues at its
  thick reflective perimeter. Those cues are absent from the retained central
  portion of the final composite.
- Moderate confidence: zoom reveals faint mottling and broad highlights, with
  no severe tearing or obvious repeated texture.
- The three result/replay JPEGs look alike. Visual inspection alone does not
  establish their pixel identity; the recorded hashes establish that separately.

The main inspection agrees. Accept the localized replacement and the separately
measured protection/replay contracts. Do not accept this as proof of convincing
glass or natural photographic integration. No paid retry was made to improve
this synthetic example.
