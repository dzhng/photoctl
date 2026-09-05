import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { resampleDisplaySrgb8 } from "@photoctl/img";
import { srgb2014ProfilePath } from "@photoctl/render";
import {
  createDecodedPreviewJpeg,
  pinEmbeddedJpeg,
  PinnedPreviewDestinationError,
  PinnedPreviewSourceError,
} from "./cache.js";
import { indexEmbeddedJpegs } from "./embedded.js";

describe("pinEmbeddedJpeg", () => {
  test("atomically pins only the selected source range", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    const source = join(directory, "source.arw");
    const cacheRoot = join(directory, "cache");
    try {
      const jpeg = await sharp({
        create: { width: 3, height: 2, channels: 3, background: "red" },
      })
        .jpeg()
        .toBuffer();
      await writeFile(source, Buffer.concat([Buffer.from("before"), jpeg, Buffer.from("after")]));
      const pinned = await pinEmbeddedJpeg(
        cacheRoot,
        "photo-id",
        source,
        { offset: 6, length: jpeg.length },
        1,
      );

      expect(pinned.path).toBe(join(cacheRoot, "emb", "photo-id.jpg"));
      expect(pinned.bytes).toBeGreaterThan(0);
      await expect(sharp(pinned.path).metadata()).resolves.toMatchObject({
        width: 3,
        height: 2,
        hasProfile: true,
      });
      expect(await readdir(join(cacheRoot, "emb"))).toEqual(["photo-id.jpg"]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("pins the fixture's culling preview as an opaque tagged sRGB JPEG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    const source = join(process.cwd(), "fixtures", "a7c2.ARW");
    try {
      const previews = await indexEmbeddedJpegs(source);
      const preview = previews.find(({ width, height }) => width === 1616 && height === 1080);
      if (!preview) throw new Error("fixture culling preview is missing");
      const pinned = await pinEmbeddedJpeg(directory, "fixture", source, preview, 1);
      const metadata = await sharp(pinned.path).metadata();
      expect(metadata).toMatchObject({
        format: "jpeg",
        width: 1616,
        height: 1080,
        channels: 3,
        hasAlpha: false,
        hasProfile: true,
      });
      expect(metadata.icc).toEqual(await readFile(srgb2014ProfilePath));
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("applies container orientation while making the pinned preview", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-orientation-"));
    const source = join(directory, "source.raw");
    try {
      const jpeg = await sharp({
        create: { width: 3, height: 2, channels: 3, background: "red" },
      })
        .jpeg()
        .toBuffer();
      await writeFile(source, jpeg);
      const pinned = await pinEmbeddedJpeg(
        directory,
        "oriented",
        source,
        { offset: 0, length: jpeg.length },
        6,
      );
      await expect(sharp(pinned.path).metadata()).resolves.toMatchObject({ width: 2, height: 3 });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("identifies a source read failure independently of the destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    try {
      await expect(
        pinEmbeddedJpeg(
          directory,
          "photo-id",
          join(directory, "missing.arw"),
          { offset: 0, length: 1 },
          1,
        ),
      ).rejects.toBeInstanceOf(PinnedPreviewSourceError);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("identifies a cache write failure independently of the source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    const source = join(directory, "source.arw");
    const cacheRoot = join(directory, "cache-file");
    try {
      const jpeg = await sharp({
        create: { width: 3, height: 2, channels: 3, background: "red" },
      })
        .jpeg()
        .toBuffer();
      await writeFile(source, jpeg);
      await writeFile(cacheRoot, "not a directory");
      await expect(
        pinEmbeddedJpeg(cacheRoot, "photo-id", source, { offset: 0, length: jpeg.length }, 1),
      ).rejects.toBeInstanceOf(PinnedPreviewDestinationError);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

test("decoded preview pixels use the native bilinear route before JPEG encoding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-resample-"));
  const source = join(directory, "source.png");
  const width = 2_000;
  const height = 6;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = (index * 37) % 256;
  try {
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(source);
    const actual = await createDecodedPreviewJpeg(source);
    const { data, info } = await sharp(source)
      .rotate()
      .flatten({ background: "white" })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const outputWidth = 1_616;
    const outputHeight = Math.max(1, Math.round((height * outputWidth) / width));
    const resized = resampleDisplaySrgb8(data, info.width, info.height, outputWidth, outputHeight);
    const expected = await sharp(resized, {
      raw: { width: outputWidth, height: outputHeight, channels: 3 },
    })
      .jpeg({ quality: 88 })
      .withIccProfile(srgb2014ProfilePath)
      .toBuffer();

    expect(actual).toEqual(expected);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("concurrent preview creation admits only one decoded raster at a time", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-admission-"));
  const first = join(directory, "first.png");
  const second = join(directory, "second.png");
  const probe = sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } });
  const prototype = Object.getPrototypeOf(probe) as {
    toBuffer: typeof probe.toBuffer;
  };
  const originalToBuffer = prototype.toBuffer;
  let activeDecodedRasters = 0;
  let peakDecodedRasters = 0;
  prototype.toBuffer = function (...arguments_: unknown[]) {
    const result = Reflect.apply(originalToBuffer, this, arguments_);
    const options = arguments_[0] as { resolveWithObject?: boolean } | undefined;
    if (!options?.resolveWithObject) return result;
    activeDecodedRasters += 1;
    peakDecodedRasters = Math.max(peakDecodedRasters, activeDecodedRasters);
    return Promise.resolve(result).finally(() => {
      activeDecodedRasters -= 1;
    });
  } as typeof originalToBuffer;
  try {
    await Promise.all([
      sharp({ create: { width: 2_000, height: 6, channels: 3, background: "red" } })
        .png()
        .toFile(first),
      sharp({ create: { width: 2_000, height: 6, channels: 3, background: "blue" } })
        .png()
        .toFile(second),
    ]);
    await Promise.all([createDecodedPreviewJpeg(first), createDecodedPreviewJpeg(second)]);

    expect(peakDecodedRasters).toBe(1);
  } finally {
    prototype.toBuffer = originalToBuffer;
    await rm(directory, { recursive: true });
  }
});
