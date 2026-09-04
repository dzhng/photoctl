import exifr from "exifr";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { renderSource } from "../source-render.js";
import { exportImage } from "./run.js";

const directories: string[] = [];

async function decodedImage(path: string, mediaType: "image/jpeg" | "image/png") {
  return await renderSource(1, { kind: "online-file", path, mediaType, copyExact: false });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("delivery resize constrains the long edge and never enlarges smaller originals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-resize-"));
  directories.push(directory);
  const source = join(directory, "source.jpg");
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#369" } })
    .jpeg()
    .toFile(source);

  const reduced = await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/jpeg"),
    outputPath: join(directory, "reduced.jpg"),
    format: "jpeg",
    quality: 88,
    resize: 600,
    metadata: {},
  });
  const preserved = await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/jpeg"),
    outputPath: join(directory, "preserved.jpg"),
    format: "jpeg",
    quality: 88,
    resize: 9000,
    metadata: {},
  });

  expect(reduced).toMatchObject({ w: 600, h: 400 });
  expect(preserved).toMatchObject({ w: 1200, h: 800 });
});

test("delivery resize keeps both dimensions positive for extreme aspect ratios", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-thin-"));
  directories.push(directory);
  const source = join(directory, "source.png");
  await sharp({ create: { width: 10_000, height: 1, channels: 3, background: "#369" } })
    .png()
    .toFile(source);

  const exported = await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/png"),
    outputPath: join(directory, "thin.png"),
    format: "png",
    quality: 88,
    resize: 1,
    metadata: {},
  });

  expect(exported).toMatchObject({ w: 1, h: 1 });
});

test("delivery JPEG embeds the fixed ICC plus XMP and EXIF creator and copyright fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-metadata-"));
  directories.push(directory);
  const source = join(directory, "source.jpg");
  const outputPath = join(directory, "delivery.jpg");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#369" } })
    .jpeg()
    .toFile(source);

  await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/jpeg"),
    outputPath,
    format: "jpeg",
    quality: 88,
    metadata: { creator: "David Z", copyright: "Copyright 2026 David" },
  });

  const sharpMetadata = await sharp(outputPath).metadata();
  const tags = (await exifr.parse(outputPath, { xmp: true, exif: true })) as Record<
    string,
    unknown
  >;
  expect(sharpMetadata.icc).toBeInstanceOf(Buffer);
  expect(tags).toMatchObject({
    Artist: "David Z",
    Copyright: "Copyright 2026 David",
    creator: "David Z",
    rights: { lang: "x-default", value: "Copyright 2026 David" },
  });
});

test("PNG and TIFF exports preserve requested format and TIFF uses 16-bit samples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-formats-"));
  directories.push(directory);
  const source = join(directory, "source.jpg");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#369" } })
    .jpeg()
    .toFile(source);

  const outputs = await Promise.all(
    (["png", "tiff"] as const).map(async (format) => {
      const outputPath = join(directory, `delivery.${format === "tiff" ? "tif" : format}`);
      await exportImage({
        id: "photo-id",
        image: await decodedImage(source, "image/jpeg"),
        outputPath,
        format,
        quality: 88,
        metadata: {},
      });
      return { format, metadata: await sharp(outputPath).metadata() };
    }),
  );
  for (const { format, metadata } of outputs) {
    expect(metadata.format).toBe(format);
    if (format === "tiff") expect(metadata.depth).toBe("ushort");
  }
});

test("16-bit TIFF encoding preserves channel values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-tiff-values-"));
  directories.push(directory);
  const source = join(directory, "red.png");
  const outputPath = join(directory, "red.tif");
  await sharp({ create: { width: 2, height: 1, channels: 3, background: "#f00000" } })
    .png()
    .toFile(source);

  await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/png"),
    outputPath,
    format: "tiff",
    quality: 88,
    metadata: {},
  });

  const { data, info } = await sharp(outputPath, { ignoreIcc: true })
    .removeAlpha()
    .toColourspace("rgb16")
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  const samples = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  expect(info).toMatchObject({ width: 2, height: 1, channels: 3, depth: "ushort" });
  const values = Array.from(samples);
  expect(values[0]).toBeGreaterThan(60_000);
  expect(values[1]).toBeLessThan(2_000);
  expect(values[2]).toBeLessThan(2_000);
  expect(values.slice(3)).toEqual(values.slice(0, 3));
});

test("TIFF preserves EXIF and XMP delivery metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-tiff-metadata-"));
  directories.push(directory);
  const source = join(directory, "source.png");
  const outputPath = join(directory, "delivery.tif");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#369" } })
    .png()
    .toFile(source);

  await exportImage({
    id: "photo-id",
    image: await decodedImage(source, "image/png"),
    outputPath,
    format: "tiff",
    quality: 88,
    metadata: { creator: "David Z", copyright: "Copyright 2026 David" },
  });

  const tags = (await exifr.parse(outputPath, { xmp: true, exif: true })) as Record<
    string,
    unknown
  >;
  expect(tags).toMatchObject({
    Artist: "David Z",
    Copyright: "Copyright 2026 David",
    creator: "David Z",
    rights: { lang: "x-default", value: "Copyright 2026 David" },
  });
});

test("delivery publication replaces an existing file only when explicitly requested", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-delivery-publish-"));
  directories.push(directory);
  const firstSource = join(directory, "first.jpg");
  const secondSource = join(directory, "second.jpg");
  const outputPath = join(directory, "delivery.jpg");
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#369" } })
    .jpeg()
    .toFile(firstSource);
  await sharp({ create: { width: 20, height: 10, channels: 3, background: "#c43" } })
    .jpeg()
    .toFile(secondSource);
  const request = async (source: string) => ({
    id: "photo-id",
    image: await decodedImage(source, "image/jpeg"),
    outputPath,
    format: "jpeg" as const,
    quality: 88,
    metadata: {},
  });

  await exportImage(await request(firstSource));
  const original = await readFile(outputPath);
  await expect(exportImage(await request(secondSource))).rejects.toMatchObject({
    code: "volume_readonly",
  });
  expect(await readFile(outputPath)).toEqual(original);
  await exportImage({ ...(await request(secondSource)), replace: true });
  expect(await readFile(outputPath)).not.toEqual(original);
});
