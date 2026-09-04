# 05 — delivery export; `scripts/gold-exam.sh` (keyless dry run)

## Contract unlocked
`export` always writes (D28), names by template, never clobbers unasked, embeds `sRGB2014.icc` + creator/copyright.
`scripts/gold-exam.sh` exists and passes without `develop` (added in 08).

## API seam
- `packages/render/src/export/{template.ts,collision.ts,metadata.ts,run.ts}`: template grammar `{date} {seq:03} {stem} {id8}
  {rating}`; default template `{stem}`; `{date}` = shot-local date; `{seq}` = argument order within the batch; `--on-collision
  skip|overwrite|rename` default **rename** (`_2`, `_3`…); `--resize N` long edge, never upscales; `--quality` default 88;
  `--format jpeg|tiff|png` (TIFF 16-bit); `--iptc creator=… copyright=…` written as XMP `dc:creator`/`dc:rights` + EXIF
  `Artist`/`Copyright` via sharp `withXmp`/`withExif`; `--preset <name>` = any export flag by CLI name from package data or
  `<lib>/presets/export/<name>.json`, CLI overrides. `exports(photo_id, path, at, develop_hash, bytes)` history (migration, next number).
- Offline precedence per README. `scripts/gold-exam.sh <dir> [--out]`: import --link → list → rate 10 → export; writes a report; 08 adds the develop step.
- `wb export <dir>`.

## Verification
`export-template.test.ts` (`2023-10-02_001_a7c2.jpg` under any `TZ`; rename → `_2`); `export-warns.test.ts` (offline with a cached
tier → exit 0 + `source_offline`; none → 69); `export-metadata.test.ts` (creator/rights and Artist/Copyright read back with exifr);
`export-resize.test.ts` (2048×1365; `--resize 9000` → 7008); `gold-exam-dry.test.ts` runs `scripts/gold-exam.sh` on a 10-file set.

## Delegated: chroma subsampling; report HTML layout.
## Checkpoint: delivered folder — template default only.
## Must stay green: 01–04. Deps: 04. Firewall: identity path only; no watermark.
