# Mask report evidence

These captures exercise the public `wb masks` report with a committed synthetic contour and a cached synthetic RGB artifact.
They demonstrate report framing, identity disclosure, and overlay readability—not SAM segmentation quality. Real release-weight
hair/foliage acceptance and G6 remain open.

- [Desktop](desktop.png): side-by-side native-size context, fractional coverage, and overlay.
- [Narrow viewport](mobile.png): explicit 390 CSS-pixel viewport; document scroll width is also 390.
- [Detail](detail.png): nearest-neighbor 2× inspection of the same desktop image row.

The unprimed critique identified weak contour contrast and densely wrapped metadata. The final capture uses a labeled
three-pixel cyan contour with a dark halo; the separate coverage panel remains exact. Metadata labels and values have distinct
structure. The final current-capture critique reported no blocking defects and confirmed visible cyan/halo separation, including
the vertical edge. Mobile hashes and stacked panels remain dense but contained. Native-size imagery takes priority over simultaneous mobile comparison.

The final code review caught a provenance-policy error: creation time does not record when `show` last reused an execution.
Selection therefore prefers the highest-resolution available cache for the active develop recipe, with creation time only
breaking equal-area ties. The report explicitly disclaims last-shown source identity and displays source density and dimensions.
The CLI regression creates a newer offline execution, reuses the older online execution, and still selects the higher-detail RGB.

The initial contour correction changed 29.65% of desktop pixels (RGB MAE 13.45); text wrapping also moved the panels, so that
distance establishes a real rendered change, not a quality score. Exact CLI pixel tests independently prove cyan/halo placement,
unchanged coverage, and crop/quarter-turn/reduced-source alignment. Dark page chrome deliberately dominates the frame; visible
detail and full black-to-white contrast, rather than global color entropy, establish useful framing.

The fresh integration critique confirmed contrast, panel alignment, and contained desktop/mobile
layouts. Labels and outer panels are clipped in the enlarged detail crop only; consult the full
captures for that context. The crop is for pixel edges, not a standalone layout capture. Small mask
stair steps remain visible at enlargement, without a displaced or duplicated contour.
