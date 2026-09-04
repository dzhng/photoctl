import type { PGlite } from "@electric-sql/pglite";
import { migration0001 } from "./0001-init.js";
import { migration0002 } from "./0002-photo-core.js";
import { migration0003 } from "./0003-tags-and-daemon.js";
import { migration0004 } from "./0004-import-and-cull.js";

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
}

const migrations = [
  { version: 1, sql: migration0001 },
  { version: 2, sql: migration0002 },
  { version: 3, sql: migration0003 },
  { version: 4, sql: migration0004 },
] as const;

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;
const latestTables = [
  "cache_index",
  "files",
  "photos",
  "schema_version",
  "settings",
  "tags",
  "volumes",
  "xmp_state",
] as const;
const latestConstraints = [
  "cache_index_bytes_check",
  "cache_index_pkey",
  "files_photo_id_fkey",
  "files_pkey",
  "files_volume_uuid_rel_path_key",
  "files_volume_uuid_fkey",
  "photos_flag_check",
  "photos_h_check",
  "photos_label_check",
  "photos_orientation_check",
  "photos_pkey",
  "photos_rating_check",
  "photos_shot_offset_min_check",
  "photos_size_check",
  "photos_w_check",
  "schema_version_pkey",
  "settings_pkey",
  "tags_photo_id_fkey",
  "tags_pkey",
  "tags_tag_check",
  "volumes_pkey",
  "xmp_state_photo_id_fkey",
  "xmp_state_pkey",
] as const;

export async function migrate(db: PGlite): Promise<MigrationResult> {
  await db.exec('SET search_path TO "$user", public');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const recorded = await db.query<{ version: number }>("SELECT version FROM schema_version");
  const versions = recorded.rows.map((row) => row.version).toSorted((left, right) => left - right);
  for (const [index, version] of versions.entries()) {
    if (version !== index + 1 || version > LATEST_SCHEMA_VERSION) {
      throw new Error(`Invalid schema migration ledger: ${versions.join(",")}`);
    }
  }
  const applied = new Set(versions);
  const fromVersion = versions.at(-1) ?? 0;
  const newlyApplied: number[] = [];
  async function apply(index: number): Promise<void> {
    const migration = migrations[index];
    if (!migration) return;
    if (!applied.has(migration.version)) {
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query("INSERT INTO schema_version (version) VALUES ($1)", [migration.version]);
      });
      newlyApplied.push(migration.version);
    }
    await apply(index + 1);
  }
  await apply(0);
  return { fromVersion, toVersion: LATEST_SCHEMA_VERSION, applied: newlyApplied };
}

export async function verifyLatestSchema(db: PGlite): Promise<void> {
  const [tables, constraints, indexes] = await Promise.all([
    db.query<{ name: string }>(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ),
    db.query<{ name: string }>(
      `SELECT constraint_name AS name
       FROM information_schema.table_constraints
       WHERE constraint_schema = 'public'`,
    ),
    db.query<{ name: string }>(
      "SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'",
    ),
  ]);
  const missing = [
    ...missingNames(latestTables, tables.rows),
    ...missingNames(latestConstraints, constraints.rows),
    ...missingNames(
      [
        "files_photo_id_idx",
        "photos_flag_idx",
        "photos_label_idx",
        "photos_promoted_content_hash_idx",
        "photos_rating_idx",
        "photos_shot_id_idx",
        "photos_unpromoted_content_key_idx",
      ],
      indexes.rows,
    ),
  ];
  if (missing.length > 0) throw new Error(`Library schema is incomplete: ${missing.join(",")}`);
}

function missingNames(expected: readonly string[], rows: Array<{ name: string }>): string[] {
  const found = new Set(rows.map(({ name }) => name));
  return expected.filter((name) => !found.has(name));
}
