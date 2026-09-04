# 04 — import at scale, locators/offline, cull verbs, XMP read

## Contract unlocked
Import a drive's worth of files idempotently; cull with three axes (stars/flag/label) plus tags,
`next`, `remove`; everything except reading originals works with the drive unplugged (D1/D17/D18).

## API seam
- `packages/importer/src/{scan.ts,pipeline.ts}`: recursive scan → identity → EXIF → embedded index →
  rows; progress events `{"event":"progress",phase:"scan|import",done,total,per_sec,eta_s}`; `--copy`
  into `<lib>/originals/<date>/`; result = session-sample A2 (`imported, already_present, volume, xmp_read,
  previews, embeddings:{queued:0,note}`).
- `packages/library/src/locators.ts`: relocation on rescan when `content_key` matches a new path (same id,
  new `files` row); `online` = volume mounted && stat ok, refreshed on every open.
- `packages/library/src/xmp/read.ts`: `xmp:Rating`, `xmp:Label`, `dc:subject`, `lr:hierarchicalSubject`
  (flattened: last path segment; document it); flags are library-only (Classic writes no pick flag);
  store `xmp_state(photo_id, sidecar_path, read_at, sidecar_mtime)` (D20). PGlite wins on re-import.
- Migration `0002-cull-and-xmp.ts` (+ `fixtures/libraries/schema-v2.pgsql`).
- `packages/protocol/src/verbs/{list,next,rate,flag,label,tag,remove}.ts`: multi-id → top-level
  `summary`/`results` with `code:"partial"` (65); range grammar `--rating ">=4"`; `--flag pick|reject|none`;
  `--label red|yellow|green|blue|purple|none`; `--stream` NDJSON rows; `next [--unrated|--unflagged] [--folder]`
  advances a per-library cursor in `settings`; `remove <id...> [--from-disk --yes]` (D34: refuses multi-id
  without `--yes`; Trash on Mac via `packages/library/src/trash.ts`, `.trash/` dir under `EnvVolumeResolver`).
- `fixtures:drive -- --count N --out DIR`: N copies of `a7c2.ARW` with distinct 64-byte tail padding
  (changes content key, keeps TIFF readable) into `YYYY-MM-DD_<shoot>/DSC0NNNN.ARW` + Classic-style
  sidecars. `fixtures:volume` (Mac): `hdiutil` image with a real volume UUID.
- `wb sheet <lib> [--filter]`: contact sheet of 1616 tiers with stars/flag/label badges and an online dot;
  click → `show` JSON. This is the standing asset workbench.

## Human can run
Session-sample A2/A3/A4 verbatim against `/tmp/drive`; `hdiutil detach` → `list` shows `online:false`.

## Verification
`reimport-idempotent.test.ts` (case 4: second import → `already_present == N`; `mv` inside the volume →
same id, new locator); `offline.test.ts` (case 5 via `PHOTOCTL_VOLUME_MAP=…:offline`: `list` online:false,
`rate` works, `show.preview` from cache); `cull.test.ts` (partial results: exit 65, `results[2].code ==
"not_found"`; `remove` multi-id without `--yes` → exit 2); `xmp-read.test.ts` (sidecar rating 4 + keywords
land; a PGlite edit survives re-import); `next.test.ts` (cursor advances; `remaining` counts down);
`migrate-upgrade.test.ts` extended with v2.

## Delegated: scan concurrency; `--human` widths; XML parser (owner fixed).
## Checkpoint: `wb sheet` + `list --human` — columns, badges, `next` semantics.
## Must stay green: 01–03. Deps: 03. Firewall: no XMP write; no develop; no `.lrcat` parsing.
