# 07 — decoders behind one interface: 7a CIRAW, 7b LibRaw, 7c oracle

## Contract unlocked
Both decoders feed the ONE color core; verdict files G2 (LibRaw build), G3 (CIRAW headless), G4 (oracle tolerance).

## API seam
- `packages/render/src/decoder.ts`: `Decoder{ id; probe(path)→{supported,compression?,notes[]}; decode(path,{scale:1|0.5|0.25})
  → LinearImage }`; `LinearImage{ w,h, orientationApplied:true, space:"camera"|"scene-linear-rec2020", data:Float32Array,
  whiteLevel, blackLevel, camXyz?, asShotWb?, wbPreApplied }`. Selection rule (one place): LibRaw when built; CIRAW when
  `settings.decoder="ciraw"` or LibRaw unavailable; unavailable adapter → `decoder_unavailable` 69. Verb `decode <id> --with
  ciraw|libraw --scale 0.25 --to out.tif` (linear 16-bit, no TRC; scale dims floor).
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
  over a 64×64 patch grid, excluding patches where either decoder's Y > 0.9. David may edit at the checkpoint.

## Verification
`test:macos`: `decoder-ciraw.test.ts`; `decoder-oracle.test.ts` (G4 as stated). `test:functional`: `decoder-libraw.test.ts` (dims,
matrix, compression tag, parametrized over manifest rows), `decoder-unavailable.test.ts`. `cargo test -p libraw-sys`.

## Delegated: f32 wire format Swift→TS; cmake vs `cc`.
## Checkpoints: 7b — `wb oracle` framing/orientation only; 7c — accept G4 tolerance.
## Must stay green: 01–06. Deps: 01b, 00. Firewall: no develop ops; no NR; no crop; no rawler/GPL.
