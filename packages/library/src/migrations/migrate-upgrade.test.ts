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
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 5 }, (_, index) => index + 6),
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
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 6 }, (_, index) => index + 7),
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

    expect(result).toEqual({
      fromVersion: 7,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 7 }, (_, index) => index + 8),
    });
    expect(column.rows).toEqual([{ is_nullable: "YES", data_type: "jsonb" }]);
    const revisionMetadata = await db.query<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'document_revisions'
         AND column_name = 'metadata'`,
    );
    expect(revisionMetadata.rows).toEqual([{ is_nullable: "YES", data_type: "jsonb" }]);
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

    expect(result).toEqual({
      fromVersion: 8,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 8 }, (_, index) => index + 9),
    });
    expect(document.rows).toEqual([
      { root_name: "base", node_id: `node_${"1".repeat(64)}`, matched: true },
      { root_name: "output", node_id: `node_${"1".repeat(64)}`, matched: true },
    ]);
  } finally {
    await db.close();
  }
});

test("the v9 layer fixture gains the explicit deterministic solid RGB node kind", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v9.pgsql"));

    const result = await migrate(db);
    await db.query(
      `INSERT INTO image_nodes
         (photo_id, id, kind, recipe_version, parameters, recipe_hash)
       VALUES (
         '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', $1, 'solid', 1,
         '{"w":1,"h":1,"space":"scene-linear-rec2020","rgb":[1,0,1]}'::jsonb, $2
       )`,
      [`node_${"4".repeat(64)}`, `recipe_${"5".repeat(64)}`],
    );
    const kinds = await db.query<{ kind: string }>(
      "SELECT kind FROM image_nodes WHERE kind = 'solid'",
    );
    await db.exec(`
      INSERT INTO layers (photo_id, id, role)
      VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001', '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c010', 'subject');
      INSERT INTO layers (photo_id, id, role, of_layer)
      VALUES (
        '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
        '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c011',
        'vacancy',
        '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c010'
      );
    `);
    await expect(
      db.exec(`
        INSERT INTO layers (photo_id, id, role, of_layer)
        VALUES (
          '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001',
          '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c012',
          'vacancy',
          '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c010'
        )
      `),
    ).rejects.toThrow();

    expect(result).toEqual({
      fromVersion: 9,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 9 }, (_, index) => index + 10),
    });
    expect(kinds.rows).toEqual([{ kind: "solid" }]);
  } finally {
    await db.close();
  }
});

test("the v10 fixture preserves a moved subject and its original-position vacancy", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v10.pgsql"));
    // Match restore's session reset after pgDump clears the search path.
    await db.exec('SET search_path TO "$user", public');
    const before = await historicalGraph(db);
    expect(await migrate(db)).toMatchObject({ fromVersion: 10, toVersion: LATEST_SCHEMA_VERSION });
    expect(await historicalGraph(db)).toEqual(before);
    expect(
      (
        await db.query(`
      SELECT identity.role, content.kind, content.parameters,
        mask.kind AS mask_kind, (identity.of_layer = subject.id) AS paired
      FROM photo_documents document
      JOIN document_revision_layers snapshot ON snapshot.revision_id = document.active_revision_id
      JOIN layers identity ON identity.id = snapshot.layer_id
      JOIN image_nodes content ON content.id = snapshot.content_node_id
      JOIN image_nodes mask ON mask.id = snapshot.mask_node_id
      LEFT JOIN layers subject ON subject.role = 'subject'
      ORDER BY snapshot.z
    `)
      ).rows,
    ).toEqual([
      {
        role: "vacancy",
        kind: "solid",
        parameters: { w: 16, h: 12, space: "scene-linear-rec2020", rgb: [1, 0, 1] },
        mask_kind: "mask",
        paired: true,
      },
      {
        role: "subject",
        kind: "transform",
        parameters: { matrix: [1, 0, 0, 1, 3, -2] },
        mask_kind: "transform",
        paired: null,
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the v11 fixture preserves an affine resample recipe and its ordered input", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v11.pgsql"));
    await db.exec('SET search_path TO "$user", public');
    const before = await historicalGraph(db);
    expect(await migrate(db)).toMatchObject({ fromVersion: 11, toVersion: LATEST_SCHEMA_VERSION });
    expect(await historicalGraph(db)).toEqual(before);
    expect(
      (
        await db.query(`
      SELECT node.recipe_version, node.parameters, edge.input_index, input.kind AS input_kind
      FROM photo_documents document
      JOIN document_revision_layers snapshot ON snapshot.revision_id = document.active_revision_id
      JOIN layers identity ON identity.id = snapshot.layer_id AND identity.role = 'subject'
      JOIN image_nodes node ON node.id = snapshot.content_node_id
      JOIN image_node_inputs edge ON edge.node_id = node.id
      JOIN image_nodes input ON input.id = edge.input_node_id
      WHERE node.kind = 'resample'
    `)
      ).rows,
    ).toEqual([
      {
        recipe_version: 2,
        parameters: { w: 16, h: 12, kernel: "lanczos3", matrix: [1.25, 0, 0, 1.25, 0.5, -0.25] },
        input_index: 0,
        input_kind: "transform",
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the v12 fixture preserves a retouch recipe, its selection and prior-image input", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v12.pgsql"));
    await db.exec('SET search_path TO "$user", public');
    const before = await historicalGraph(db);
    expect(await migrate(db)).toMatchObject({ fromVersion: 12, toVersion: LATEST_SCHEMA_VERSION });
    expect(await historicalGraph(db)).toEqual(before);
    expect(
      (
        await db.query(`
      SELECT node.recipe_version, node.parameters, edge.input_index, input.kind AS input_kind,
        (input.id = snapshot.mask_node_id) AS selection_input,
        (input.id = prior.node_id) AS prior_image_input
      FROM photo_documents document
      JOIN document_revisions revision ON revision.id = document.active_revision_id
      JOIN document_revision_roots prior ON prior.revision_id = revision.parent_revision_id AND prior.root_name = 'output'
      JOIN document_revision_layers snapshot ON snapshot.revision_id = document.active_revision_id
      JOIN layers identity ON identity.id = snapshot.layer_id AND identity.role = 'retouch'
      JOIN image_nodes node ON node.id = snapshot.content_node_id AND node.kind = 'heal'
      JOIN image_node_inputs edge ON edge.node_id = node.id
      JOIN image_nodes input ON input.id = edge.input_node_id
      ORDER BY edge.input_index
    `)
      ).rows,
    ).toEqual(
      ["composite", "mask"].map((input_kind, input_index) => ({
        recipe_version: 1,
        parameters: {
          method: "fast-marching-harmonic",
          at: [8, 6],
          radius: 2,
          neighborhood_radius: 3,
          refinement_iterations: 512,
          refinement_pixel_budget: 8_000_000,
        },
        input_index,
        input_kind,
        selection_input: input_index === 1,
        prior_image_input: input_index === 0,
      })),
    );
  } finally {
    await db.close();
  }
});

async function historicalGraph(db: Awaited<ReturnType<typeof testDatabase>>) {
  // Select the historical contract explicitly: later migrations may add columns,
  // but must not rewrite existing recipes, ordered edges, snapshots or roots.
  return await Promise.all(
    [
      "SELECT photo_id, id, kind, recipe_version, parameters, recipe_hash, created_at FROM image_nodes ORDER BY photo_id, id",
      "SELECT artifact_hash, media_type, bytes, w, h, artifact_available, created_at FROM image_artifacts ORDER BY artifact_hash",
      "SELECT photo_id, node_id, input_index, input_node_id FROM image_node_inputs ORDER BY photo_id, node_id, input_index",
      "SELECT photo_id, id, parent_revision_id, pinned, created_at FROM document_revisions ORDER BY photo_id, id",
      "SELECT photo_id, active_revision_id FROM photo_documents ORDER BY photo_id",
      "SELECT photo_id, revision_id, root_name, node_id FROM document_revision_roots ORDER BY photo_id, revision_id, root_name",
      "SELECT photo_id, id, role, of_layer, created_at FROM layers ORDER BY photo_id, id",
      "SELECT photo_id, revision_id, layer_id, name, z, content_node_id, mask_node_id, opacity, blend, enabled FROM document_revision_layers ORDER BY photo_id, revision_id, z",
    ].map(async (sql) => (await db.query(sql)).rows),
  );
}

test("the v13 revision-metadata fixture preserves its auto-enhance undo contract", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v13.pgsql"));

    const result = await migrate(db);
    const revision = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata
       FROM document_revisions
       WHERE id = '0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003'`,
    );

    expect(result).toEqual({
      fromVersion: 13,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 13 }, (_, index) => index + 14),
    });
    expect(revision.rows).toEqual([
      {
        metadata: {
          auto_enhance_version: 1,
          develop_before_auto: { contrast: 9 },
          provider_execution: { operation: "auto-enhance" },
        },
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the v14 fixture preserves a source-less generated photo and its provider provenance", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v14.pgsql"));

    const result = await migrate(db);
    const generated = await db.query<{
      tag: string;
      recipe_version: number;
      inputs: string;
      output_kind: string;
      seed: number;
    }>(
      `SELECT tag.tag, node.recipe_version,
        (SELECT count(*)::text FROM image_node_inputs
         WHERE photo_id = node.photo_id AND node_id = node.id) AS inputs,
        output.kind AS output_kind,
        (execution.provider_execution->>'seed')::integer AS seed
       FROM image_nodes AS node
       JOIN tags AS tag ON tag.photo_id = node.photo_id
       JOIN node_executions AS execution
         ON execution.photo_id = node.photo_id AND execution.node_id = node.id
       JOIN image_node_inputs AS output_input
         ON output_input.photo_id = node.photo_id AND output_input.input_node_id = node.id
       JOIN image_nodes AS output
         ON output.photo_id = output_input.photo_id AND output.id = output_input.node_id
       WHERE node.kind = 'generate'`,
    );

    expect(result).toEqual({
      fromVersion: 14,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 14 }, (_, index) => index + 15),
    });
    expect(generated.rows).toEqual([
      { tag: "generated", recipe_version: 2, inputs: "0", output_kind: "output", seed: 7 },
    ]);
    expect(
      (
        await db.query(
          "SELECT provider_image_attempt_id FROM node_executions WHERE NOT deterministic",
        )
      ).rows,
    ).toEqual([{ provider_image_attempt_id: null }]);
    expect((await db.query("SELECT id FROM provider_image_attempts")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("the v15 markup fixture preserves its stable vector document", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v15.pgsql"));

    const result = await migrate(db);
    const markup = await db.query<{ items: unknown }>("SELECT items FROM markup");

    expect(result).toEqual({
      fromVersion: 15,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 15 }, (_, index) => index + 16),
    });
    expect(markup.rows).toEqual([
      {
        items: [
          {
            id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c171",
            type: "rect",
            bbox: [30, 20, 50, 40],
            width: 3,
            color: "#ff0000",
          },
        ],
      },
    ]);
  } finally {
    await db.close();
  }
});

