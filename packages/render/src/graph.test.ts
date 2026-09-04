import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { renderPhoto } from "./index.js";

test("the embedded source becomes an oriented display-referred 16-bit image", async () => {
  const jpeg = await sharp(
    new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 255, 0, 255, 0, 255, 255]),
    { raw: { width: 2, height: 3, channels: 3 } },
  )
    .resize({ width: 20, height: 30, kernel: "nearest" })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const directory = await mkdtemp(join(tmpdir(), "photoctl-graph-"));
  const source = join(directory, "source.jpg");
  await writeFile(source, jpeg);

  const image = await renderPhoto(
    { orientation: 6 },
    { kind: "online-file", path: source, mediaType: "image/jpeg", w: 20, h: 30 },
  );

  expect(image).toMatchObject({
    w: 30,
    h: 20,
    channels: 3,
    space: "display-srgb",
    orientationApplied: true,
  });
  expect(image.data).toBeInstanceOf(Uint16Array);
  expect(image.data).toHaveLength(30 * 20 * 3);
  expectColor(pixelAt(image.data, image.w, 1, 1), [true, false, true]);
  expectColor(pixelAt(image.data, image.w, 28, 1), [true, false, false]);
  expectColor(pixelAt(image.data, image.w, 1, 18), [false, true, true]);
  expectColor(pixelAt(image.data, image.w, 28, 18), [false, true, false]);
  await rm(directory, { recursive: true });
});

function pixelAt(data: Uint16Array, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 3;
  return Array.from(data.subarray(offset, offset + 3));
}

function expectColor(channels: number[], bright: [boolean, boolean, boolean]): void {
  for (const [index, expectedBright] of bright.entries()) {
    if (expectedBright) expect(channels[index]).toBeGreaterThan(60_000);
    else expect(channels[index]).toBeLessThan(2_000);
  }
}
