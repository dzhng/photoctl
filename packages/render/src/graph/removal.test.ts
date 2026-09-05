import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { deletePhotoGraphs } from "./removal.js";
import { ensurePhotoDocument, loadActiveDocument } from "./store.js";

test("photo removal clears geometry checkpoints and layer history without touching another graph or shared artifacts", async () => {
  const db = await testDatabase();
  try {
    await db.exec(
      await readFile(
        new URL("../../../../fixtures/libraries/schema-v19.pgsql", import.meta.url),
        "utf8",
      ),
    );
    await migrate(db);
    const selected = (await db.query<{ id: string }>("SELECT id FROM photos")).rows[0]!.id;
    const other = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c098";
    await db.query(
      "INSERT INTO photos (id, content_key, size, w, h, orientation) VALUES ($1, 'ck_retained_other', 1, 16, 12, 1)",
      [other],
    );
    await ensurePhotoDocument(db, { photoId: other, orientation: 1 });
    const before = await loadActiveDocument(db, other);
    const artifacts = (await db.query("SELECT * FROM image_artifacts ORDER BY artifact_hash")).rows;
    expect((await loadActiveDocument(db, selected))?.layers).toHaveLength(3);
    await db.transaction(async (transaction) => {
      await deletePhotoGraphs(transaction, [selected]);
      await transaction.query("DELETE FROM photos WHERE id = $1", [selected]);
    });
    expect(await loadActiveDocument(db, selected)).toBeNull();
    expect(await loadActiveDocument(db, other)).toEqual(before);
    expect((await db.query("SELECT * FROM image_artifacts ORDER BY artifact_hash")).rows).toEqual(
      artifacts,
    );
    expect((await db.query("SELECT id FROM layers")).rows).toEqual([]);
    expect(
      (await db.query("SELECT id FROM image_nodes WHERE photo_id = $1", [selected])).rows,
    ).toEqual([]);
    expect(
      (await db.query("SELECT id FROM document_revisions WHERE photo_id = $1", [selected])).rows,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});
