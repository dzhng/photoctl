import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { encodeDisplayTiff } from "../linear-tiff.js";
import { reconcileArtifactAvailability, retainedArtifacts } from "./availability.js";
import { artifactPath } from "./publication.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("reconciliation invalidates legacy display artifacts", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-artifact-reconcile-"));
  directories.push(library);
  const database = await testDatabase();
  await migrate(database);
  try {
    const bytes = await encodeDisplayTiff({
      w: 1,
      h: 1,
      channels: 3,
      data: new Uint16Array([1, 2, 3]),
      space: "display-srgb",
      orientationApplied: true,
    });
    const hash = `a_${createHash("sha256").update(bytes).digest("hex")}`;
    const path = artifactPath(library, hash, "tif");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await database.query(
      `INSERT INTO image_artifacts (artifact_hash, media_type, bytes, w, h, artifact_available)
       VALUES ($1, 'image/tiff', $2, 1, 1, true)`,
      [hash, bytes.length],
    );

    expect(await reconcileArtifactAvailability(database, library)).toEqual({
      available: 0,
      unavailable: 1,
    });
    expect(
      (
        await database.query<{ artifact_available: boolean }>(
          "SELECT artifact_available FROM image_artifacts WHERE artifact_hash = $1",
          [hash],
        )
      ).rows,
    ).toEqual([{ artifact_available: false }]);
  } finally {
    await database.close();
  }
});

test("retention follows disabled layer content and masks as immutable revision roots", async () => {
  const database = await testDatabase();
  await migrate(database);
  const photo = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const revision = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c002";
  const layer = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c003";
  const source = `node_${"1".repeat(64)}`;
  const content = `node_${"2".repeat(64)}`;
  const mask = `node_${"3".repeat(64)}`;
  const artifacts = ["4", "5", "6"].map((digit) => `a_${digit.repeat(64)}`);
  try {
    await database.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_retained_layer', 1, 1, 1, 1)`,
      [photo],
    );
    await database.query(
      `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
       VALUES ($1, $2, 'source', 1, '{"orientation":1}', $5),
              ($1, $3, 'develop', 1, '{}', $6),
              ($1, $4, 'mask', 1, $8, $7)`,
      [
        photo,
        source,
        content,
        mask,
        `recipe_${"1".repeat(64)}`,
        `recipe_${"2".repeat(64)}`,
        `recipe_${"3".repeat(64)}`,
        JSON.stringify({ artifact_hash: artifacts[2] }),
      ],
    );
    await database.query(
      `INSERT INTO image_node_inputs (photo_id, node_id, input_index, input_node_id)
       VALUES ($1, $2, 0, $3)`,
      [photo, content, source],
    );
    await database.query("INSERT INTO document_revisions (photo_id, id) VALUES ($1, $2)", [
      photo,
      revision,
    ]);
    await database.query(
      `INSERT INTO document_revision_roots (photo_id, revision_id, root_name, node_id)
       VALUES ($1, $2, 'base', $3), ($1, $2, 'output', $3)`,
      [photo, revision, source],
    );
    await database.query("INSERT INTO layers (photo_id, id, role) VALUES ($1, $2, 'subject')", [
      photo,
      layer,
    ]);
    await database.query(
      `INSERT INTO document_revision_layers
         (photo_id, revision_id, layer_id, name, z, content_node_id, mask_node_id,
          opacity, blend, enabled)
       VALUES ($1, $2, $3, 'hidden', 0, $4, $5, 1, 'normal', false)`,
      [photo, revision, layer, content, mask],
    );
    await database.query(
      `INSERT INTO image_artifacts (artifact_hash, media_type, bytes, w, h, artifact_available)
       VALUES ($1, 'image/tiff', 1, 1, 1, true),
              ($2, 'image/tiff', 1, 1, 1, true),
              ($3, 'image/tiff', 1, 1, 1, true)`,
      artifacts,
    );
    await database.query(
      `INSERT INTO node_executions
         (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
       VALUES ($1, $2, $3, $4, true, $5),
              ($1, $6, $7, $8, true, $9)`,
      [
        photo,
        `exec_${"1".repeat(64)}`,
        source,
        `eval_${"1".repeat(64)}`,
        artifacts[0],
        `exec_${"2".repeat(64)}`,
        content,
        `eval_${"2".repeat(64)}`,
        artifacts[1],
      ],
    );

    expect(await retainedArtifacts(database)).toEqual(
      artifacts.toSorted().map((artifactHash) => ({ artifactHash, available: true })),
    );
  } finally {
    await database.close();
  }
});
