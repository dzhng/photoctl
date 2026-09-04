# 03 — backup (pgDump), restore, migrate, cache prune, schema fixture

## Contract unlocked
A broken, old, or PG-major-mismatched library is recovered by `restore`, never recreated silently (D36/D37); every later
schema change has a proven upgrade path from a committed pgDump.

## API seam
- `packages/library/src/backup.ts`: `photoctl backup` → `<lib>/backups/<iso>.sql` via `@electric-sql/pglite-tools` `pgDump`;
  the daemon takes a snapshot in the background after a successful open (dedupe window 5 min, keep 10 by bytes ≤ 200 MB);
  `--no-daemon` never auto-snapshots. `photoctl restore [--from f]`: stops the daemon (or refuses `library_locked`), loads the
  snapshot into a fresh cluster under the current PG, swaps directories. `photoctl migrate`: forward-only schema migrations;
  `migrate_required` (PG major mismatch) is resolved by `restore`, which `migrate`'s message points to.
- `packages/importer/src/cache.ts`: `cache prune [--max]` by `cache_index.last_used` (never atime); pinned rows (`emb/` tier,
  `models/`) are excluded.
- `fixtures/libraries/schema-v1.pgsql` (a slice-01b library with the fixture). Every later schema slice adds `schema-vN.pgsql`
  and extends `migrate-upgrade.test.ts`.
- `wb library`.

## Verification
`restore.test.ts` (import 3 fixtures:drive files → backup → wipe rows → restore → same ids and `content_key`s);
`migrate-upgrade.test.ts` (open `schema-v1.pgsql` → `LATEST`, fixture row values intact); `cache-prune.test.ts` (oldest
`last_used` gone, pinned kept, total ≤ max); `backup-dedupe.test.ts` (second open inside the window → no new file).

## Delegated: pgDump compression.
## Must stay green: 01–02. Deps: 02. Firewall: no directory clones; no auto-quarantine; no down migrations.
