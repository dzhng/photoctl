# Gold report layout evidence

The report must expose each actual delivered JPEG, preserve complete identities, keep source-kind
and non-acceptance labels prominent, and remain readable without horizontal overflow on a narrow
viewport. This is a report-layout target, not a photographic-quality judgment.

The captures use the ten actual ARW-fixture JPEGs from the clean-prefix packed gold gate. The evidence
folder was copied before test cleanup; presentation was rerendered from the captured command results
with delivery paths relocated to that copy. No second exam or substitute photographs were used.

- [Desktop full page](desktop.png) and [viewport](desktop-frame.png).
- [Mobile full page](mobile.png) and [viewport](mobile-frame.png).
- [Expanded identity card](identity-card.png).
- [Readability-change metrics](visual-parity-diff.json).

Chrome loaded all ten original-resolution images. At the narrow viewport, document width equals
viewport width. Independent visual review identified small metadata and weak field separation;
the candidate enlarges metadata and identity text, separates fields, and stacks narrow-screen links.
The complete image cards, full hashes, and partially filled final grid row remain intentional: hiding
evidence to shorten the page would defeat the report's purpose.

The new report had no prior HTML baseline. Initial single-image telemetry showed opaque, nonempty
captures. The readability iteration changed real pixels: desktop/mobile viewport distance was
0.06278/0.13226, with edge-energy ratios 1.01447/0.99688. Those are distance diagnostics, not quality
scores; capture timestamps also changed. The candidate improves readable metadata without removing
image content. No real-drive provenance or photographic acceptance is claimed.

The final fresh critique found no clipping, overflow, identifier truncation, or image-framing defect.
It noted that mobile context pushes the first filename below the initial viewport and that the footer
wraps. Accepted tradeoffs: classification and the non-acceptance warning come before imagery, and
ordinary text wrapping preserves the complete verification command without horizontal scrolling.
The layout is accepted for fixture evidence; this does not accept the photographs as deliverable.
