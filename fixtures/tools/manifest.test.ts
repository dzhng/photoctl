import { describe, expect, test } from "vitest";
import { readManifest } from "@photoctl/test-harness";

describe("fixture manifest", () => {
  test("records independently measured ARW facts", async () => {
    const manifest = await readManifest();
    expect(manifest.file).toBe("a7c2.ARW");
    expect(manifest.previews.map((preview) => [preview.width, preview.height])).toEqual([
      [160, 120], [1616, 1080], [7008, 4672],
    ]);
    expect(manifest.exif.OffsetTimeOriginal).toBe("+02:00");
  });
});
