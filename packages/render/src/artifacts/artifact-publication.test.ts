import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { artifactPath, normalizeArtifact, publishArtifact } from "./publication.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("canonical pixels publish once at their full content address", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-artifact-"));
  directories.push(library);
  const image = {
    w: 2,
    h: 1,
    channels: 3 as const,
    data: new Uint16Array([0, 16_384, 65_535, 4_096, 32_768, 49_152]),
    space: "display-srgb" as const,
    orientationApplied: true as const,
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
  expect(await sharp(normalized.bytes).metadata()).toMatchObject({
    format: "tiff",
    width: 2,
    height: 1,
    depth: "ushort",
    bitsPerSample: 16,
  });
});

test("publication rejects bytes that do not match their claimed content address", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-artifact-collision-"));
  directories.push(library);
  const normalized = await normalizeArtifact({
    w: 1,
    h: 1,
    channels: 3,
    data: new Uint16Array([1, 2, 3]),
    space: "display-srgb",
    orientationApplied: true,
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
