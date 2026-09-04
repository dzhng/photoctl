import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { ExportSourceUnavailableError, exportEmbeddedJpeg } from "../index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("an online orientation-one export preserves the embedded JPEG bytes exactly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-"));
  directories.push(directory);
  const sourcePath = resolve("fixtures/a7c2.ARW");
  const manifest = JSON.parse(await readFile(resolve("fixtures/a7c2.json"), "utf8")) as {
    previews: Array<{ width: number; height: number; offset: number; length: number }>;
  };
  const embedded = manifest.previews[0];
  if (!embedded) throw new Error("Fixture manifest has no embedded JPEG");
  const source = await readFile(sourcePath);
  const jpeg = source.subarray(embedded.offset, embedded.offset + embedded.length);
  const outputPath = join(directory, "output.jpg");

  const exported = await exportEmbeddedJpeg({
    id: "photo-id",
    orientation: 1,
    outputPath,
    online: {
      path: sourcePath,
      offset: embedded.offset,
      length: embedded.length,
      w: embedded.width,
      h: embedded.height,
    },
  });

  expect(await readFile(outputPath)).toEqual(jpeg);
  expect(exported).toEqual({
    file: outputPath,
    w: embedded.width,
    h: embedded.height,
    bytes: jpeg.length,
    warnings: [],
  });
});

test("an online non-identity orientation renders instead of copying un-oriented bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-oriented-"));
  directories.push(directory);
  const jpeg = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "#8040c0" },
  })
    .jpeg()
    .toBuffer();
  const sourcePath = join(directory, "source.raw");
  const outputPath = join(directory, "output.jpg");
  await writeFile(sourcePath, jpeg);

  const exported = await exportEmbeddedJpeg({
    id: "photo-id",
    orientation: 6,
    outputPath,
    online: { path: sourcePath, offset: 0, length: jpeg.length, w: 2, h: 3 },
  });

  expect(await sharp(outputPath).metadata()).toMatchObject({ width: 3, height: 2, format: "jpeg" });
  expect(await readFile(outputPath)).not.toEqual(jpeg);
  expect(exported).toMatchObject({ w: 3, h: 2, warnings: [] });
});

test("an unavailable online source renders the pinned tier with an offline warning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-offline-"));
  directories.push(directory);
  const pinnedPath = join(directory, "pinned.jpg");
  const outputPath = join(directory, "output.jpg");
  await sharp({
    create: { width: 2, height: 3, channels: 3, background: "#4080c0" },
  })
    .jpeg()
    .toFile(pinnedPath);

  const exported = await exportEmbeddedJpeg({
    id: "photo-id",
    orientation: 6,
    outputPath,
    online: {
      path: join(directory, "unavailable.raw"),
      offset: 40,
      length: 100,
      w: 2,
      h: 3,
    },
    pinnedPath,
  });

  expect(await sharp(outputPath).metadata()).toMatchObject({ width: 3, height: 2, format: "jpeg" });
  expect(exported).toMatchObject({
    file: outputPath,
    w: 3,
    h: 2,
    warnings: [
      {
        code: "source_offline",
        id: "photo-id",
        message: "Exported from the pinned embedded preview because the original is offline",
      },
    ],
  });
  expect(exported.bytes).toBe((await readFile(outputPath)).length);
});

test("an export with no readable original or pinned tier reports file_offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-missing-"));
  directories.push(directory);

  await expect(
    exportEmbeddedJpeg({
      id: "missing-photo",
      orientation: 1,
      outputPath: join(directory, "output.jpg"),
    }),
  ).rejects.toEqual(
    expect.objectContaining<Partial<ExportSourceUnavailableError>>({
      code: "file_offline",
      photoId: "missing-photo",
    }),
  );
});

test("an unreadable pinned tier reports file_offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-missing-pin-"));
  directories.push(directory);

  await expect(
    exportEmbeddedJpeg({
      id: "missing-photo",
      orientation: 1,
      outputPath: join(directory, "output.jpg"),
      online: { path: join(directory, "offline.raw"), offset: 0, length: 100, w: 3, h: 2 },
      pinnedPath: join(directory, "missing-pinned.jpg"),
    }),
  ).rejects.toMatchObject({ code: "file_offline", photoId: "missing-photo" });
});