test("the v16 fixture preserves derived effective-mask intent and its original selection", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v16.pgsql"));
    expect(await migrate(db)).toEqual({
      fromVersion: 16,
      toVersion: LATEST_SCHEMA_VERSION,
      applied: Array.from({ length: LATEST_SCHEMA_VERSION - 16 }, (_, index) => index + 17),
    });
    const masks = await db.query<{ parameters: unknown; source_parameters: unknown }>(
      `SELECT node.parameters, source.parameters AS source_parameters
       FROM image_nodes node JOIN image_node_inputs edge ON (edge.photo_id, edge.node_id) = (node.photo_id, node.id)
       JOIN image_nodes source ON (source.photo_id, source.id) = (edge.photo_id, edge.input_node_id)
       WHERE node.kind = 'mask' AND node.recipe_version = 2`,
    );
    expect(masks.rows).toEqual([
      {
        parameters: { operation: "fit", mode: "expand", expand_px: 24, feather_px: 2 },
        source_parameters: { artifact_hash: `a_${"a".repeat(64)}` },
      },
    ]);
  } finally {
    await db.close();
  }
});

async function fixture(name: string): Promise<string> {
  return await readFile(new URL(`../../../../fixtures/libraries/${name}`, import.meta.url), "utf8");
}

test("the v20 fixture keeps paid originals and independent attempt outcomes through restore", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v20.pgsql"));
    await migrate(db);
    expect(
      (
        await db.query(`SELECT attempt.state, artifact.media_type, artifact.validation_profile,
      (SELECT count(*)::int FROM node_executions execution WHERE execution.provider_image_attempt_id = attempt.id) AS executions
      FROM provider_image_attempts attempt JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash
      ORDER BY attempt.state`)
      ).rows,
    ).toEqual([
      {
        state: "committed",
        media_type: "image/png",
        validation_profile: "encoded-image",
        executions: 1,
      },
      {
        state: "rejected",
        media_type: "image/png",
        validation_profile: "encoded-image",
        executions: 0,
      },
    ]);
    expect((await db.query("SELECT count(*)::int AS count FROM photos")).rows).toEqual([
      { count: 1 },
    ]);
  } finally {
    await db.close();
  }
});

