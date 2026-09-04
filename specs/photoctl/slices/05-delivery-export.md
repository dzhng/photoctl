# 05 — delivery export: resize, template, collision, IPTC, presets; warn-never-refuse

## Contract unlocked
A photographer can deliver: `export` always writes (D28), names by template, never clobbers unasked,
embeds `sRGB2014.icc` + IPTC. Keyless gold-exam **dry run** (develop as a no-op) passes.

## API seam
- `packages/render/src/export/{template.ts,collision.ts,iptc.ts,run.ts}`: grammar `{date} {seq:03} {stem}
  {id8} {rating}` — `{date}` = shot-local date (timezone owner), `{seq}` scoped to the batch;
  `--on-collision skip|overwrite|rename` (`_2`, `_3`…); `--resize N` long edge; `--quality`; `--iptc k=v…`;
  `--format jpeg|tiff|png`; `--preset <name>` from `<lib>/export-presets/<name>.json`. **sharp** is the
  permanent encoder/resizer/ICC/IPTC writer. `exports(photo_id, path, at, develop_hash, bytes)` history —
  migration `0003-exports.ts` (+ schema-v3 fixture).
- Offline rule (README): fallback source exists → write + `warnings[{code:"source_offline"}]`; nothing → `file_offline` 69.
- `wb export <dir>`: what was written, dims/bytes/ICC/IPTC read back.

## Human can run
Session-sample A6 verbatim against `/tmp/drive` then unplug and re-run.

## Verification
`export-template.test.ts` (`2023-10-02_001_a7c2.jpg` under any `TZ`; rename yields `_2`);
`export-warns.test.ts` (offline with cached tier → exit 0 + warning; no cache → 69);
`export-iptc.test.ts` (creator/copyright read back with exifr); `export-resize.test.ts` (2048×1365);
`gold-exam.test.ts` (case 1 on a 10-file `fixtures:drive` set with `--preset people` accepted as a no-op
until 08 — the test's expectation flips in 08).

## Delegated: IPTC writer path inside sharp; chroma subsampling default.
## Checkpoint: delivered folder + `wb export` — template default and IPTC field set.
## Must stay green: 01–04. Deps: 04. Firewall: identity path only; no watermark; no cloud delivery.
