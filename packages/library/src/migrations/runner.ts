import type { PGlite } from "@electric-sql/pglite";
import { migration0001 } from "./0001-init.js";
import { migration0002 } from "./0002-photo-core.js";

export async function migrate(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version integer PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const recorded = await db.query<{ version: number }>("SELECT version FROM schema_version");
  const applied = new Set(recorded.rows.map((row) => row.version));
  const migrations = [
    { version: 1, sql: migration0001 },
    { version: 2, sql: migration0002 },
  ];
  async function applyMigration(index: number): Promise<void> {
    const migration = migrations[index];
    if (!migration) return;
    if (!applied.has(migration.version)) {
      await db.transaction(async (tx) => {
        await tx.exec(migration.sql);
        await tx.query("INSERT INTO schema_version (version) VALUES ($1)", [migration.version]);
      });
    }
    await applyMigration(index + 1);
  }
  await applyMigration(0);
}
