# 03 — preview-cache lifecycle, backup, restore, migrate, schema fixture

Sub-slices: **3a** preview coordination/index/prune · **3b** backup/restore/migrate + fixture.

**03a implemented:** the daemon owns one preview coordinator and direct dispatch owns one request-local
coordinator. Master and view keys are single-flight, every waiter revalidates the JPEG plus SHA-bound provenance,
and completed storage (JPEG plus sidecar bytes) is indexed before a returned path is touched. Prune uses one
captured start time, the 30-minute grace, an exclusive path lease, and a conditional database claim so a concurrent
touch wins. It protects `emb/` and `models/` by both the pinned flag and tier, removes sidecars with their JPEGs,
and isolates a failed deletion so later LRU candidates still run.

**03b implemented:** backups are durable plain-SQL pgDump snapshots. The daemon serializes one automatic
snapshot through its operation lane after open, deduplicates snapshots within five minutes, and retains the
newest ten under a 200 MiB pool while always preserving the newest file. Restore stops the daemon, builds and
verifies a fresh current-PG sibling, then swaps it into place behind an operation lock and a durable journal.
Recovery derives the safe action from the actual live/stage/rollback directories while holding their locks;
a committed journal can only finish rollback cleanup. Migration accepts only an exact contiguous prefix of the
known forward migrations, verifies required constraints and indexes, and a persistent handle reports each startup
upgrade once. Backup recency is encoded in its filename, so preserved copies cannot reorder retention.

## Contract unlocked
A broken, old, or PG-major-mismatched library is recovered by `restore`, never recreated silently (D36/D37); every later
schema change has a proven upgrade path from a committed pgDump. Preview artifacts become safe to share and inspect before
later render graphs add more producers.

## API seam
- **3a** `packages/render/src/preview-coordinator.ts`: `PreviewCoordinator.materialize(key, work)` is the sole derived-preview
  artifact writer. Concurrent callers for the same `{photo_id,render_hash,master|view_hash}` join one promise; requests for different
  views that require the same absent master join the master's promise. Every waiter validates the finished JPEG and provenance
  sidecar before receiving its path. A failed attempt removes its flight, lease, and temporary files so a retry can become the
  writer. The daemon owns one coordinator; direct `--no-daemon` dispatch creates one for that exclusive request lifetime.
- **3a** `packages/library/src/cache-index.ts`: the injected preview-index adapter upserts completed artifacts and touches
  `cache_index.last_used` only after the JPEG and provenance sidecar validate. The coordinator exposes its in-memory leased-path
  snapshot to pruning. `packages/importer/src/cache.ts`: `cache prune [--max]` by `cache_index.last_used` (never atime); pinned rows
  (`emb/` tier, `models/`) are excluded. Preview artifacts whose materialization is in flight or whose successful `show` updated
  `last_used` within the preceding 30 minutes are also excluded. The clock and grace interval are injected in tests; pruning
  works from one captured `prune_started_at`, so a long prune cannot age a returned preview into eligibility mid-run.
- **3b** `packages/library/src/backup.ts`: `photoctl backup` → `<lib>/backups/<iso>.sql` via `@electric-sql/pglite-tools` `pgDump`;
  the daemon takes a snapshot after a successful open without racing command dispatch (dedupe window 5 min, keep 10 by bytes ≤ 200 MB);
  `--no-daemon` never auto-snapshots. `photoctl restore [--from f]`: stops the daemon (or refuses `library_locked`), loads the
  snapshot into a fresh cluster under the current PG, swaps directories. `photoctl migrate`: forward-only schema migrations;
  `migrate_required` (PG major mismatch) is resolved by `restore`, which `migrate`'s message points to.
- **3b** `fixtures/libraries/schema-v1.pgsql` (a slice-01b library with the fixture). Every later schema slice adds `schema-vN.pgsql`
  and extends `migrate-upgrade.test.ts`.
- `wb library`.

## Verification
`restore.test.ts` (import 3 fixtures:drive files → backup → wipe rows → restore → same ids and `content_key`s);
`migrate-upgrade.test.ts` (open `schema-v1.pgsql` → `LATEST`, fixture row values intact); `cache-prune.test.ts` (oldest
`last_used` gone, pinned kept, leased/recent previews kept, total ≤ max; a preview touched concurrently with the prune is not
deleted); `preview-single-flight.test.ts` launches overview, native, and overlapping region requests, proves one master graph
evaluation and one artifact per key, then injects a failed writer and proves retry plus no temp residue;
`backup-dedupe.test.ts` (second open inside the window → no new file).

03a evidence: coordinator retry/provenance and overview/native/overlapping-view tests; PGlite cache-index ordering
and bounded LRU paging/conditional-claim tests; prune pinned-tier, lease, captured-clock touch race, and failure-isolation tests;
command-level `show` index and `cache prune --max` tests. The TypeScript build, typecheck, formatter, and linter are
green; focused preview consumers and the persistent-daemon journey pass. A broad changed-test sweep exposed existing
process-contention timing failures under its full parallel load, so it is not recorded as a passing gate.

03b evidence: real CLI import/backup/mutate/restore preserves photo IDs and content keys; invalid SQL, a live
holder, future or gapped migration ledgers, both rename-before-journal crash windows, first-journal publication
failure, and interruption during rollback deletion have dedicated regressions. Backup tests exercise real pgDump
output, five-minute deduplication, count/byte rotation, the oversized-newest warning, and pre/post-publication
failures. The committed `schema-v1.pgsql` pgDump upgrades through `LATEST_SCHEMA_VERSION` without changing its
known settings. `wb library` was captured from a real schema-v3 library at 1440×1100; the accepted checkpoint has
explicit library ID/path labels, one-line identity, Table/Rows headings, and no clipping or alignment defects.
Fresh critique retained only non-blocking density and wide-column polish notes.

## Delegated: pgDump compression.
## Must stay green: 01–02. Deps: 3a ← 02; 3b ← 3a.
## Firewall: no directory clones; no auto-quarantine; no down migrations; no develop state.
