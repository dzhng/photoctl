import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import {
  commitRevision,
  compositeV2Projection,
  developHash,
  ensurePhotoDocument,
  readActiveDevelopState,
} from "@photoctl/render";
import { dispatch } from "./dispatch.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("develop resolves a preset before set and persists the exact resolved dictionary", async () => {
  const { libraryPath, id } = await libraryWithPhoto();

  const result = await command(libraryPath, "develop", [
    id,
    "--preset",
    "people",
    "--set",
    "exposure=0.3",
    "highlights=-12",
  ]);

  const expectedDevelop = {
    preset: "people",
    highlights: -12,
    shadows: 15,
    contrast: -8,
    vibrance: 10,
    saturation: -5,
    white_balance: { temp_offset_k: 150 },
    noise_reduction: { luminance: 15, color: 25 },
    sharpen: 20,
    definition: -5,
    vignette: -8,
    exposure: 0.3,
  };

  expect(result).toEqual({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [
      {
        id,
        ok: true,
        develop_hash: developHash(expectedDevelop),
        render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/),
        layers: { delta_applied: [], stale: [] },
      },
    ],
    warnings: [],
  });

  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  const state = await readActiveDevelopState(opened, { photoId: id, orientation: 1 });
  const graph = await opened.query<{
    kind: string;
    parameters: unknown;
    input_index: number | null;
  }>(
    `WITH RECURSIVE reachable(id, depth) AS (
       SELECT root.node_id, 0 FROM document_revision_roots AS root
       JOIN photo_documents AS document
         ON document.photo_id = root.photo_id AND document.active_revision_id = root.revision_id
       WHERE root.photo_id = $1 AND root.root_name = 'output'
       UNION ALL
       SELECT edge.input_node_id, reachable.depth + 1
       FROM reachable JOIN image_node_inputs AS edge
         ON edge.photo_id = $1 AND edge.node_id = reachable.id
     )
     SELECT node.kind, node.parameters, edge.input_index
     FROM reachable JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = reachable.id
     LEFT JOIN image_node_inputs AS edge ON edge.photo_id = $1 AND edge.node_id = node.id
     ORDER BY reachable.depth`,
    [id],
  );
  const counts = await opened.query<{ revisions: string; executions: string }>(
    `SELECT
       (SELECT count(*)::text FROM document_revisions WHERE photo_id = $1) AS revisions,
       (SELECT count(*)::text FROM node_executions WHERE photo_id = $1) AS executions`,
    [id],
  );
  await opened.close();
  expect(state.develop).toEqual(expectedDevelop);
  expect(graph.rows.map(({ kind }) => kind)).toEqual(["output", "develop", "source"]);
  expect(counts.rows).toEqual([{ revisions: "2", executions: "0" }]);
});

test("unset, reset, and copy-from replace state without accumulating edit history", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  const target = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  await opened.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_develop_target', 1, 100, 80, 1)`,
    [target],
  );
  await opened.close();

  await command(libraryPath, "develop", [id, "--set", "exposure=1", "white_balance.tint=8"]);
  await command(libraryPath, "develop", [id, "--unset", "white_balance.tint"]);
  await command(libraryPath, "develop", [target, "--copy-from", id, "--set", "contrast=9"]);
  const copied = await readDevelop(libraryPath, target);
  expect(copied).toEqual({ exposure: 1, contrast: 9 });

  await command(libraryPath, "develop", [target, "--reset"]);
  expect(await readDevelop(libraryPath, target)).toEqual({});
});

test("reset can establish an identity base before a preset and explicit set", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  await command(libraryPath, "develop", [id, "--set", "exposure=2", "cast=30"]);

  const result = await command(libraryPath, "develop", [
    id,
    "--reset",
    "--preset",
    "people",
    "--set",
    "highlights=-12",
  ]);
  expect(result).toMatchObject({ schema: 1, ok: true, summary: { ok: 1, failed: 0 } });

  expect(await readDevelop(libraryPath, id)).toMatchObject({
    preset: "people",
    highlights: -12,
    contrast: -8,
  });
  expect(await readDevelop(libraryPath, id)).not.toHaveProperty("exposure");
  expect(await readDevelop(libraryPath, id)).not.toHaveProperty("cast");
});