test("the v21 fixture retains a placed border and its immutable canvas support verdict", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v21.pgsql"));
    await migrate(db);
    const output = await db.query<{
      kind: string;
      recipe_version: number;
      raster: unknown;
      uncovered: boolean;
    }>(
      `SELECT node.kind, node.recipe_version, node.parameters->'frame'->'raster' AS raster,
         (node.parameters->>'uncovered')::boolean AS uncovered
       FROM photo_documents document JOIN document_revision_roots root
         ON root.photo_id = document.photo_id AND root.revision_id = document.active_revision_id AND root.root_name = 'output'
       JOIN image_nodes node ON node.photo_id = root.photo_id AND node.id = root.node_id`,
    );
    expect(output.rows).toEqual([
      { kind: "composite", recipe_version: 3, raster: { w: 22, h: 16 }, uncovered: true },
    ]);
    const border = await db.query<{
      role: string;
      matrix: unknown;
      recipe_version: number;
      support_count: number;
    }>(
      `SELECT identity.role, content.parameters->'matrix' AS matrix, content.recipe_version,
         (checkpoint.parameters->>'support_input_count')::integer AS support_count
       FROM photo_documents document JOIN document_revision_layers layer
         ON layer.photo_id = document.photo_id AND layer.revision_id = document.active_revision_id
       JOIN layers identity ON identity.photo_id = layer.photo_id AND identity.id = layer.layer_id
       JOIN image_nodes content ON content.photo_id = layer.photo_id AND content.id = layer.content_node_id
       JOIN image_nodes checkpoint ON checkpoint.photo_id = identity.photo_id AND checkpoint.id = identity.authored_checkpoint_node_id
       WHERE identity.role = 'border'`,
    );
    expect(border.rows).toEqual([
      { role: "border", matrix: [1, 0, 0, 1, 4, 0], recipe_version: 2, support_count: 0 },
    ]);
    expect((await db.query("SELECT w,h FROM photos")).rows).toEqual([{ w: 16, h: 12 }]);
  } finally {
    await db.close();
  }
});

