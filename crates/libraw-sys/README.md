# LibRaw boundary

This crate keeps the CDDL-licensed RAW decoder behind a narrow Rust boundary so the rest of photoctl
does not depend on LibRaw's C++ types or build system. The vendored source is based on LibRaw
0.22.2 release from `https://www.libraw.org/data/LibRaw-0.22.2.tar.gz`; its SHA-256 is
`de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa`.

The local metadata patch (2026-09-06) preserves the original TIFF Compression value in the existing per-IFD parser and
selected-RAW metadata. LibRaw may normalize Compression=7 to dispatch code 6 while reading a Sony lossless JPEG header;
that internal routing value is not the file's tag. The wrapper reports the preserved tag without changing decoder routing
or pixels. Readers without a TIFF tag keep their existing compression reporting. Keep this patch when updating the source
pin, or replace it with an equivalent upstream metadata owner. Changes
to these internal C++ layouts require rebuilding the whole vendored library and native addon together; the C wire is unchanged.

The build deliberately compiles the upstream source directly, without OpenMP, JPEG, or LCMS system
dependencies. Keep those constraints when updating LibRaw: native packages must not acquire a package
manager path or a runtime dependency that is absent on a clean host.

The wrapper stops after black subtraction and, for admitted three-color Bayer sensor data, AHD demosaicing.
Its channel-difference interpolation uses a temporary gain-normalized integer representation:
positive finite as-shot gains are divided by their maximum, then undone into floating-point
camera samples afterward. Measured CFA sites are restored exactly. This is not output white
balance: metadata and the common front end remain authoritative. Normalizing only downward
avoids clipping above-white input; floating-point inverse scaling retains fractional headroom.
Malformed/non-Bayer CFA, codec-balanced CFA, and gains whose entire ushort input range would
round to zero are explicitly unsupported rather than silently using unbalanced interpolation.
The private C pixel buffer is float, matching the unchanged public Rust camera-space image;
rebuild the wrapper and its consumer together when changing that private wire.
Formats whose codec already supplies complete RGB pixels must bypass demosaicing: treating them as
a Bayer mosaic overwrites measured channels with fabricated detail. Codec-applied white balance
remains explicit in the existing metadata so the common front end never applies it twice.
Color conversion, output white balance,
transfer curves, denoising, and crop policy belong to the shared photoctl develop pipeline; adding any
of them here would make LibRaw pixels disagree with other camera-space decoders before that common
pipeline sees them.

Oriented pixels retain internal affine addressing of the decoder's physical grid.
Spatial reconstruction can therefore use sensor-aligned neighborhoods without
reinterpreting orientation or changing public dimensions. Its saturation reference
is admitted only for three-color CFA data with positive finite actual RGB WB gains
and a positive black/white range, without codec-applied WB; complete RGB
and four-color sensor representations must not masquerade as that contract.
