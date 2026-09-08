# G10 closeout — vignette and keyless gold exam

Target: the shipped people preset must traverse every declared develop operator and export without
an unimplemented-key failure. Its modest negative vignette should preserve the center, add no rings
or banding, and leave framing and photographic detail intact.

The keyless fixture exam imported and rated ten distinct gradient JPEGs, applied `--preset people`
to the first three, and exported all ten through the production script. Each edited JPEG's highlight
p98 was lower than its matching neutral source. Native tests separately prove that vignette is
deterministic across in-memory and canonical-TIFF paths, preserves exact canonical bytes at zero,
and runs before geometry.

The production visual checkpoint used `a7c2.ARW` through LibRaw at 7008×4672. Neutral and people
exports had identical framing. Compared with neutral, the people preset measured luminance MAE
4.51/255, mean luminance delta +4.49/255, edge-energy ratio 1.011, and no pixels beyond a 32-level
grayscale delta. Those metrics establish that the preset reached pixels without losing structure;
they do not isolate vignette from the preset's other declared controls or select an aesthetic.

Fresh unprimed review found a technical tie with no treatment defect. Framing and detail aligned;
falloff remained smooth with no rings, banding, abrupt transitions, corner crushing, clipping, blur,
or halos. The people render was mildly brighter and warmer, which reads as a subtle grade rather
than an unnatural cast. Faint cyan/magenta fringing on high-contrast poles, wires, and fence strands
was equally present in both renders rather than introduced or amplified by the preset. Preference
between the two outputs is aesthetic only.

Evidence PNG hashes:

- neutral: `7b692bfa2fea346a062e206bb66d8fd3c20344aa70dcc556c4a8f287834f3c60`
- people: `79e3ddac1820605979b1e8d1ea62ae640036ea8159f20639224be013ffc170db`
