import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { encodeDisplayTiff } from "../linear-tiff.js";
import { reconcileArtifactAvailability } from "./availability.js";
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
