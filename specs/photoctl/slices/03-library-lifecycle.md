# 03 — backup (pgDump), restore, migrate, cache prune, schema-v1 fixture

## Contract unlocked
A broken or old library is never recreated silently (D36/D37). Every later schema change has a proven
upgrade path from a committed pgDump fixture.

## API seam
- `packages/library/src/backup.ts`: `snapshot(handle)` → `<lib>/backups/<iso>.sql` via
  `@electric-sql/pglite-tools` `pgDump` on successful open, deduped by window, keep-N by bytes; `photoctl
  backup`, `photoctl restore [--from f]` (full reload into a fresh dir then swap), `photoctl migrate`
  (forward-only; refuses on `PG_VERSION` mismatch with the D36 message), `photoctl cache prune [--max]` LRU by atime.
- `fixtures/libraries/schema-v1.pgsql`: pgDump of a slice-01 library with the fixture imported.
  **Every later migration slice adds `schema-vN.pgsql` and extends `migrate-upgrade.test.ts`.**
- `wb library`: schema version, tables, row counts, backups, cache size.

## Human can run
Truncate `<lib>/base/…` → `photoctl show` exits 69 with the restore command → `photoctl restore` → works.

## Verification
`restore.test.ts` (list before == list after); `migrate-upgrade.test.ts` (open `schema-v1.pgsql` with the
current migration list → `LATEST`, fixture row values intact — assert values, not counts);
`cache-prune.test.ts`; `backup-dedupe.test.ts`.

## Delegated: dedupe window, keep budget, compression.
## Must stay green: 01–02. Deps: 02. Firewall: no directory clones; no auto-quarantine; no down migrations.
