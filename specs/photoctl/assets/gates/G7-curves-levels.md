# G7 curves and levels checkpoint

Slice 08c3 was exercised through the normal `import → develop → show` route on the 7008×4672
`a7c2.ARW` fixture. The neutral and edited 1616×1077 renders used the same source, framing, and view
identity. The edited node added only the RGB master curve `[[0,0],[0.25,0.18],[0.5,0.55],
[0.75,0.85],[1,1]]`; its distinct render hash proves the curve reached production pixels through the
canonical scene-linear artifact route.

The full-frame comparison measured luminance MAE 12.87/255 and RMSE 16.22/255. Mean luminance rose
from 75.29 to 80.02, the 5th percentile moved from 26.65 to 16.71, and the 95th percentile from
125.16 to 159.31. Edge energy rose by 1.33× and entropy from 5.13 to 6.03 bits, while dimensions and
framing remained identical. The black-pixel ratio rose from 3.81% to 10.34%, so this aggressive curve
is evidence of tonal redistribution, not a recommended default grade.

Fresh unprimed review preferred the candidate and accepted it technically. It found preserved shadow
texture, essentially no luminance clipping, intact fine detail, a smooth sky, and no visible halos,
banding, blur, missing content, or objectionable noise amplification. Its main caveat was aesthetic:
the stronger cyan sky and yellow-green grass raised saturation by about 32%, with some blue-channel
floor clipping, so a gentler grade would look more natural even though this checkpoint remains clean.

The neutral render hash was
`r_e3741cb9205488eec0246ae1b5683b16a29dcec3835cf43c276a7f06b85f1140`; the curve render hash was
`r_f9f158466f0193949b75c33bbb795d11ef5247d6f826de38a8757b00de53c269`.

Evidence hashes:

- neutral full: `4878cb35f2959372c1739301925eab025bf33df00a7f70a385d1e46983e596db`
- curve full: `580738f97ed796d9b3c3c59e0a235ad27e09bbd9634fe77289adc855ca9fce38`
- neutral center crop: `45db0f363b92921d68526ac6424df45f3913723893606ac809f3f744b4e7306e`
- curve center crop: `dfdea072aa4e1ceb1675dbd2246215a1910f90e25915cd8eca7e20ae106d0323`
- neutral shadow crop: `a0c59b7214048d90b12fb6464c4e96d79f8a7fe7172bd64d4d6c0b85146ace51`
- curve shadow crop: `baba3fa50fcd5f78860a0ca610608d393a84052270e4cac6434af33d83278045`
