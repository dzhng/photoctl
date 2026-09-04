# 04 — import at scale, locators/offline, cull verbs, XMP read

## Contract unlocked
Import a drive's worth of files idempotently; cull on three axes plus tags with `next`; `remove`; everything except
reading originals works with the drive unplugged (D1/D17/D18). The slice-01 invariant applies to the entire scan:
every id counted as imported or already present has a valid pinned offline preview, regardless of source format.

## API seam
- `packages/importer/src/{scan.ts,pipeline.ts}`: recursive candidate scan → content probe registry → identity → EXIF → preview
  producer → rows. Scanning must not discard a candidate solely because its extension is absent, unknown, or incorrect;
  progress events; `--copy` into `<lib>/originals/<date>/` (collision → `<stem>_<id8>`); result = session A2.
- `packages/library/src/locators.ts`: relocation — a rescan that finds `content_key` at a new path adds a `files` row; the old row
  is removed when its volume is online and the path is gone, kept when the volume is offline. `online` refreshed on every open.
- `packages/library/src/xmp/read.ts` (`fast-xml-parser`): `xmp:Rating`, `xmp:Label` (case-insensitive map of the five English
  names; unknown → null + `label_unknown` warning), `dc:subject` ∪ `lr:hierarchicalSubject` last segment (exact-string dedupe),
  `photoctl:flag` under `xmlns:photoctl="http://photoctl.dev/xmp/1.0/"`; `xmp_state(photo_id, sidecar_path, read_at, sidecar_mtime)`.
  PGlite wins on re-import (D20).
- Migration (next number): `rating int default 0`, `flag text default 'none'`, `label text`, `xmp_state`, cursor rows in `settings`.
- Verbs (`packages/protocol/src/verbs/*`, handlers in `packages/commands`): `list [--rating "4"|">=4"|"3..5"] [--flag] [--label]
  [--tag] [--folder] [--xmp-stale] [--stream] [--limit]` → `data:{rows:[A3 row],total}` ordered `shot_at,id`; `next [--unrated|
  --unflagged] [--folder] [--reset]` → cursor keyed by the filter hash, ordered `shot_at,id`, `remaining`; `rate`, `flag
  --pick|--reject|--none`, `label <color|none>` (multi-id → `summary`/`results`, `partial` 65); `remove <id...> [--from-disk --yes]`
  (multi-id without `--yes` → `usage` 2; `packages/library/src/trash.ts` `Trash` interface: `MacTrash` = move to
  `<volume>/.Trashes/<uid>/` on external volumes, `~/.Trash` on the boot volume; `DirTrash` = `<dir>/.trash/` under the env resolver).
- `fixtures:drive -- --count N --out DIR` (tail-padded copies + Classic-style sidecars); `fixtures:volume` (Mac hdiutil).
- `wb sheet <lib> [--filter]` (1616 tiers, badges, online dot; click → `show`).

## Human can run
Session A2/A3/A4 against `/tmp/drive`; `hdiutil detach` → `list` shows `online:false`.

## Verification
`reimport-idempotent.test.ts` (second import → `already_present == N` **and** ids unchanged; `mv` inside the volume → same id,
new locator, old removed; a mixed-format folder, including a decodable image with an unknown extension, leaves one pinned preview
per id); `offline.test.ts`
(`…:offline` → `online:false`, `rate` works, `show.preview` from cache for every imported format);
`cull.test.ts` (partial → 65 with `results[2].code=="not_found"`; `remove` multi-id without `--yes` → 2); `next.test.ts`
(order, cursor per filter, `--reset`); `xmp-read.test.ts` (rating/label/keywords land incl. hierarchical union; PGlite edit
survives re-import; unknown label → warning); `migrate-upgrade` extended.

## Delegated: scan concurrency; `--human` widths.
## Checkpoint: `wb sheet` — badge legibility only.
## Must stay green: 01–03. Deps: 03. Firewall: no XMP write; no develop; no `.lrcat` parsing.