test("library presets override package presets and are returned as resolved data", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  await command(libraryPath, "develop", [id, "--set", "contrast=7", "sharpen=11"]);

  const saved = await command(libraryPath, "presets", ["save", "people", "--from", id]);
  expect(saved).toMatchObject({
    schema: 1,
    ok: true,
    data: { name: "people", source: "library", develop: { contrast: 7, sharpen: 11 } },
  });
  expect(await readFile(join(libraryPath, "presets", "develop", "people.json"), "utf8")).toBe(
    '{"contrast":7,"sharpen":11}\n',
  );
  const shown = await command(libraryPath, "presets", ["show", "people"]);
  expect(shown).toEqual(saved);
  const listed = await command(libraryPath, "presets", ["list"]);
  expect(listed).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      presets: [
        { name: "high-contrast", source: "package" },
        { name: "neutral", source: "package" },
        { name: "people", source: "library" },
      ],
    },
  });
});

test("develop keeps successful items in a mixed batch and reports the missing input", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  const missing = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c099";

  const result = await command(libraryPath, "develop", [id, missing, "--set", "contrast=4"]);

  expect(result).toMatchObject({
    schema: 1,
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 1 },
    results: [
      { id, ok: true, develop_hash: expect.stringMatching(/^h_/) },
      { id: missing, ok: false, code: "not_found" },
    ],
  });
  expect(await readDevelop(libraryPath, id)).toEqual({ contrast: 4 });
});

test("per-photo graph read and commit failures do not starve the develop batch", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  const invalidRecipe = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
  const valid = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003";
  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  await opened.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES
       ($1, 'ck_develop_invalid_recipe', 1, 100, 80, 1),
       ($2, 'ck_develop_valid', 1, 100, 80, 1)`,
    [invalidRecipe, valid],
  );
  const broken = await ensurePhotoDocument(opened, { photoId: id, orientation: 1 });
  await opened.query("UPDATE image_nodes SET kind = 'crop' WHERE id = $1", [broken.outputNodeId]);
  const invalid = await ensurePhotoDocument(opened, { photoId: invalidRecipe, orientation: 1 });
  await opened.query("UPDATE image_nodes SET parameters = $2::jsonb WHERE id = $1", [
    invalid.outputNodeId,
    JSON.stringify({ invalid: true }),
  ]);
  await opened.close();

  const result = await command(libraryPath, "develop", [
    id,
    invalidRecipe,
    valid,
    "--set",
    "contrast=4",
  ]);

  expect(result).toMatchObject({
    schema: 1,
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 2 },
    results: [
      { id, ok: false, code: "catalog_unreadable" },
      { id: invalidRecipe, ok: false, code: "catalog_unreadable" },
      { id: valid, ok: true, develop_hash: expect.stringMatching(/^h_/) },
    ],
  });
  expect(await readDevelop(libraryPath, valid)).toEqual({ contrast: 4 });
});

test("a per-photo mutation validation failure becomes a batch result", async () => {
  const { libraryPath, id } = await libraryWithPhoto();

  const result = await command(libraryPath, "develop", [id, "--set", "aspect_ratio=0:3"]);

  expect(result).toMatchObject({
    schema: 1,
    ok: false,
    code: "usage",
    summary: { ok: 0, failed: 1 },
    results: [{ id, ok: false, code: "usage" }],
  });
  expect(await readDevelop(libraryPath, id)).toEqual({});
});

test("replaying an absolute mutation returns the same develop and render identities", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  const args = [id, "--set", "exposure=0.5", "contrast=-3"];

  const first = await command(libraryPath, "develop", args);
  const beforeReplay = await readRevisionIdentity(libraryPath, id);
  const second = await command(libraryPath, "develop", args);

  expect(second).toEqual(first);
  expect(await readRevisionIdentity(libraryPath, id)).toEqual(beforeReplay);
  expect(await readDevelop(libraryPath, id)).toEqual({ exposure: 0.5, contrast: -3 });
});

test("develop reports compensated and stale layer identities with a non-blocking stale warning", async () => {
  const { libraryPath, id } = await libraryWithPhoto();
  const layerId = await addLayer(libraryPath, id);

  const compensated = await command(libraryPath, "develop", [id, "--set", "exposure=0.5"]);
  expect(compensated).toMatchObject({
    ok: true,
    results: [{ id, layers: { delta_applied: [layerId], stale: [] } }],
    warnings: [],
  });

  const stale = await command(libraryPath, "develop", [id, "--set", "shadows=40"]);
  expect(stale).toMatchObject({
    ok: true,
    results: [{ id, layers: { delta_applied: [], stale: [layerId] } }],
    warnings: [{ code: "layers_stale", id, message: "1 layer is stale after the develop change" }],
  });
});

async function libraryWithPhoto(): Promise<{ libraryPath: string; id: string }> {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-develop-"));
  temporaryDirectories.push(directory);
  const libraryPath = join(directory, "library");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const initialized = await initializeLibrary(libraryPath);
  await initialized.handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_develop_test', 1, 100, 80, 1)`,
    [id],
  );
  await initialized.handle.close();
  return { libraryPath, id };
}

