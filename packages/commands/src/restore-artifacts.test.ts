import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createBackup, initializeLibrary, openLibrary } from "@photoctl/library";
import { ensurePhotoDocument } from "@photoctl/render";
import { restoreCommand } from "./handlers/library-lifecycle.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("restore marks a referenced canonical artifact unavailable when its file is missing", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-missing-artifact-"));
  directories.push(parent);
  const library = join(parent, "library");
  const initialized = await initializeLibrary(library);
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c041";
  const artifactHash = `a_${"4".repeat(64)}`;
  await initialized.handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_4567890abcdef123', 1, 1, 1, 1)`,
    [photoId],
  );
  const document = await ensurePhotoDocument(initialized.handle, { photoId, orientation: 1 });
  const source = await initialized.handle.query<{ id: string }>(
    "SELECT id FROM image_nodes WHERE photo_id = $1 AND kind = 'source'",
    [photoId],
  );
  await initialized.handle.query(
    `INSERT INTO image_artifacts
       (artifact_hash, media_type, bytes, w, h, artifact_available)
     VALUES ($1, 'image/tiff', 1, 1, 1, true)`,
    [artifactHash],
  );
  await initialized.handle.query(
    `INSERT INTO node_executions
       (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash)
     VALUES ($1, $2, $3, $4, true, $5)`,
    [photoId, `exec_${"5".repeat(64)}`, source.rows[0]!.id, `eval_${"6".repeat(64)}`, artifactHash],
  );
  const backup = (await createBackup(initialized.handle)).path;
  await initialized.handle.query("DELETE FROM settings WHERE key = 'library_id'");
  await initialized.handle.close();

  const restored = await restoreCommand(
    ["--path", library, "--from", backup],
    { noDaemon: true },
    parent,
  );
  expect(restored).toMatchObject({ ok: true, data: { schema_version: 7 } });
  const verified = await openLibrary(library);
  try {
    const artifact = await verified.query<{ artifact_available: boolean }>(
      "SELECT artifact_available FROM image_artifacts WHERE artifact_hash = $1",
      [artifactHash],
    );
    expect(artifact.rows).toEqual([{ artifact_available: false }]);
    const graph = await verified.query<{ active_revision_id: string }>(
      "SELECT active_revision_id::text FROM photo_documents WHERE photo_id = $1",
      [photoId],
    );
    expect(graph.rows).toEqual([{ active_revision_id: document.revisionId }]);
  } finally {
    await verified.close();
  }
}, 20_000);
