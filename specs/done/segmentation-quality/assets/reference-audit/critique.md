# Acceptance is comparable PhotoLab selection, not an ideal cutout

Direct ZIM is visually comparable to the supplied PhotoLab screenshot at its
actual viewport. An unprimed comparison against that reference supports this
narrow acceptance; earlier blanket statements that every measured candidate was
below the shown reference were too strong. This does not establish full-feature
alpha equivalence, generic high-resolution quality, or completed implementation.

## Comparable framing and bounded claims

The [capture report](report.json) records feature-based registration between the
unchanged video overlay and supplied screenshot: twelve inliers with a median
registration residual of about 0.26 screenshot pixels. The reference viewport
is cropped vertically by the webpage; full-video crops are supplements, not a
replacement for the user's framing.

The [viewport comparison](comparison-60-user-viewport.png) shows Source, R
(untouched PhotoLab), A (direct ZIM), and B (ZIM-guided MGMatting raw).
All three fixed candidate overlay strengths—40%, 60%, 80%—are retained. None
was fitted to the reference or selected as an optimal score. Grading differs
between video timestamps, and PhotoLab's overlay strength is unknown. Neither
RGB similarity nor subtraction of the two video frames is ground-truth alpha.
Reference cursors/tool markers are not mask errors.

## Independent comparison

A fresh reviewer inspected all twenty-four sheets and individual face/bottom
crops. Its verdict: A meets a reasonable comparable-to-the-shown-reference
standard at the supplied viewport; B has comparable broad hair coverage but
fails facial exclusion because it selects the eyebrow. Main-agent inspection
confirms the visible membership differences.

- Crown and projecting right curls are broadly comparable. The reference itself
  has soft, sometimes filled-looking boundaries; generic edge softness is not
  enough to reject a candidate relative to this reference.
- Direct ZIM and PhotoLab substantially exclude the eyebrow and eye. MGMatting's
  eyebrow selection remains obvious across all display strengths. The new control
  supports a thin eyelid trace, not a claim that it selects the entire eye.
- The exposed skin opening within the forehead curl survives in direct ZIM.
  The reference appears to wash more green into parts of that opening. A broad
  claim that ZIM's skin gaps are worse than PhotoLab is not supported here.
- Both candidates omit the lowest dangling loop that PhotoLab visibly colors
  in the [supplementary bottom crop](comparison-60-bottom.png). ZIM misses more
  surrounding strands than MGMatting. This localized shortfall is mostly outside
  the supplied viewport, but remains documented rather than cropped away.
- No meaningful flower inclusion is visible in either candidate.

The black/white composite critiques remain useful diagnostics of actual model
errors. They cannot establish that PhotoLab has cleaner alpha at those pixels
when only its compressed green overlay is available. Do not silently change the
objective from matching the reference's quality into proving an error-free matte.

## Consequence for the plan

Direct ZIM is a defensible portrait candidate to carry into the implementation
ladder, subject to licensing and further coverage—not a proven generic backend.
The photographic wire/foliage/road failures and crop-guidance experiments remain
relevant independent evidence. Product integration still needs an explicit model
contract, automated input guidance, projection/storage verification and the final
closeout gate. This acceptance audit does not mark the overall goal complete.

[Capture code](capture.py) and [archive manifest](archive-manifest.json) retain the
whole comparison, including the reference's framing and every display strength.
