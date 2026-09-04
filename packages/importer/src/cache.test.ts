import { describe, expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEmbeddedJpeg } from "./cache.js";
import { indexEmbeddedJpegs } from "./embedded.js";

describe("pinEmbeddedJpeg", () => {
  test("atomically pins only the selected source range", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    const source = join(directory, "source.arw");
    const cacheRoot = join(directory, "cache");
    try {
      await writeFile(source, Buffer.from("beforeJPEG-BYTESafter"));
      const pinned = await pinEmbeddedJpeg(cacheRoot, "photo-id", source, {
        offset: 6,
        length: 10,
      });

      expect(pinned).toEqual({ path: join(cacheRoot, "emb", "photo-id.jpg"), bytes: 10 });
      expect(await readFile(pinned.path, "utf8")).toBe("JPEG-BYTES");
      expect(await readdir(join(cacheRoot, "emb"))).toEqual(["photo-id.jpg"]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("pins the fixture's culling preview without transcoding it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-test-"));
    const source = join(process.cwd(), "fixtures", "a7c2.ARW");
    try {
      const previews = await indexEmbeddedJpegs(source);
      const preview = previews.find(({ width, height }) => width === 1616 && height === 1080);
      if (!preview) throw new Error("fixture culling preview is missing");
      const pinned = await pinEmbeddedJpeg(directory, "fixture", source, preview);
      const sourceBytes = await readFile(source);

      expect(await readFile(pinned.path)).toEqual(
        sourceBytes.subarray(preview.offset, preview.offset + preview.length),
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
