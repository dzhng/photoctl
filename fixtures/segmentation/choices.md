# Collection choices

## Keep scene identity separate from render variants

When: collection pass, 2026-09-09.

The choice: group the DxO portrait and A7C II landscape as two photographed
scenes. A crop, a different render of the same RAW, or a duplicated-portrait
instance diagnostic does not increase scene coverage. The camera scene pool
suggests future targets without inventing expected masks or evaluated status.

The gap: the existing research contained many named outputs and derived images,
which could be mistaken for independent evaluation examples.

The reach: later runs can add results to the same scene without overstating
diversity. Verdict: sound; source inventory established two distinct scenes.
Confidence: high.

## Preserve exact evaluated sources and compact result records

When: collection pass, 2026-09-09.

The choice: retain the exact developed landscape PNG even though its RAW is
already present. Re-rendering that RAW or using its embedded JPEG can change
pixels and invalidate a mask comparison. Retain existing alpha16 outputs and
the complete small review set; do not copy large f32 TIFFs, model features or
scratch libraries. Hashes keep omitted canonical mask identities explicit.

The gap: durable review needs the evaluated pixels, while an unrestricted copy
of experiment directories would bring gigabytes unrelated to viewing the result.

The reach: sources and observations remain viewable offline. Alpha16 is openly
quantized and is not offered as a lossless replay substitute. Verdict: sound;
the requested sources and results remain durable without duplicating large intermediates.
Confidence: high.

## Separate visual targets from observed model outputs

When: collection pass, 2026-09-09.

The choice: the PhotoLab screenshot and video overlay are labeled visual targets;
ZIM alpha and native composites are labeled observed results. Someone revisiting
the portrait can compare membership and visible strands, but cannot infer the
unavailable original alpha from the green overlay or treat the preferred model
output as an ideal mask.

The gap: "ideal outputs" could otherwise conflate a user's desired appearance
with a measured ground-truth mask. No such alpha was supplied.

The reach: future evaluations inherit honest evidence labels and retain source
rights restrictions. Verdict: sound. Confidence: high.
