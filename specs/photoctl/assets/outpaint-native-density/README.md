# Native border density witness

The visual target is an exterior ring whose physical placement is independent of its RGB sampling.
Purchased one-pixel detail must survive enlargement; the ring must not replace the live photographic
interior. Scaling the ring can leave uncovered black between the unchanged source and moved exterior.
These synthetic pixels verify ownership and sampling, not photographic completion quality.

## Evidence

The public export tracer creates a 44×34 border around a 40×30 source, then scales it to 88×68.
Its fake upscaler returns alternating 16/240 columns. The candidate retains adjacent-column contrast
224. A temporary falsification resampled those paid pixels back to 44×34 before placement: output
dimensions and paid execution still succeeded, but stripe contrast became 0 and the pixel test
failed by 165 levels against its tolerance of 2. The mutation was removed and the test passed.
[Metrics](metrics.json) compare the identical 88×68 views, not different capture sizes.

The complete captured lifecycle is retained under `candidate`: enlarged, shrink/re-enlarge,
exposure-edited, half-opacity, removed, and undone. Full PNGs and nearest-neighbor 4× views are
included. Shrink/re-enlarge and undo are byte-identical to their respective prior states; removal
restores 40×30. Exposure changes the live interior without replaying paid generation. The separate
camera JPEG refresh regression decodes DSC08819.JPG before a bounded crop and fixed-frame refresh.

## Visual critique boundary

No fresh agent slot was available, so screenshot-critique's adversarial fallback was used:

- **Detail:** The stripe pattern could be aliasing rather than retained detail. At native view and
  4×, the candidate has alternating columns absent in the degraded image; the 224/0 measured
  contrast corroborates the visible distinction. Candidate is less wrong for the stated target.
- **Interior:** The large black area could hide lost source pixels. The central blue rectangle stays
  at its original size and changes with exposure; black is the uncovered gap left by moving the
  exterior ring, not a substitute historical interior. No photographic seam quality is claimed.
- **Opacity:** The dim border could have been deleted rather than made translucent. Its placement
  and extent remain visible while the center retains its edited color. Removal alone shrinks the
  frame, and undo restores the prior pixels.
- **Edges:** Soft inner edge samples are visible at 4×. They are existing projected mask coverage;
  acceptance here is native RGB density and physical support, not a claim of perfect edge filtering.

The workbench report embeds separate native input/content/mask panels and explicitly says they are
not aligned crops. Tests decode all four PNGs and verify their native dimensions and unchanged paid
call counts. Browser policy blocked opening its local HTML; report layout is **not visually verified**.
The skill's generic metric helper lacked `pngjs`, so a temporary Sharp comparison measured the exact
stripe region and per-channel differences instead. No metric dependency was added to the product.

Full-resolution resource acceptance and the complete packaged lifecycle remain separate gates.

## Independent review

Review `01a074a3-cd14-7922-aab8-ff5b475b5008` raised two findings. The alleged double transform
was dismissed: `evaluateNode` explicitly passes `transform@2` artifacts through unchanged; the
frame alone owns physical placement. The one-pixel native-detail export also distinguishes a second
pixel transform from the intended placement. Do not remove that raster-preserving invariant.

The refresh-density finding was reproduced: after a failed enlargement, refresh replayed a stored
2× upscale and returned 44×34 for an 88×68 placement. Refresh now chooses its operation through the
shared density planner, stores the executed scale, and reports the real placement verdict. The
regression also changes generation's intrinsic size and checks that refresh chooses the appropriate
new factor instead of blindly retaining the prior one. Explicit upscale refresh still reruns its
existing step if the newly generated image already covers placement; it is not an implicit retry.

The focused sweep passed 65 tests across nine command/render/workbench files, including the real
camera refresh witness. The review correction then passed all 13 tests in the native-density and
ordinary-fill refresh files. TypeScript build, scoped formatting and diff checks passed. No native
code, root closeout gate or live paid provider call was run in this checkpoint.
Focused follow-up review `01a074ac-895a-7582-9b89-8267b16d7f47` returned no actionable findings.
