# AHD in balanced working channels

Normalizing channel scales inside AHD reduces false color without the clear detail
loss of the bilinear alternative. The native correction is integrated and matches
the reviewed experimental camera pixels; this does not accept every camera delivery.

## Causal control

Both arms run the same upstream AHD on the saved CFA inputs from the
[interpolation experiment](../interpolation-owner/README.md). The candidate scales
each working channel by its as-shot gain divided by the largest gain, rounds for
upstream's integer buffer, runs AHD, and undoes that scaling into floating-point
camera samples. Every measured CFA site is restored exactly. Subsequent white
balance, matrix, display conversion, crop and exposure remain unchanged.

The full baseline camera hash and all five baseline captures match the preceding
production-validated experiment. The original is opened only for LibRaw metadata;
no new unpacking or source preparation introduces a second variable.
[LibRaw's author](https://www.libraw.org/comment/reply/2436/5122) warns that some
interpolators require prior channel balancing. The vendored processing pipeline
scales channels before AHD, whose cross-channel differences and Lab homogeneity
selection are not interchangeable with a later multiplication.

The public camera-space contract can remain unbalanced: this is an internal
interpolation representation, undone before the shared camera front. It does not
move user white balance, apply it twice or select a different decoder.

## Bounded result

For the sharper known-neutral field, mean normalized channel error falls from
0.00360 to 0.000308; p95 channel spread falls from 0.02144 to 0.000955.
All measured photo and control sites remain exact. Working-input gains never
exceed one, and these inputs produce no output at the integer ceiling. Rounding
before interpolation contributes at most 1.264 camera counts on these gains;
undoing into float avoids a second integer clamp. These observations do not prove
headroom safety for arbitrary inputs or extreme gains.

Root and fresh image-only reviewer `/root/normalized_critique` inspected all ten
captures. Both prefer the candidate's reduced cyan/green/red speckling along hair,
eyebrows, glasses and nose highlights. Pores, strands, edges and small highlights
remain visible; slight local smoothing does not reveal clear lost structure.
Overview tone and geometry are unchanged perceptually. The sharper neutral control
loses false tint while retaining stripe widths, contrast and internal bands.
Residual bright-hair flecks remain; this is scoped visual acceptance of the
experiment, not full delivery acceptance.

## Integrated verification

The [native boundary](../../../../../crates/libraw-sys/README.md) owns the corrected
representation. Its real DNG regressions first failed on unequal-sensitivity neutral
detail, then passed with normalization. Deliberate loss of fractional output, measured
site restoration, spatial detail or distinct color each made the corresponding test
fail. All nine native tests pass, including saved Sony inputs. The regression budget
comes from a sub-one-linear-8-bit-code error bound, not a new output hash.

The release addon was rebuilt using the already-authorized isolated build tools.
Its SHA-256 is `c6cdb5aac1d845e63b0426bda5cf18794ed1aa73a2f9f077963ecd67c17fe5d5`.
Fresh production decoding of DSC08819, native camera space with recovery disabled,
produces SHA-256 `49ed0492691bb3789fbf3805f87c3820906d5015ee5aae998acd02fb4572f670`,
exactly the experiment's full camera buffer. Public dimensions and WB metadata remain
unchanged. The private C buffer is float; no new public format, setting or WB owner exists.

The merged focused selection passed 51 tests across render identity, ordinary RAW
treatment, LibRaw scene output, retained export and pairing. Both public cross-decoder
oracle modes passed with unchanged G4 tolerances. TypeScript build, typecheck and lint
exit successfully (lint reports warnings). Derived identities reject old deterministic
outputs while paid execution identity remains unchanged. These checks do not replace
the current-runtime complete photographic review, installed-package gate or full local
closeout. Earlier all-reference photographic evidence used the preceding addon.

`report.json` binds all captures and stage measurements; `comparison.json` provides
diagnostic distances, not quality scores. The scratch reproduction, exact compile
command, saved input buffers and rounding evidence remain at
`/private/tmp/photoctl-ahd-scale.cQbGLX`. The experiment itself did not change a product
binary; the integrated build above is the subsequent production verification.
