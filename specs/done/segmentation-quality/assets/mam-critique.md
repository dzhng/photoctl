# Independent MAM critique

An unprimed reviewer inspected every full alpha and overlay (coarse, internal mask,
three decoder scales, and both guidance finals), then the native-feature 2× crops
and black/white composites. The target was hair only; neither output was presumed
correct. The compressed reference is evidence of visible selection intent, not
alpha ground truth.

Both finals fail. Mask guidance excludes the flowers but drops the crown ringlet,
leftward curls, outer-right wisps, bottom curls and lower forehead curl. It retains
a thick skin/background fringe and fills real gaps between curls. Alpha guidance
recovers more strands but selects face, eye, neck and flower petals, with straight
clipping boundaries and translucent background haze. These are high-confidence
defects visible both at full-frame and crop scale.

The reference visibly retains the forehead curl and more outer hair while excluding
face and flowers. It has a clear semantic/detail advantage; its compressed overlay
does not establish perfect compositing or precise strand opacity.
