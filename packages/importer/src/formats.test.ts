import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import { probeImage } from "./formats.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("probeImage", () => {
  test.each([
    ["jpeg", "unknown.bin"],
    ["png", "wrong.jpg"],
    ["tiff", "no-extension"],
  ] as const)("recognizes %s bytes independently of the filename", async (format, filename) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-probe-"));
    temporaryDirectories.push(directory);
    const path = join(directory, filename);
    await writeFile(
      path,
      await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
        .toFormat(format)
        .toBuffer(),
    );

    await expect(probeImage(path)).resolves.toMatchObject({
      kind: "image",
      dimensions: { w: 3, h: 2 },
      frameCount: 1,
      preview: { kind: "decoded-file" },
    });
  });

  test("recognizes the RAW fixture through its embedded full-frame previews", async () => {
    await expect(probeImage(join(process.cwd(), "fixtures", "a7c2.ARW"))).resolves.toMatchObject({
      kind: "raw",
      dimensions: { w: 7008, h: 4672 },
      frameCount: 1,
      preview: { kind: "embedded-jpeg" },
    });
  });

  test("rejects corrupt and animated image bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-probe-"));
    temporaryDirectories.push(directory);
    const corrupt = join(directory, "corrupt.jpg");
    const animated = join(directory, "animated.gif");
    const frames = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]);
    await writeFile(corrupt, "not an image");
    await writeFile(
      animated,
      await sharp(frames, {
        raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
        animated: true,
      })
        .gif({ delay: [10, 10] })
        .toBuffer(),
    );

    await expect(probeImage(corrupt)).resolves.toBeUndefined();
    await expect(probeImage(animated)).resolves.toBeUndefined();
  });
});
