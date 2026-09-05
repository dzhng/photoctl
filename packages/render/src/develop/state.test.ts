import { afterEach, expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { compositeV2Projection } from "../layers/model.js";
import { MASK_ARTIFACT_MEDIA_TYPE } from "../artifacts/publication.js";
import { commitRevision, ensurePhotoDocument, loadActiveDocument } from "../graph/store.js";
import { commitDevelopState, readActiveDevelopState } from "./state.js";
import type { PGlite } from "@electric-sql/pglite";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c031";
const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => await database.close()));
});

test("develop compensation advances the base and reports stable layer ids without rewriting history", async () => {
  const database = await layeredDocument();
  const before = (await loadActiveDocument(database, photoId))!;
  const layerId = before.layers[0].id;
  const oldContentNodeId = before.layers[0].contentNodeId;
  const current = await readActiveDevelopState(database, { photoId, orientation: 1 });

  const compensated = await commitDevelopState(database, current, { exposure: 0.5 });

  expect(compensated.layers).toEqual({ deltaApplied: [layerId], stale: [] });
  const afterCompensation = (await loadActiveDocument(database, photoId))!;
  expect(afterCompensation.layers[0].id).toBe(layerId);
  expect(afterCompensation.layers[0].contentNodeId).not.toBe(oldContentNodeId);
  const delta = await database.query<{ kind: string; parameters: unknown; input_node_id: string }>(
    `SELECT node.kind, node.parameters, edge.input_node_id
     FROM image_nodes AS node
     JOIN image_node_inputs AS edge
       ON edge.photo_id = node.photo_id AND edge.node_id = node.id AND edge.input_index = 0
     WHERE node.photo_id = $1 AND node.id = $2`,
    [photoId, afterCompensation.layers[0].contentNodeId],
  );
  expect(delta.rows).toEqual([
    { kind: "delta", parameters: { exposure: 0.5 }, input_node_id: oldContentNodeId },
  ]);
  expect(
    (
      await database.query<{ content_node_id: string }>(
        `SELECT content_node_id FROM document_revision_layers
         WHERE photo_id = $1 AND revision_id = $2 AND layer_id = $3`,
        [photoId, before.revisionId, layerId],
      )
    ).rows,
  ).toEqual([{ content_node_id: oldContentNodeId }]);

  const next = await readActiveDevelopState(database, { photoId, orientation: 1 });
  const stale = await commitDevelopState(database, next, { exposure: 0.5, shadows: 40 });
  expect(stale.layers).toEqual({ deltaApplied: [], stale: [layerId] });
  const afterStale = (await loadActiveDocument(database, photoId))!;
  expect(afterStale.layers[0].contentNodeId).toBe(afterCompensation.layers[0].contentNodeId);

  const stillStaleState = await readActiveDevelopState(database, { photoId, orientation: 1 });
  const stillStale = await commitDevelopState(database, stillStaleState, {
    exposure: 1,
    shadows: 40,
  });
  expect(stillStale.layers).toEqual({ deltaApplied: [], stale: [layerId] });
  expect((await loadActiveDocument(database, photoId))!.layers[0].contentNodeId).toBe(
    afterCompensation.layers[0].contentNodeId,
  );
});

test("white-balance compensation is bounded by the operator owner's temperature threshold", async () => {
  const database = await layeredDocument();
  const layerId = (await loadActiveDocument(database, photoId))!.layers[0].id;
  let current = await readActiveDevelopState(database, { photoId, orientation: 1 });

  const warm = await commitDevelopState(database, current, {
    white_balance: { temp_offset_k: 200 },
  });
  expect(warm.layers).toEqual({ deltaApplied: [layerId], stale: [] });

  current = await readActiveDevelopState(database, { photoId, orientation: 1 });
  const neutral = await commitDevelopState(database, current, {});
  expect(neutral.layers).toEqual({ deltaApplied: [layerId], stale: [] });

  current = await readActiveDevelopState(database, { photoId, orientation: 1 });
  const beyondCompensation = await commitDevelopState(database, current, {
    white_balance: { temp_offset_k: 400 },
  });
  expect(beyondCompensation.layers).toEqual({ deltaApplied: [], stale: [layerId] });
});

async function layeredDocument(): Promise<PGlite> {
  const database = await testDatabase();
  databases.push(database);
  await migrate(database);
  await database.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_delta_state', 1, 1, 1, 1)`,
    [photoId],
  );
  const initial = await ensurePhotoDocument(database, { photoId, orientation: 1 });
  const artifactHash = `a_${"4".repeat(64)}`;
  await database.query(
    `INSERT INTO image_artifacts
       (artifact_hash, media_type, bytes, w, h, artifact_available)
     VALUES ($1, $2, 4, 1, 1, true)`,
    [artifactHash, MASK_ARTIFACT_MEDIA_TYPE],
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
  await commitRevision(database, {
    photoId,
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
  return database;
}