async function addLayer(libraryPath: string, id: string): Promise<string> {
  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  try {
    const initial = await ensurePhotoDocument(opened, { photoId: id, orientation: 1 });
    const artifactHash = `a_${"5".repeat(64)}`;
    await opened.query(
      `INSERT INTO image_artifacts
         (artifact_hash, media_type, bytes, w, h, artifact_available)
       VALUES ($1, 'application/x-photoctl-mask-test', 1, 1, 1, true)`,
      [artifactHash],
    );
    const layers = [
      {
        layer: { localKey: "subject" },
        name: "subject",
        z: 0,
        contentNode: { nodeId: initial.outputNodeId },
        maskNode: { localKey: "mask" },
        opacity: 1,
        blend: "normal" as const,
        enabled: true,
      },
    ];
    const projection = compositeV2Projection({ nodeId: initial.outputNodeId }, layers);
    const committed = await commitRevision(opened, {
      photoId: id,
      expectedRevisionId: initial.revisionId,
      nodes: [
        {
          localKey: "mask",
          kind: "mask",
          recipeVersion: 1,
          parameters: { artifact_hash: artifactHash },
          inputs: [],
        },
        { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
      newLayers: [{ localKey: "subject", role: "subject" }],
      layers,
    });
    return committed.newLayers.subject;
  } finally {
    await opened.close();
  }
}

async function command(libraryPath: string, verb: string, args: string[]) {
  return await dispatch(
    { verb, args, cwd: process.cwd(), env: { noDaemon: true, libraryPath } },
    { version: "test" },
  );
}

async function readDevelop(libraryPath: string, id: string): Promise<unknown> {
  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  const rows = await opened.query<{ orientation: number }>(
    "SELECT orientation FROM photos WHERE id = $1",
    [id],
  );
  const state = await readActiveDevelopState(opened, {
    photoId: id,
    orientation: rows.rows[0]!.orientation,
  });
  await opened.close();
  return state.develop;
}

async function readRevisionIdentity(
  libraryPath: string,
  id: string,
): Promise<{ activeRevisionId: string; revisionCount: string }> {
  const opened = await import("@photoctl/library").then(
    async ({ openLibrary }) => await openLibrary(libraryPath, { noDaemon: true }),
  );
  const result = await opened.query<{
    active_revision_id: string;
    revision_count: string;
  }>(
    `SELECT document.active_revision_id,
            count(revision.id)::text AS revision_count
     FROM photo_documents AS document
     JOIN document_revisions AS revision ON revision.photo_id = document.photo_id
     WHERE document.photo_id = $1
     GROUP BY document.active_revision_id`,
    [id],
  );
  await opened.close();
  const row = result.rows[0]!;
  return { activeRevisionId: row.active_revision_id, revisionCount: row.revision_count };
}
