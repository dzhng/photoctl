# Color profiles

`sRGB2014.icc` is the unmodified ICC v2 sRGB profile published by the International Color
Consortium. ICC permits copying and distribution without fee provided the file, including its
copyright tag, is not changed. Source: https://registry.color.org/rgb-registry/srgbprofiles

`LinearRec2020-v4.icc` is photoctl's deterministic ICC v4.4 matrix/TRC profile for linear
BT.2020 RGB. It carries D65 primaries adapted to the ICC profile-connection space and identity
tone curves. Regenerate it with Little CMS 2 using
`node scripts/generate-linear-rec2020-profile.mjs`; the expected SHA-256 is recorded below so a
toolchain change cannot silently replace the color contract.

`SHA-256: e5ef19e5e8c289edb6310037fd5e890bdaf44c7534ad20893aa826505737cc17`
