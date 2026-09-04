import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { migrate } from "./runner.js";

test("the previous schema upgrades without losing library settings", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await fixture("schema-v1.pgsql"));

    await migrate(db);

    const versions = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    const libraryId = await db.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'library_id'",
    );
    expect(versions.rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(libraryId.rows).toEqual([{ value: "0199a7c2-0000-7000-8000-000000000001" }]);
    await expect(
      db.query(
        `INSERT INTO volumes (uuid, label, last_mount, last_seen)
         VALUES ('6A1F-0C3B', 'A7C2', '/Volumes/A7C2', now())`,
      ),
    ).resolves.toBeDefined();
  } finally {
    await db.close();
  }
});

test("the previous schema fixture gains daemon and tag state without losing photo facts", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await fixture("schema-v2.pgsql"));

    await migrate(db);

    const photo = await db.query<{
      content_key: string;
      size: string;
      w: number;
      h: number;
      orientation: number;
      volume_uuid: string;
      rel_path: string;
      embedded: Array<{ width: number; height: number; offset: number; length: number }>;
    }>(
      `SELECT p.content_key, p.size::text AS size, p.w, p.h, p.orientation,
              f.volume_uuid, f.rel_path, f.embedded
       FROM photos p JOIN files f ON f.photo_id = p.id`,
    );
    expect(photo.rows).toEqual([
      {
        content_key: "ck_3dac5c943a33dcc4",
        size: "73400320",
        w: 7008,
        h: 4672,
        orientation: 1,
        volume_uuid: "6A1F-0C3B",
        rel_path: "a7c2.ARW",
        embedded: [
          { width: 160, height: 120, offset: 44146, length: 8217 },
          { width: 1616, height: 1080, offset: 192674, length: 466017 },
          { width: 7008, height: 4672, offset: 659456, length: 6730200 },
        ],
      },
    ]);
    const queueMax = await db.query<{ value: number }>(
      "SELECT value::text::integer AS value FROM settings WHERE key = 'daemon_queue_max'",
    );
    expect(queueMax.rows).toEqual([{ value: 8 }]);
  } finally {
    await db.close();
  }
});

test("the current schema fixture preserves tags and daemon settings", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await fixture("schema-v3.pgsql"));

    await migrate(db);

    const versions = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    const tags = await db.query<{ photo_id: string; tag: string }>(
      "SELECT photo_id::text, tag FROM tags ORDER BY photo_id, tag",
    );
    const queueMax = await db.query<{ value: number }>(
      "SELECT value::text::integer AS value FROM settings WHERE key = 'daemon_queue_max'",
    );
    expect(versions.rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(tags.rows).toEqual([
      { photo_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001", tag: "ceremony" },
    ]);
    expect(queueMax.rows).toEqual([{ value: 8 }]);
  } finally {
    await db.close();
  }
});

async function fixture(name: string): Promise<string> {
  return await readFile(new URL(`../../../../fixtures/libraries/${name}`, import.meta.url), "utf8");
}
