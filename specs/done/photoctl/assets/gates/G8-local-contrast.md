# G8 local-contrast checkpoint

Slice 08d1 used the committed `a7c2.ARW` at 1752×1168 with identical source, framing, and display
conversion. One-variable candidates applied `brilliance=35`, `definition=30`, or `sharpen=25`; a
fourth candidate stacked those settings in the fixed native operator order.

The first stacked capture was rejected by fresh review because it crushed treeline shadows and made
foliage crunchy. After reducing the delegated control gains, the final comparisons measured:

| Candidate | luminance MAE | edge-energy ratio | black-pixel ratio | mean luminance delta |
|---|---:|---:|---:|---:|
| Brilliance | 0.11/255 | 1.014 | 3.94% | +0.02/255 |
| Definition | 0.91/255 | 1.090 | 5.35% | -0.46/255 |
| Sharpen | 0.49/255 | 1.066 | 4.23% | -0.13/255 |
| Stacked | 1.45/255 | 1.179 | 5.81% | -0.61/255 |

One fresh unprimed review initially accepted the reduced set, with denser forest shadows and busier
foreground texture as caveats. After the bounded-memory correction, a new unprimed review accepted
brilliance and sharpen individually but rejected definition for near-black foliage and brittle edge
separation, and rejected the stack because those defects compounded. The correction changed at most
one 8-bit code value in 0.002% of stacked samples and left the telemetry below unchanged to the shown
precision, but the latest visual verdict governs: **G8 is not accepted**. This evidence proves the
operator seam and records the unresolved tuning honestly; it is not a recommended preset.

Evidence hashes:

- neutral full: `67b36969ed14d8bc25ceea49ed5d34bc7a6d2a420b7536319dc08bbff06c433f`
- brilliance full: `0cd86f04f4d85593e1cc5976de44895e414fa3d31a85909d32783107bd78200a`
- definition full: `fffc2306a54fe9c599655dbaf444c1d40d07bd8d0b91535780d30159024f0686`
- sharpen full: `47677b0198b8df91d4168df71977c8559cfa43469dfa348d4c104dfd175f87c1`
- stacked full: `f5fc948331e6ca0a28ddcb9288fec4138d469bc23e54d8f1ccae1027dfa130c9`
- neutral crop: `69707c6bf35dd3f2dbc32ffabe7bd0346a363234066a7db0916ff322ed3f2f57`
- brilliance crop: `b194f71f49a93de1cf72abe72522d4da91c1a9f6ae85d9a8f3e427882aa1d1cf`
- definition crop: `5847ea72fd8bafc4a1f5922db41ee0402e9f4d75063acfc4782eaf13b254c7d4`
- sharpen crop: `0a444aad8b1dba8b31a6639e6ebb9df772b69777408cd55aa83938ae9d6b6f32`
- stacked crop: `f48006fd7dcf81a929666713b5365f34cca7119df485bf3c95a7e24a01b32560`
