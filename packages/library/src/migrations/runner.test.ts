import { testDatabase } from "./test-database.js";
import { expect, test } from "vitest";
import { LATEST_SCHEMA_VERSION, migrate, verifyLatestSchema } from "./runner.js";

test("migrations are repeatable and record each version once", async () => {
  const db = await testDatabase();
  try {
    const first = await migrate(db);
    const second = await migrate(db);
    await expect(verifyLatestSchema(db)).resolves.toBeUndefined();

    expect(first).toEqual({
      fromVersion: 0,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => index + 1),
    });
    expect(second).toEqual({
      fromVersion: LATEST_SCHEMA_VERSION,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: [],
    });

    const applied = await db.query<{ version: number }>(
      "SELECT version FROM schema_version ORDER BY version",
    );
    expect(applied.rows).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, (_, index) => ({ version: index + 1 })),
    );

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

test("the latest schema supports promoted sampled-key collisions and cull state", async () => {
  const db = await testDatabase();
  try {
    await migrate(db);
    const first = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
    const second = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
    await db.query(
      `INSERT INTO photos
         (id, content_key, content_hash, size, w, h, orientation, rating, flag, label)
       VALUES ($1, 'ck_collision', 'sha256_a', 1, 1, 1, 1, 5, 'pick', 'green'),
              ($2, 'ck_collision', 'sha256_b', 1, 1, 1, 1, 0, 'none', NULL)`,
      [first, second],
    );
    await db.query(
      `INSERT INTO xmp_state (photo_id, sidecar_path, read_at, sidecar_mtime)
       VALUES ($1, '/volume/a.xmp', now(), '2025-01-02T03:04:05Z')`,
      [first],
    );

    const photos = await db.query<{
      content_hash: string;
      rating: number;
      flag: string;
      label: string | null;
    }>("SELECT content_hash, rating, flag, label FROM photos ORDER BY content_hash");
    expect(photos.rows).toEqual([
      { content_hash: "sha256_a", rating: 5, flag: "pick", label: "green" },
      { content_hash: "sha256_b", rating: 0, flag: "none", label: null },
    ]);
  } finally {
    await db.close();
  }
});

