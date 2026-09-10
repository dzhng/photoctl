# ZIM refinement: independent visual verdict

The unprimed reviewer received the source and reference overlay, all full-frame
states and top/right/face/bottom/flower crops. A is direct ZIM; B is raw ViTMatte;
C applies the known trimap constraints to B. All composites retain original RGB.

**Verdict: A is less wrong overall; reject B and C as refinements.** No state
establishes parity across all regions.

- Face, high confidence: B/C erase two solid lower bends of the hanging curl,
  leaving pale ghosts on white. A retains those bends but includes skin inside
  the loops. C additionally contains an isolated opaque speck.
- Bottom, high confidence: all miss long strands toward the shoulder and retain
  background beneath the dense hair near the neck. B/C reduce some cloudy alpha
  without recovering missing length.
- Right, medium/high confidence: B/C separate some gaps better, but weaken an
  outer curl tip. Broad opaque lobes remain around sparse hair in all states.
- Top, medium/high confidence: B/C open some gaps but fill the isolated circular
  curl more heavily. All have thick soft perimeter regions.
- Flowers, high confidence: excluded cleanly in the supplied crop in every state.

Colored fringes in original-RGB composites alone do not prove an alpha error.
Missing solid hair and included skin/background regions do. Numerical distance
in the run report establishes that the refinement changed output, not that it
improved quality.
