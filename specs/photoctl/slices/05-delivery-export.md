# 05 — delivery export; `scripts/gold-exam.sh` (keyless dry run)

## Contract unlocked
`export` always writes (D28), names by template, never clobbers unasked, embeds `sRGB2014.icc` + creator/copyright.
`scripts/gold-exam.sh` exists and passes without `develop` (added in 08).

## API seam
- `packages/render/src/export/{template.ts,collision.ts,metadata.ts,run.ts}`: template grammar `{date} {seq:03} {stem} {id8}
  {rating}`; default template `{stem}`; `{date}` = shot-local date; `{seq}` = argument order within the batch; `--on-collision
  skip|overwrite|rename` default **rename** (`_2`, `_3`…); `--resize N` long edge, never upscales; `--quality` default 88;
  `--format jpeg|tiff|png` (TIFF 16-bit); `--iptc creator=… copyright=…` written as XMP `dc:creator`/`dc:rights` + EXIF
  `Artist`/`Copyright` (Sharp metadata for JPEG/PNG; native first-IFD tags after TIFF encoding); `--preset <name>` = any export flag
  by CLI name from package data or
  `<lib>/presets/export/<name>.json`, CLI overrides. `exports(photo_id, path, at, render_hash, bytes)` history (migration, next number).
- Export ensures and snapshots the active document once, evaluates that immutable output node through the canonical evaluator,
  reads its verified RGB16 artifact, and only then encodes delivery pixels. The snapped `render_hash` appears in every successful
  item; a concurrently committed edit gets a new output node and cannot partially enter the export. Node kinds whose pixel
  operation has not landed return `decoder_unavailable` rather than falling back to raw source pixels.
- Offline precedence per README. `scripts/gold-exam.sh <dir> [--out]`: import --link → list → rate the first 10 IDs returned by
  that import → export; writes a report; 08 adds the develop step.
- `wb export <dir>`.

## Verification
`export-template.test.ts` (`2023-10-02_001_a7c2.jpg` under any `TZ`; rename → `_2`); `export-warns.test.ts` (offline with a cached
tier → exit 0 + `source_offline`; none → 69); `export-metadata.test.ts` (creator/rights and Artist/Copyright read back with exifr);
`export-resize.test.ts` (2048×1365; `--resize 9000` → 7008); `preview-export-hash.test.ts` proves `show.preview` and the following
export report the same hash and visible edit state; `gold-exam-dry.test.ts` runs `scripts/gold-exam.sh` on a 10-file set.

## Delegated: chroma subsampling; report HTML layout.
## Checkpoint: delivered folder — template default only.
## Must stay green: 01–04. Deps: 04. Firewall: identity path only; no watermark.

## Implementation evidence

Implemented on the full-hash render-DAG foundation. Each item ensures and snapshots one immutable active output node, resolves the
actual online or pinned source provenance, evaluates that node to a canonical artifact, and reads the artifact back through its
hash-verifying RGB16 boundary before delivery encoding. Missing node operations fail explicitly, so an edited hash is never attached
to source pixels. Successful writes publish
durably before schema-v6 history is recorded, while skip results are explicit and do not claim a new history event. Package and
library presets (including the destination) share one validator, with library definitions shadowing package defaults and command-line fields taking final
precedence; metadata-only restore preserves that live presets tree with the other non-database library trees. Skip accepts an
existing destination only after a full image decode, and an unreadable item does not prevent later batch items from completing.

The keyless ten-photo journey, delivery format/resize/metadata checks, offline and integrity behavior, schema v1–v6 upgrades,
workbench contact sheet, and preview/export full-hash agreement pass. The contact-sheet checkpoint is
[`../assets/slice05/export-contact-sheet.png`](../assets/slice05/export-contact-sheet.png): single-frame telemetry found no empty,
transparent, or badly framed output, and the mandatory fresh-eyes critique passed after portrait/4:3 cropping and noisy absolute
paths were removed. No before/reference frame existed, so comparison correctly used the single-image metrics mode.
