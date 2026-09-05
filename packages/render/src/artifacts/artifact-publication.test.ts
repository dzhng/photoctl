import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  artifactPath,
  normalizeArtifact,
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactLinear,
  readArtifactMask,
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

test("mask artifacts round-trip exact single-channel coverage without accepting RGB bytes", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-mask-artifact-"));
  directories.push(library);
  const mask = {
    w: 3,
    h: 2,
    data: new Float32Array([0, 0.25, 1, 0.75, 0.5, 0.125]),
  };

  const normalized = await normalizeMaskArtifact(mask);
  const published = await publishArtifact(library, normalized);
  const restored = await readArtifactMask(published.path, published.artifactHash);

  expect(published.mediaType).toBe("image/vnd.photoctl.mask+tiff");
  expect(restored).toEqual(mask);
  await expect(readArtifactLinear(published.path, published.artifactHash)).rejects.toThrow();

  const rgb = await normalizeArtifact({
    w: 1,
    h: 1,
    data: new Float32Array([0, 0.5, 1]),
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  const rgbPublished = await publishArtifact(library, rgb);
  await expect(readArtifactMask(rgbPublished.path, rgbPublished.artifactHash)).rejects.toThrow();
});

test("republishing canonical mask bytes repairs missing and corrupt files", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-mask-repair-"));
  directories.push(library);
  const normalized = await normalizeMaskArtifact({
    w: 2,
    h: 1,
    data: new Float32Array([0.125, 0.875]),
  });
  const original = await publishArtifact(library, normalized);

  await rm(original.path);
  await publishArtifact(library, normalized);
  expect((await readArtifactMask(original.path, original.artifactHash)).data).toEqual(
    new Float32Array([0.125, 0.875]),
  );

  await writeFile(original.path, "corrupt mask");
  await publishArtifact(library, normalized);
  expect(await readFile(original.path)).toEqual(normalized.bytes);
});
