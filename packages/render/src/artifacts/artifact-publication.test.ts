import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  artifactPath,
  normalizeArtifact,
  publishArtifact,
  readArtifactLinear,
} from "./publication.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("canonical artifacts preserve exact scene-linear samples outside the display gamut", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-artifact-"));
  directories.push(library);
  const image = {
    w: 2,
    h: 1,
    data: new Float32Array([-0.25, 0.5, 1.5, 0.125, 2, 4]),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };

  const normalized = await normalizeArtifact(image);
  const first = await publishArtifact(library, normalized);
  const second = await publishArtifact(library, await normalizeArtifact(image));

  expect(first).toEqual(second);
  expect(first.artifactHash).toMatch(/^a_[0-9a-f]{64}$/);
  expect(first.path).toBe(artifactPath(library, first.artifactHash, "tif"));
  expect(first.path).toContain(
    join("artifacts", "sha256", first.artifactHash.slice(2, 4), `${first.artifactHash}.tif`),
  );
  expect(await readFile(first.path)).toEqual(normalized.bytes);
  const restored = await readArtifactLinear(first.path, first.artifactHash);
  expect(restored).toMatchObject({ w: 2, h: 1, space: "scene-linear-rec2020" });
  expect(restored.data).toEqual(image.data);
});

test("publication rejects bytes that do not match their claimed content address", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-artifact-collision-"));
  directories.push(library);
  const normalized = await normalizeArtifact({
    w: 1,
    h: 1,
    data: new Float32Array([1, 2, 3]),
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  const path = artifactPath(library, normalized.artifactHash, normalized.extension);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalized.bytes);
  const invalid = { ...normalized, bytes: Buffer.from("different bytes") };

  await expect(publishArtifact(library, invalid)).rejects.toThrow(
    "does not match its content hash",
  );
  expect(await readFile(path)).toEqual(normalized.bytes);
});
