import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { LATEST_SCHEMA_VERSION, migrate } from "./runner.js";
import { testDatabase } from "./test-database.js";

test("the previous schema upgrades without losing library settings", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v1.pgsql"));

    const result = await migrate(db);

    const versions = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    const libraryId = await db.query<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'library_id'",
    );
    expect(versions.rows).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => ({ version: index + 1 })),
    );
    expect(result).toEqual({
      fromVersion: 1,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 1 }, (_, index) => index + 2),
    });
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
  const db = await testDatabase();
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
  const db = await testDatabase();
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
    expect(versions.rows).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => ({ version: index + 1 })),
    );
    expect(tags.rows).toEqual([
      { photo_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001", tag: "ceremony" },
    ]);
    expect(queueMax.rows).toEqual([{ value: 8 }]);
  } finally {
    await db.close();
  }
});

test("the cull schema upgrades to the graph without losing promoted identity or cull state", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v4.pgsql"));

    const result = await migrate(db);

    expect(result).toEqual({
      fromVersion: 4,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 4 }, (_, index) => index + 5),
    });
    const photo = await db.query<{
      content_hash: string;
      rating: number;
      flag: string;
      label: string;
      tag: string;
      sidecar_path: string;
    }>(
      `SELECT p.content_hash, p.rating, p.flag, p.label, t.tag, x.sidecar_path
       FROM photos p
       JOIN tags t ON t.photo_id = p.id
       JOIN xmp_state x ON x.photo_id = p.id`,
    );
    expect(photo.rows).toEqual([
      {
        content_hash: "sha256_3dac5c943a33dcc4",
        rating: 5,
        flag: "pick",
        label: "green",
        tag: "ceremony",
        sidecar_path: "/Volumes/A7C2/a7c2.xmp",
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the current graph fixture preserves its active lazy source revision", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v5.pgsql"));

    const result = await migrate(db);
    const document = await db.query<{
      active_revision_id: string;
      pinned: boolean;
      root_name: string;
      kind: string;
    }>(
      `SELECT d.active_revision_id::text, r.pinned, root.root_name, node.kind
       FROM photo_documents AS d
       JOIN document_revisions AS r
         ON (r.photo_id, r.id) = (d.photo_id, d.active_revision_id)
       JOIN document_revision_roots AS root
         ON (root.photo_id, root.revision_id) = (r.photo_id, r.id)
       JOIN image_nodes AS node
         ON (node.photo_id, node.id) = (root.photo_id, root.node_id)
       ORDER BY root.root_name`,
    );

    expect(result).toEqual({
      fromVersion: 5,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: [6, 7, 8, 9],
    });
    expect(document.rows).toEqual([
      {
        active_revision_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003",
        pinned: true,
        root_name: "base",
        kind: "source",
      },
      {
        active_revision_id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003",
        pinned: true,
        root_name: "output",
        kind: "source",
      },
    ]);
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("the current delivery fixture preserves export history", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v6.pgsql"));

    const result = await migrate(db);
    const history = await db.query<{
      path: string;
      render_hash: string;
      bytes: string;
    }>("SELECT path, render_hash, bytes::text FROM exports");

    expect(result).toEqual({
      fromVersion: 6,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: [7, 8, 9],
    });
    expect(history.rows).toEqual([
      {
        path: "/delivery/a7c2.jpg",
        render_hash: `r_${"3".repeat(64)}`,
        bytes: "6730200",
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the current provider fixture has the bounded external-execution seam", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v7.pgsql"));

    const result = await migrate(db);
    const column = await db.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'node_executions'
         AND column_name = 'provider_execution'`,
    );

    expect(result).toEqual({ fromVersion: 7, toVersion: LATEST_SCHEMA_VERSION, applied: [8, 9] });
    expect(column.rows).toEqual([{ is_nullable: "YES", data_type: "jsonb" }]);
    const search = await db.query<{ vector_type: string; searchable: string }>(
      `SELECT pg_typeof(e.vec)::text AS vector_type,
              p.searchable::text AS searchable
       FROM photos p
       JOIN embeddings e ON e.photo_id = p.id`,
    );
    expect(search.rows).toEqual([]);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND indexname IN ('embeddings_vec_hnsw_idx', 'photos_searchable_gin_idx')
       ORDER BY indexname`,
    );
    expect(indexes.rows).toEqual([
      { indexname: "embeddings_vec_hnsw_idx" },
      { indexname: "photos_searchable_gin_idx" },
    ]);
  } finally {
    await db.close();
  }
});

test("the v8 search fixture gains typed base and output roots without changing its active pixels", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v8.pgsql"));

    const result = await migrate(db);
    const document = await db.query<{ root_name: string; node_id: string; matched: boolean }>(
      `SELECT root.root_name, root.node_id,
              photo.searchable @@ websearch_to_tsquery('english', 'ceremony') AS matched
       FROM photo_documents AS document
       JOIN document_revision_roots AS root
         ON (root.photo_id, root.revision_id) = (document.photo_id, document.active_revision_id)
       JOIN photos AS photo ON photo.id = document.photo_id
       ORDER BY root.root_name`,
    );

    expect(result).toEqual({ fromVersion: 8, toVersion: LATEST_SCHEMA_VERSION, applied: [9] });
    expect(document.rows).toEqual([
      { root_name: "base", node_id: `node_${"1".repeat(64)}`, matched: true },
      { root_name: "output", node_id: `node_${"1".repeat(64)}`, matched: true },
    ]);
  } finally {
    await db.close();
  }
});

async function fixture(name: string): Promise<string> {
  return await readFile(new URL(`../../../../fixtures/libraries/${name}`, import.meta.url), "utf8");
}
