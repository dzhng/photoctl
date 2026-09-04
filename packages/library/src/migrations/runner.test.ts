import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { LATEST_SCHEMA_VERSION, migrate, verifyLatestSchema } from "./runner.js";

test("migrations are repeatable and record each version once", async () => {
  const db = await PGlite.create();
  try {
    const first = await migrate(db);
    const second = await migrate(db);

    expect(first).toEqual({ fromVersion: 0, toVersion: LATEST_SCHEMA_VERSION, applied: [1, 2, 3] });
    expect(second).toEqual({
      fromVersion: LATEST_SCHEMA_VERSION,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: [],
    });

    const applied = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    expect(applied.rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);

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

    await db.query(
      `INSERT INTO tags (photo_id, tag)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ceremony')`,
    );
    const tags = await db.query<{ tag: string }>("SELECT tag FROM tags");
    expect(tags.rows).toEqual([{ tag: "ceremony" }]);
  } finally {
    await db.close();
  }
});

test.each([["2"], ["1,3"], ["1,2,3,4"]])(
  "rejects the non-prefix migration ledger %s before applying schema",
  async (ledger) => {
    const db = await PGlite.create();
    try {
      await db.exec(
        `CREATE TABLE schema_version (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
         INSERT INTO schema_version (version) VALUES (${ledger.replaceAll(",", "),(")});`,
      );
      await expect(migrate(db)).rejects.toThrow(`Invalid schema migration ledger: ${ledger}`);
      const tables = await db.query<{ name: string }>(
        "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      );
      expect(tables.rows).toEqual([{ name: "schema_version" }]);
    } finally {
      await db.close();
    }
  },
);

test.each([
  ["constraint", "ALTER TABLE photos DROP CONSTRAINT photos_content_key_key"],
  ["index", "DROP INDEX files_photo_id_idx"],
])("latest-schema verification rejects a missing required %s", async (_kind, statement) => {
  const db = await PGlite.create();
  try {
    await migrate(db);
    await db.exec(statement);
    await expect(verifyLatestSchema(db)).rejects.toThrow("Library schema is incomplete");
  } finally {
    await db.close();
  }
});
