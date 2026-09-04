# 07 — decoders behind one interface: 7a CIRAW, 7b LibRaw, 7c oracle

## Contract unlocked
A real RAW render exists through the one decoder interface every later slice uses; both decoders
produce verdict files; they are each other's oracle (D14, case 8). Land 7a first (gold exam on Mac),
then 7b, then 7c.

## API seam
- `packages/render/src/decoder.ts`: `interface Decoder { id:"ciraw"|"libraw"; probe(path) → {supported,
  compression?, notes[]}; decode(path, {scale:1|0.5|0.25, wb:"asShot"|{temp,tint}}) → LinearImage }`;
  `LinearImage = {w,h, orientationApplied:true, data:Float32Array /*RGB linear Rec.2020*/, whiteLevel,
  blackLevel, camXyz:number[9], asShotWb, wbPreApplied:boolean}`. `selectDecoder(settings)`; `doctor` rows.
  Verb `photoctl decode <id> --with ciraw|libraw --scale 0.25 --to out.tif` (probe verb, kept).
- **7a** `helpers/mac/` SwiftPM `photoctl-mac decode --in --out <f32> --scale --hint com.sony.arw-raw-image`
  (Core Image/ImageIO only; validity `supportedDecoderVersions != ["None"]`; `identifierHint` required).
  `packages/render/src/decoders/ciraw.ts` spawns it. Verdict `assets/gates/G3-ciraw-headless.txt` from
  `smoke:headless-ciraw` (`ssh localhost … decode` with no window server; md5 of two runs).
  FAIL ⇒ `doctor` marks `requires_window_server`; LibRaw becomes default.
- **7b** `crates/libraw-sys` (vendored LibRaw **0.22.2**, CDDL, `build.rs` glob `src/**/*.cpp`,
  `--disable-openmp`, libc++ dynamic, pinned `MACOSX_DEPLOYMENT_TARGET`); `crates/photoctl-image::decode`
  (unpack + metadata + demosaic only; **never** `dcraw_process` defaults); `packages/img` napi loader with
  `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` packages. Verdict `G2-libraw-build.txt`:
  `otool -L` shows no `/opt/homebrew`/libomp; `camXyz[0] ≈ 0.7460` (0.21.x gives 0.7374 = A7C mk1 trap);
  Docker builds it. `probe()` reports the TIFF compression tag (OPEN Lossless-L lands here).
- **7c** `packages/render/src/pipeline.ts` = ONE owner of black/white levels, WB, cam_xyz→Rec.2020, sRGB
  piecewise TRC with negative reflection, `sRGB2014.icc`. `wb oracle <id>` → `out/wb/oracle.html`
  (three-way embedded/CIRAW/LibRaw, diff heatmap, per-channel stats, highlight-clip count).

## Human can run
`photoctl decode <id> --with ciraw …` and `--with libraw …`; open both; `wb oracle`.

## Verification
`test:macos`: `decoder-ciraw.test.ts` (dims at scale 1 and 0.25; junk file → `supported:false`).
`test:functional`: `decoder-libraw.test.ts` (dims, matrix, compression tag); `decoder-unavailable.test.ts`
(Docker: `ciraw` reports `decoder_unavailable` cleanly). `decoder-oracle.test.ts` (case 8, mac): mean ΔE00
over a 64×64 patch grid excluding >0.9 (white-level 16383 vs 15360 edge) below tolerance **T**, stated in
this file once measured — a contract, not measure-and-pin. `cargo test -p libraw-sys` matrix check.

## Delegated: f32 wire format; demosaic algorithm (AHD default); cmake vs `cc`.
## Checkpoint: `wb oracle` — accept T and the runtime default decoder. Silent ⇒ LibRaw if G2 passes (portability), else CIRAW.
## Must stay green: 01–06. Deps: 01, 00 (Cargo ws). Firewall: no develop ops; no NR; no crop; no rawler/GPL code.
