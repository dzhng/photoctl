import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import sharp from "sharp";
import { GatewayImageModelAdapter } from "@photoctl/providers";
import {
  artifactPath,
  normalizeArtifact,
  normalizeEncodedArtifact,
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactLinear,
  readArtifactMask,
  readEncodedArtifactBytes,
} from "./publication.js";

const directories: string[] = [];

test.each(["rgb-nan", "mask-range"] as const)(
  "a decodable %s TIFF remains retainable but cannot qualify as working pixels",
  async (kind) => {
    const library = await mkdtemp(join(tmpdir(), "photoctl-original-invalid-samples-"));
    directories.push(library);
    const valid =
      kind === "mask-range"
        ? await normalizeMaskArtifact({ w: 1, h: 1, data: new Float32Array([0.5]) })
        : await normalizeArtifact({
            w: 1,
            h: 1,
            data: new Float32Array([0.25, 0.5, 1]),
            space: "scene-linear-rec2020",
            orientationApplied: true,
            whiteLevel: 1,
            blackLevel: 0,
            wbPreApplied: true,
          });
    expect(await normalizeEncodedArtifact(valid.bytes)).toEqual(valid);
    const bytes = Buffer.from(valid.bytes);
    bytes.writeFloatLE(kind === "mask-range" ? 1.5 : Number.NaN, bytes.length - 4);
    const encoded = await normalizeEncodedArtifact(bytes);
    expect(encoded).toMatchObject({
      mediaType: "image/tiff",
      validationProfile: "encoded-image",
      w: 1,
      h: 1,
    });
    const artifact = await publishArtifact(library, encoded);
    expect(await readEncodedArtifactBytes(artifact.path, artifact.artifactHash, encoded)).toEqual(
      bytes,
    );
    await expect(readArtifactLinear(artifact.path, artifact.artifactHash)).rejects.toThrow();
    await expect(readArtifactMask(artifact.path, artifact.artifactHash)).rejects.toThrow();
  },
);

test.each([
  "metadata-png",
  "jpeg-oriented",
  "webp",
  "tiff",
  "gif",
  "svg",
  "avif",
  "multipage-gif",
  "multipage-webp",
  "multipage-tiff",
] as const)("retention preserves accepted %s bytes and first-frame dimensions", async (format) => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-original-format-"));
  directories.push(library);
  const pixels = Buffer.alloc(7 * 5 * 4, 180);
  const source = sharp(pixels, { raw: { width: 7, height: 5, channels: 4 } });
  const animation = sharp(Buffer.concat([pixels, Buffer.alloc(pixels.length, 80)]), {
    raw: { width: 7, height: 10, channels: 4, pageHeight: 5 },
  });
  const bytes =
    format === "metadata-png"
      ? await source.withMetadata({ density: 123 }).png().toBuffer()
      : format === "jpeg-oriented"
        ? await source.withMetadata({ orientation: 6 }).jpeg().toBuffer()
        : format === "webp"
          ? await source.webp().toBuffer()
          : format === "tiff"
            ? await source.tiff().toBuffer()
            : format === "gif"
              ? await source.gif().toBuffer()
              : format === "svg"
                ? Buffer.from(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="5"><rect width="7" height="5" fill="red"/></svg>',
                  )
                : format === "avif"
                  ? await source.avif().toBuffer()
                  : format === "multipage-gif"
                    ? await animation.gif().toBuffer()
                    : format === "multipage-webp"
                      ? await animation.webp().toBuffer()
                      : await animation.tiff().toBuffer();
  const adapter = new GatewayImageModelAdapter({
    model: "fixture",
    mask: "native",
    maskPolarity: "unverified",
  });
  const normalized = await adapter.normalize(
    { data: [{ b64_json: bytes.toString("base64") }] },
    { w: 7, h: 5 },
  );
  expect(normalized.returnedDimensions).toEqual({ w: 7, h: 5 });
  const artifact = await normalizeEncodedArtifact(bytes);
  expect(artifact).toMatchObject({ w: 7, h: 5, validationProfile: "encoded-image" });
  const published = await publishArtifact(library, artifact);
  expect(await readEncodedArtifactBytes(published.path, published.artifactHash, artifact)).toEqual(
    bytes,
  );
  if (format.startsWith("multipage-"))
    expect((await sharp(await readFile(published.path)).metadata()).pages).toBe(2);
  if (format === "jpeg-oriented")
    expect((await sharp(await readFile(published.path)).metadata()).orientation).toBe(6);
  await expect(readArtifactLinear(published.path, published.artifactHash)).rejects.toThrow();
});

test("encoded retention shares canonical TIFF content identity without weakening its samples", async () => {
  const library = await mkdtemp(join(tmpdir(), "photoctl-original-artifact-"));
  directories.push(library);
  const working = await normalizeArtifact({
    w: 1,
    h: 1,
    data: new Float32Array([-0.25, 0.5, 2]),
    space: "scene-linear-rec2020",
    orientationApplied: true,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  });
  const original = await normalizeEncodedArtifact(working.bytes);
  expect(original).toEqual(working);
  const published = await publishArtifact(library, original);
  expect(await publishArtifact(library, working)).toEqual(published);
  expect((await readArtifactLinear(published.path, published.artifactHash)).data).toEqual(
    new Float32Array([-0.25, 0.5, 2]),
  );
});

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