test("the v19 fixture retains immutable geometry intent and layer authoring relations", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v19.pgsql"));
    await migrate(db);
    const layers = await db.query<{ name: string; sequence: number | null }>(
      `SELECT snapshot.name, (checkpoint.parameters->>'sequence')::int AS sequence
       FROM photo_documents document
       JOIN document_revision_layers snapshot ON snapshot.photo_id = document.photo_id AND snapshot.revision_id = document.active_revision_id
       JOIN layers identity ON identity.photo_id = snapshot.photo_id AND identity.id = snapshot.layer_id
       LEFT JOIN image_nodes checkpoint ON checkpoint.photo_id = identity.photo_id AND checkpoint.id = identity.authored_checkpoint_node_id
       ORDER BY snapshot.name`,
    );
    expect(layers.rows).toEqual([
      { name: "After", sequence: 1 },
      { name: "Before", sequence: null },
      { name: "Before copy", sequence: null },
    ]);
    const root = await db.query<{ type: string; sequence: number; head_matches: boolean }>(
      `SELECT intent.parameters->>'type' AS type, (intent.parameters->>'sequence')::int AS sequence,
         EXISTS(SELECT 1 FROM layers identity WHERE identity.photo_id = root.photo_id AND identity.authored_checkpoint_node_id = edge.input_node_id) AS head_matches
       FROM photo_documents document JOIN document_revision_roots root ON root.photo_id = document.photo_id AND root.revision_id = document.active_revision_id
       JOIN image_nodes intent ON intent.photo_id = root.photo_id AND intent.id = root.node_id
       JOIN image_node_inputs edge ON edge.photo_id = intent.photo_id AND edge.node_id = intent.id
       WHERE root.root_name = 'geometry'`,
    );
    expect(root.rows).toEqual([{ type: "intent", sequence: 1, head_matches: true }]);
    expect((await db.query("SELECT w, h FROM photos")).rows).toEqual([{ w: 16, h: 12 }]);
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});

