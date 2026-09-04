import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { migrate } from "./runner.js";

test("migrations are repeatable and record each version once", async () => {
  const db = await PGlite.create();
  try {
    await migrate(db);
    await migrate(db);

    const applied = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    expect(applied.rows).toEqual([{ version: 1 }]);
  } finally {
    await db.close();
  }
});
