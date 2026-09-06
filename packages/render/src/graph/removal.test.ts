import { expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { deletePhotoGraphs } from "./removal.js";
import { commitRevision, ensurePhotoDocument, loadActiveDocument } from "./store.js";
import { developFrame, savedRenderFrame } from "./frame.js";
import { MASK_ARTIFACT_MEDIA_TYPE } from "../artifacts/publication.js";

test("photo removal clears geometry checkpoints and layer history without touching another graph or shared artifacts", async () => {
  const db = await testDatabase();
  try {
    await migrate(db);
    const selected = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c097";
    const other = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c098";
    await db.query(
      `WITH photos AS (
         INSERT INTO photos (id, primary_original_id, w, h, orientation)
         VALUES ($1, $1, 16, 12, 1), ($2, $2, 16, 12, 1)
       ) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation)
         VALUES ($1, $1, 'image', 'ck_removed_photo', 1, 16, 12, 1),
                ($2, $2, 'image', 'ck_retained_other', 1, 16, 12, 1)`,
      [selected, other],
    );
    const original = await ensurePhotoDocument(db, { photoId: selected, orientation: 1 });
    const frame = savedRenderFrame(developFrame({ w: 16, h: 12 }, { w: 16, h: 12 }));
    const authored = await commitRevision(db, {
      photoId: selected,
      expectedRevisionId: original.revisionId,
      nodes: [
        {
          localKey: "checkpoint",
          kind: "geometry",
          recipeVersion: 1,
          parameters: {
            type: "checkpoint",
            support_input_count: 0,
            sequence: 1,
            crop_activation: 0,
            aspect_activation: 0,
            geometry: {},
            input_frame: frame,
            input_stages: [frame],
            outer_frame: frame,
          },
          inputs: [],
        },
        {
          localKey: "intent",
          kind: "geometry",
          recipeVersion: 1,
          parameters: { type: "intent", sequence: 1, crop_activation: 0, aspect_activation: 0 },
          inputs: [{ localKey: "checkpoint" }],
        },
      ],
      rootUpdates: [{ root: "geometry", node: { localKey: "intent" } }],
    });
    const artifactHash = `a_${"4".repeat(64)}`;
    await db.query(
      `INSERT INTO image_artifacts (artifact_hash, media_type, bytes, w, h, artifact_available, validation_profile)
       VALUES ($1, $2, 768, 16, 12, true, 'mask-tiff')`,
      [artifactHash, MASK_ARTIFACT_MEDIA_TYPE],
    );
    const mask = {
      localKey: "mask",
      kind: "mask" as const,
      recipeVersion: 1,
      parameters: { artifact_hash: artifactHash },
      inputs: [],
    };
    const layered = await commitRevision(db, {
      photoId: selected,
      expectedRevisionId: authored.revisionId,
      outputPlan: "photographic",
      nodes: [mask],
      rootUpdates: [],
      newLayers: ["before", "after", "copy"].map((localKey) => ({
        localKey,
        role: "subject" as const,
      })),
      layers: ["before", "after", "copy"].map((localKey, z) => ({
        layer: { localKey },
        name: localKey,
        z,
        contentNode: { nodeId: original.outputNodeId },
        maskNode: { localKey: "mask" },
        opacity: 1,
        blend: "normal" as const,
        enabled: false,
      })),
    });
    expect(
      layered.layers.every(
        (layer) => layer.authoredCheckpointNodeId === authored.nodes.checkpoint.id,
      ),
    ).toBe(true);
    await commitRevision(db, {
      photoId: selected,
      expectedRevisionId: layered.revisionId,
      outputPlan: "photographic",
      nodes: [],
      rootUpdates: [],
      layers: layered.layers.map((layer) => ({
        layer: { layerId: layer.id },
        name: `${layer.name} edited`,
        z: layer.z,
        contentNode: { nodeId: layer.contentNodeId },
        maskNode: { nodeId: layer.maskNodeId },
        opacity: layer.opacity,
        blend: layer.blend,
        enabled: layer.enabled,
      })),
    });
    expect(
      (
        await db.query<{ name: string }>(
          "SELECT name FROM document_revision_layers WHERE photo_id = $1 AND layer_id = $2 ORDER BY name",
          [selected, layered.layers[0]!.id],
        )
      ).rows,
    ).toEqual([{ name: "before" }, { name: "before edited" }]);
    const retained = await ensurePhotoDocument(db, { photoId: other, orientation: 1 });
    await commitRevision(db, {
      photoId: other,
      expectedRevisionId: retained.revisionId,
      outputPlan: "photographic",
      nodes: [mask],
      rootUpdates: [],
      newLayers: [{ localKey: "shared", role: "subject" }],
      layers: [
        {
          layer: { localKey: "shared" },
          name: "Shared mask",
          z: 0,
          contentNode: { nodeId: retained.outputNodeId },
          maskNode: { localKey: "mask" },
          opacity: 1,
          blend: "normal",
          enabled: false,
        },
      ],
    });
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
    expect((await db.query("SELECT id FROM layers WHERE photo_id = $1", [selected])).rows).toEqual(
      [],
    );
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
