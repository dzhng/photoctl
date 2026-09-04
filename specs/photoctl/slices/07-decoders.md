# 07 — full-resolution decoders behind one interface: file images, CIRAW, and LibRaw

## Status

- [x] **7a CIRAW seam:** `photoctl-mac` performs the neutral Core Image/ImageIO decode, the TypeScript
  decoder boundary consumes its RGB-f32 wire format, `decode --with ciraw` writes linear 16-bit TIFF,
  and `doctor` exposes availability. The normal macOS host test is deterministic. G3 itself remains
  blocked because Remote Login is disabled; the evidence and rerunnable command live in
  [`../assets/gates/G3-ciraw-headless.md`](../assets/gates/G3-ciraw-headless.md). File-decoder scaling still uses Sharp as a
  transitional decode path; slice 10 must replace it with the one Rust resampler named by the global contract.
- [x] **7b LibRaw:** vendored 0.22.2 builds into the optional per-platform napi package; decode runs
  AHD into oriented, black-subtracted camera space on a native worker; probe exposes compression and
  the camera matrix. The fixture, CLI, macOS dependency, and Docker evidence live in
  [`../assets/gates/G2-libraw-build.md`](../assets/gates/G2-libraw-build.md).
- [x] **7c oracle:** the Rust color core owns camera levels/WB/matrix and display transfer in both
  directions, linear TIFFs carry the deterministic Rec.2020 profile, and the exact three-way workbench
  passes [`G4`](../assets/gates/G4-decoder-oracle.md).

## Contract unlocked
Every imported photo can enter the same develop/render graph. A whole-file decoder handles every format admitted through
`previewProducer:"decoded-file"`; CIRAW and LibRaw are specialized adapters behind the same seam. Verdict files G2
(LibRaw build), G3 (CIRAW headless), G4 (oracle tolerance) remain the RAW-adapter gates, not restrictions on library behavior.

## API seam
- `packages/render/src/decoder.ts`: `Decoder{ id; probe(source:ImageSource)→{supported,compression?,notes[]};
  decode(source,{scale:1|0.5|0.25}) → LinearImage }`; `LinearImage{ w,h, orientationApplied:true,
  space:"camera"|"scene-linear-rec2020", data:Float32Array, whiteLevel, blackLevel, camXyz?, asShotWb?, wbPreApplied }`.
  Selection is owned here and consumes slice 01's `ImageProbe`: `decoded-file` chooses `FileImageDecoder`; a camera container
  chooses LibRaw when built, or CIRAW when configured/unavailable. If a preferred full-resolution adapter is unavailable or the
  original is offline, ordinary photo verbs decode the best full-frame embedded source or pinned preview through
  `FileImageDecoder` and return a warning; only an explicit unavailable adapter request returns `decoder_unavailable` 69.
  `decode <id> --with auto|file|ciraw|libraw --scale 0.25 --to out.tif` writes linear 16-bit output (scale dims floor).
- `FileImageDecoder` decodes every whole-file media type accepted by the content probe registry, honors its embedded ICC profile,
  applies orientation once, and converts display-referred input through inverse transfer + gamut conversion into
  `space:"scene-linear-rec2020"`. The conversion lives beside the camera-space front end in the one color core; no format gets a
  parallel develop implementation.
- **7a** `helpers/mac` `photoctl-mac decode` (Core Image/ImageIO only): neutral render = `boostAmount 0, boostShadowAmount 0,
  luminanceNoiseReductionAmount 0, colorNoiseReductionAmount 0, sharpnessAmount 0, contrastAmount 0, detailAmount 0,
  moireReductionAmount 0, isLensCorrectionEnabled false, extendedDynamicRangeAmount 0, isGamutMappingEnabled false`, working
  space linear Rec.2020 → `space:"scene-linear-rec2020"`; validity `supportedDecoderVersions != ["None"]`; `identifierHint`
  required. `probe:headless-ciraw` (ssh, no window server; md5 of two runs) → G3. FAIL ⇒ `doctor` marks `requires_window_server`.
- **7b** `crates/libraw-sys` (vendored 0.22.2, CDDL, `build.rs` glob `src/**/*.cpp`, `--disable-openmp`, libc++ dynamic, pinned
  deployment target); `photoctl-image::decode` = unpack + metadata + demosaic AHD (`user_qual=3`) only → `space:"camera"`;
  `packages/img` per-platform packages. G2: `otool -L` free of `/opt/homebrew`/libomp; `|camXyz[0] − 0.7460| < 5e-4`; Docker builds it.
  `probe()` reports the TIFF compression tag (OPEN Lossless-L).
- **7c** `photoctl-image::develop::front` = levels → WB → cam_xyz→Rec.2020 (runs only for `space:"camera"`); TRC + `sRGB2014.icc`
  at the display stage. `wb oracle <id>` (three-way embedded/CIRAW/LibRaw). G4 contract, set now: mean ΔE00 ≤ 2.0 and p95 ≤ 5.0
  over a 64×64 patch grid, excluding patches where either decoder's Y > 0.9. The explicit linear-TIFF probe embeds the canonical
  linear Rec.2020 ICC without transforming its already-linear samples. David may edit the tolerance at the checkpoint.

`cam_xyz` is LibRaw's conventional XYZ-D65-to-camera matrix. The front end row-normalizes it against
D65 before inversion; inverting the raw matrix is a different transform and is pinned by a numeric
A7C II behavior test. Bulk transforms snapshot each mutable JavaScript typed array at the napi boundary,
then run the expensive per-pixel math on a worker task. The snapshot prevents callers from racing the
worker by mutating an input after invocation; it is the only synchronous part of the operation.
The platform-specific native image package is therefore a required runtime component on every supported
OS/CPU target; its npm dependency is marked optional only so incompatible target packages are skipped.
Decoder fallback covers adapter/source capability, not a partially installed color runtime.
`doctor` exposes that installation invariant as
`native_image:{available,package,required:true}` before listing individual RAW adapters.

## Verification
`test:macos`: `decoder-ciraw.test.ts`; `decoder-oracle.test.ts` (G4 as stated). `test:functional`:
`decoder-format-matrix.test.ts` (representative whole-file formats plus unknown/wrong extension all produce oriented
scene-linear Rec.2020 and the same result shape), `decoder-libraw.test.ts` (dims, matrix, compression tag, parametrized over
manifest rows), `decoder-unavailable.test.ts` (explicit adapter request fails; automatic photo rendering falls back);
`linear-tiff-profile.test.ts` proves external readers see the same linear Rec.2020 space reported by the envelope.
`cargo test -p libraw-sys`.

## Delegated: f32 wire format Swift→TS; cmake vs `cc`.
## Checkpoints: 7b — `wb oracle` framing/orientation only; 7c — accept G4 tolerance.
## Must stay green: 01–06. Deps: 01b, 00. Firewall: no develop ops; no NR; no crop; no rawler/GPL.
