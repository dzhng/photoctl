# Independent comparison with direct ZIM

The unprimed reviewer inspected every full alpha, overlay, black/white composite
and all five feature crops. A is direct ZIM, B is SAM2Matting with frozen points,
C is SAM2Matting with the fixed binary ZIM seed.

**Overall: A, then C, then B. None is accepted as a detailed hair-only matte.**

- Top: A preserves more fine crown mesh; C keeps prominent loops but trims wisps;
  B deletes prominent outer loops.
- Right: A retains the projecting curl and more strands. C cuts the terminal
  segment; B contracts the contour substantially.
- Face: C improves the terminal curl split over A. Both retain a gray bridge over
  exposed skin inside the curl. B removes almost the entire lower hanging curl.
- Bottom: A retains most tuft structure; C leaves a shorter fragment; B almost
  removes it. All miss the longest isolated strands toward the shoulder.
- Flowers: the supplied crop is excluded by all three. B additionally removes
  real hair beside an upper flower in the full image.

Confidence is high for the missing hair and included skin identified through
source/alpha correspondence. Composite color contamination alone was not counted
as an alpha defect. The illustrative reference does not supply fractional-alpha
ground truth; it cannot certify exact skin gaps or transparency.