test("the latest schema permits affine resample recipes without widening other node versions", async () => {
  const db = await testDatabase();
  try {
    await migrate(db);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', 'ck_3dac5c943a33dcc4', 1, 1, 1, 1)`,
    );
    await expect(
      db.query(
        `INSERT INTO image_nodes
           (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', $1, 'resample', 2, '{}', $2)`,
        [`node_${"1".repeat(64)}`, `recipe_${"2".repeat(64)}`],
      ),
    ).resolves.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO image_nodes
           (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', $1, 'source', 2, '{}', $2)`,
        [`node_${"3".repeat(64)}`, `recipe_${"4".repeat(64)}`],
      ),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
test.each([
  ["2"],
  ["1,3"],
  [`${Array.from({ length: LATEST_SCHEMA_VERSION + 1 }, (_, index) => index + 1).join(",")}`],
])("rejects the non-prefix migration ledger %s before applying schema", async (ledger) => {
  const db = await testDatabase();
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
});

test.each([
  ["constraint", "ALTER TABLE photos DROP CONSTRAINT photos_rating_check"],
  ["index", "DROP INDEX files_photo_id_idx"],
])("latest-schema verification rejects a missing required %s", async (_kind, statement) => {
  const db = await testDatabase();
  try {
    await migrate(db);
    await db.exec(statement);
    await expect(verifyLatestSchema(db)).rejects.toThrow("Library schema is incomplete");
  } finally {
    await db.close();
  }
});

test("the graph schema separates logical nodes from reusable and attempted executions", async () => {
  const db = await testDatabase();
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const artifact = `a_${"1".repeat(64)}`;
  const recipe = `recipe_${"2".repeat(64)}`;
  const inputId = `node_${"3".repeat(64)}`;
  const compositeId = `node_${"4".repeat(64)}`;
  const foreignOnlyId = `node_${"5".repeat(64)}`;
  const secondPhotoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
  try {
    await migrate(db);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_3dac5c943a33dcc4', 1, 1, 1, 1),
              ($2, 'ck_aaaaaaaaaaaaaaaa', 1, 1, 1, 1)`,
      [photoId, secondPhotoId],
    );
    await db.query(
      `INSERT INTO image_nodes
         (photo_id, id, kind, recipe_version, parameters, recipe_hash)
       VALUES ($1, $2, 'source', 1, '{}', $3),
              ($1, $4, 'composite', 1, '{"opacity":1,"blend":"normal"}', $5)`,
      [photoId, inputId, recipe, compositeId, `recipe_${"6".repeat(64)}`],
    );
    await expect(
      db.query(
        `INSERT INTO image_nodes
           (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ($1, $2, 'source', 1, '{}', $3),
                ($1, $4, 'source', 1, '{}', $5)`,
        [secondPhotoId, inputId, recipe, foreignOnlyId, `recipe_${"5".repeat(64)}`],
      ),
    ).resolves.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO image_nodes
           (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ($1, $2, 'source', 2, '{}', $3)`,
        [photoId, `node_${"f".repeat(64)}`, `recipe_${"f".repeat(64)}`],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO image_node_inputs (node_id, photo_id, input_index, input_node_id)
         VALUES ($1, $2, 0, $3), ($1, $2, 1, $3)`,
        [compositeId, photoId, inputId],
      ),
    ).resolves.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO image_node_inputs (node_id, photo_id, input_index, input_node_id)
         VALUES ($1, $2, 2, $3)`,
        [compositeId, photoId, foreignOnlyId],
      ),
    ).rejects.toThrow();

    await expect(
      db.query(
        `INSERT INTO node_executions
           (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [photoId, `exec_${"7".repeat(64)}`, inputId, `eval_${"8".repeat(64)}`, artifact],
      ),
    ).rejects.toThrow();
    await db.query(
      `INSERT INTO image_artifacts
         (artifact_hash, media_type, bytes, w, h, artifact_available)
       VALUES ($1, 'application/x-photoctl-test', 1, 1, 1, true)`,
      [artifact],
    );
    await db.query(
      `INSERT INTO node_executions
         (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [photoId, `exec_${"7".repeat(64)}`, inputId, `eval_${"8".repeat(64)}`, artifact],
    );
    await expect(
      db.query(
        `INSERT INTO node_executions
           (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [photoId, `exec_${"9".repeat(64)}`, inputId, `eval_${"8".repeat(64)}`, artifact],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `INSERT INTO node_executions
           (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
         VALUES ($1, $2, $3, $4, false, $5), ($1, $6, $3, $4, false, $5)`,
        [
          photoId,
          `exec_${"a".repeat(64)}`,
          inputId,
          `eval_${"8".repeat(64)}`,
          artifact,
          `exec_${"b".repeat(64)}`,
        ],
      ),
    ).resolves.toBeDefined();
  } finally {
    await db.close();
  }
});

test("the layer schema keeps identities, snapshots, graph roots, and photos in one ownership boundary", async () => {
  const db = await testDatabase();
  const first = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const second = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
  const revision = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c010";
  const subject = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c011";
  const vacancy = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c012";
  const content = `node_${"1".repeat(64)}`;
  const mask = `node_${"2".repeat(64)}`;
  const foreignContent = `node_${"8".repeat(64)}`;
  const foreignMask = `node_${"9".repeat(64)}`;
  const foreignLayer = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c015";
  try {
    await migrate(db);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_layer_first', 1, 1, 1, 1), ($2, 'ck_layer_second', 1, 1, 1, 1)`,
      [first, second],
    );
    await db.query(
      `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
       VALUES ($1, $3, 'source', 1, '{"orientation":1}', $5),
              ($1, $4, 'mask', 1, $7, $6),
              ($2, $3, 'source', 1, '{"orientation":1}', $5),
              ($2, $4, 'mask', 1, $7, $6),
              ($2, $8, 'source', 1, '{"orientation":1}', $9),
              ($2, $10, 'mask', 1, $7, $11)`,
      [
        first,
        second,
        content,
        mask,
        `recipe_${"3".repeat(64)}`,
        `recipe_${"4".repeat(64)}`,
        JSON.stringify({ artifact_hash: `a_${"5".repeat(64)}` }),
        foreignContent,
        `recipe_${"8".repeat(64)}`,
        foreignMask,
        `recipe_${"9".repeat(64)}`,
      ],
    );
    await expect(
      db.query(
        `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ($1, $2, 'composite', 2, '{"layers":[]}', $3)`,
        [first, `node_${"6".repeat(64)}`, `recipe_${"6".repeat(64)}`],
      ),
    ).resolves.toBeDefined();
    await expect(
      db.query(
        `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
         VALUES ($1, $2, 'source', 2, '{}', $3)`,
        [first, `node_${"7".repeat(64)}`, `recipe_${"7".repeat(64)}`],
      ),
    ).rejects.toThrow();
    await db.query("INSERT INTO document_revisions (photo_id, id) VALUES ($1, $2)", [
      first,
      revision,
    ]);
    await db.query("INSERT INTO layers (photo_id, id, role) VALUES ($1, $2, 'subject')", [
      first,
      subject,
    ]);
    await db.query(
      "INSERT INTO layers (photo_id, id, role, of_layer) VALUES ($1, $2, 'vacancy', $3)",
      [first, vacancy, subject],
    );
    await db.query("INSERT INTO layers (photo_id, id, role) VALUES ($1, $2, 'subject')", [
      second,
      foreignLayer,
    ]);
    await db.query(
      `INSERT INTO document_revision_layers
         (photo_id, revision_id, layer_id, name, z, content_node_id, mask_node_id,
          opacity, blend, enabled)
       VALUES ($1, $2, $3, 'subject', 0, $4, $5, 1, 'normal', true)`,
      [first, revision, subject, content, mask],
    );

    await expect(
      db.query("INSERT INTO layers (photo_id, id, role) VALUES ($1, $2, 'unknown')", [
        first,
        "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c013",
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("INSERT INTO layers (photo_id, id, role) VALUES ($1, $2, 'subject')", [
        "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c099",
        "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c016",
      ]),
    ).rejects.toThrow();
    await expect(
      db.query("INSERT INTO layers (photo_id, id, role, of_layer) VALUES ($1, $2, 'vacancy', $3)", [
        second,
        "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c014",
        subject,
      ]),
    ).rejects.toThrow();

    const invalidSnapshot = (overrides: string) =>
      db.query(
        `INSERT INTO document_revision_layers
           (photo_id, revision_id, layer_id, name, z, content_node_id, mask_node_id,
            opacity, blend, enabled)
         VALUES ${overrides}`,
        [
          first,
          second,
          revision,
          vacancy,
          content,
          mask,
          foreignLayer,
          foreignContent,
          foreignMask,
        ],
      );
    await expect(
      invalidSnapshot("($1, $3, $4, 'bad-z', -1, $5, $6, 1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $4, 'bad-opacity', 1, $5, $6, 1.1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $4, 'bad-blend', 1, $5, $6, 1, 'multiply', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $4, 'duplicate-z', 0, $5, $6, 1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($2, $3, $7, 'foreign-revision', 0, $8, $9, 1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $7, 'foreign-layer', 1, $5, $6, 1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $4, 'foreign-content', 1, $8, $6, 1, 'normal', true)"),
    ).rejects.toThrow();
    await expect(
      invalidSnapshot("($1, $3, $4, 'foreign-mask', 1, $5, $9, 1, 'normal', true)"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
});
