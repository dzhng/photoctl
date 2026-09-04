import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { indexEmbeddedJpegs } from "./embedded.js";

describe("indexEmbeddedJpegs", () => {
  test("finds the fixture previews named by its independent manifest", async () => {
    const previews = await indexEmbeddedJpegs(resolve("fixtures/a7c2.ARW"));
    const manifest = JSON.parse(await readFile(resolve("fixtures/a7c2.json"), "utf8")) as {
      previews: typeof previews;
    };

    expect(previews).toEqual(manifest.previews);
  });

  test("refuses a TIFF directory outside the source file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-tiff-test-"));
    const path = join(directory, "broken.arw");
    const header = Buffer.alloc(8);
    header.write("II");
    header.writeUInt16LE(42, 2);
    header.writeUInt32LE(100, 4);
    await writeFile(path, header);

    try {
      await expect(indexEmbeddedJpegs(path)).rejects.toThrow("outside the file");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("reads a big-endian TIFF directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-tiff-test-"));
    const path = join(directory, "preview.tiff");
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x78, 0x00, 0xa0, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    const tiff = Buffer.alloc(38 + jpeg.length);
    tiff.write("MM");
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(2, 8);
    writeLongEntry(tiff, 10, 0x0201, 38);
    writeLongEntry(tiff, 22, 0x0202, jpeg.length);
    jpeg.copy(tiff, 38);
    await writeFile(path, tiff);

    try {
      await expect(indexEmbeddedJpegs(path)).resolves.toEqual([
        { width: 160, height: 120, offset: 38, length: 17 },
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

function writeLongEntry(buffer: Buffer, offset: number, tag: number, value: number): void {
  buffer.writeUInt16BE(tag, offset);
  buffer.writeUInt16BE(4, offset + 2);
  buffer.writeUInt32BE(1, offset + 4);
  buffer.writeUInt32BE(value, offset + 8);
}
