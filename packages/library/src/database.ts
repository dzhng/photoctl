import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export async function startDatabase(path: string): Promise<PGlite> {
  const db = await PGlite.create({
    dataDir: path,
    extensions: { vector },
    startParams: PGlite.defaultStartParams.filter((argument) => argument !== "-F"),
  });
  await db.exec("SET synchronous_commit = on");
  await assertDurability(db);
  return db;
}

export async function installLibraryExtensions(db: PGlite): Promise<void> {
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
}

async function assertDurability(db: PGlite): Promise<void> {
  const fsync = await db.query<{ fsync: string }>("SHOW fsync");
  const synchronousCommit = await db.query<{ synchronous_commit: string }>(
    "SHOW synchronous_commit",
  );
  if (fsync.rows[0]?.fsync !== "on" || synchronousCommit.rows[0]?.synchronous_commit !== "on") {
    throw new Error("PGlite durability settings are not enabled");
  }
}
