# G6 masked develop checkpoint

Slice 08c2 was exercised through the normal `import → develop → show` route on the 7008×4672
`a7c2.ARW` fixture. Neutral and `vibrance=80` renders used the same source, framing, and output
dimensions. Their different render and file hashes prove the develop node reached production pixels.

The full-frame comparison measured mean absolute luminance distance 1.49/255, edge-energy ratio
0.994, and mean luminance change -0.93/255. The 1600×1000 native foliage crop measured 1.35/255,
1.030, and -0.47/255 respectively. Color entropy increased from 5.10 to 5.36 bits full-frame and
5.10 to 5.48 bits in the crop, while framing and edge structure remained stable.

Fresh visual review found no new clipping, blocked shadows, banding, halos, blur, or geometry
defect. It did find red/cyan edge fringing and gritty foliage in both renders; stronger color makes
that existing defect slightly easier to see, so neither render received aesthetic acceptance.

The committed fixture is a landscape and contains no person or visible skin. Skin-hue protection is
therefore verified only by the controlled native/public tests that hold saturation constant and vary
hue. A real portrait crop remains required before the product feel of that protection is accepted.

Evidence hashes:

- neutral full: `0a56b3da04e4cb3e99f950ab6e955baf3aeba7e70049e45037272d9e183b3b3f`
- vibrance full: `9b89fe82e2f0fcd8069902175483a7d442b8c82d227a0c39b05009f1d8781a29`
- neutral crop: `594d0c386b86f5f0f40923972c36b3521b9be258c12c97a8b779d14949421b71`
- vibrance crop: `334d19ec474a90b424dab99407bbf4a629ea3cfbde5088e6033d9b096abebc4f`
