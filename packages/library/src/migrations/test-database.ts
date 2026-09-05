import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export async function testDatabase(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector } });
  await db.exec("CREATE EXTENSION vector");
  return db;
}