test("the v18 fixture retains both reference encodings without a source execution", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v18.pgsql"));
    await migrate(db);
    const result = await db.query<{
      working_type: string;
      encoded_type: string;
      executions: number;
    }>(
      `SELECT working.media_type AS working_type, encoded.media_type AS encoded_type,
              (SELECT count(*)::int FROM node_executions execution
               WHERE (execution.photo_id, execution.node_id) = (node.photo_id, node.id)) AS executions
       FROM image_nodes node
       JOIN image_artifacts working ON working.artifact_hash = node.parameters->>'artifact_hash'
       JOIN image_artifacts encoded ON encoded.artifact_hash = node.parameters->>'encoded_artifact_hash'
       WHERE node.kind = 'source' AND node.recipe_version = 2`,
    );
    expect(result.rows).toEqual([
      { working_type: "image/tiff", encoded_type: "image/png", executions: 0 },
    ]);
    expect(
      (
        await db.query(
          "SELECT DISTINCT media_type, validation_profile FROM image_artifacts ORDER BY media_type",
        )
      ).rows,
    ).toEqual([
      { media_type: "image/png", validation_profile: "encoded-image" },
      { media_type: "image/tiff", validation_profile: "linear-rgb-tiff" },
      { media_type: "image/vnd.photoctl.mask+tiff", validation_profile: "mask-tiff" },
    ]);
    expect((await db.query("SELECT id FROM provider_image_attempts")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});

test("the v17 fixture retains a realized frame independently of source availability", async () => {
  const db = await testDatabase();
  try {
    await db.exec(await fixture("schema-v17.pgsql"));
    await migrate(db);
    const result = await db.query<{ render_frame: unknown; artifact_available: boolean }>(
      "SELECT execution.render_frame, artifact.artifact_available FROM node_executions execution JOIN image_artifacts artifact ON artifact.artifact_hash = execution.output_artifact_hash",
    );
    expect(result.rows).toEqual([
      {
        artifact_available: false,
        render_frame: {
          catalog: { w: 7008, h: 4672 },
          source: { w: 1616, h: 1080 },
          raster: { w: 1616, h: 1080 },
          sourceToRaster: [1, 0, 0, 1, 0, 0],
        },
      },
    ]);
  } finally {
    await db.close();
  }
});
