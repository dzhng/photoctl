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
    expect(applied.rows).toEqual([{ version: 1 }, { version: 2 }]);

    await db.query(
      `INSERT INTO photos
        (id, content_key, size, w, h, orientation, camera, exposure, shot_at, shot_offset_min)
       VALUES
        ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ck_3dac5c943a33dcc4', 73400320,
         7008, 4672, 1, '{"make":"SONY"}', '{"iso":100}',
         '2023-10-02T16:18:37Z', 120)`,
    );
    await db.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('6A1F-0C3B', 'A7C2', '/Volumes/A7C2', '2023-10-02T16:18:37Z')`,
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime, embedded)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002',
               '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '6A1F-0C3B', 'DCIM/a7c2.ARW',
               '2023-10-02T16:18:37Z', '[{"width":7008,"height":4672,"offset":659456,"length":6730200}]')`,
    );
    await db.query(
      `INSERT INTO cache_index (path, bytes, last_used, pinned)
       VALUES ('emb/0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001.jpg', 466017,
               '2023-10-02T16:18:37Z', true)`,
    );

    const locator = await db.query<{ content_key: string; volume_uuid: string; rel_path: string }>(
      `SELECT p.content_key, f.volume_uuid, f.rel_path
       FROM photos p JOIN files f ON f.photo_id = p.id`,
    );
    expect(locator.rows).toEqual([
      {
        content_key: "ck_3dac5c943a33dcc4",
        volume_uuid: "6A1F-0C3B",
        rel_path: "DCIM/a7c2.ARW",
      },
    ]);
  } finally {
    await db.close();
  }
});
