import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readManifest, readRawManifests } from "@photoctl/test-harness";

const manifests = await readRawManifests();

describe("fixture manifest", () => {
  test.each(manifests)("pins the exact committed original: $file", async (manifest) => {
    const bytes = await readFile(resolve("fixtures", manifest.file));
    expect(bytes.length).toBe(manifest.size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.sha256);
  });

  test("regenerating measured facts preserves authored provenance and decoder expectations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-manifest-"));
    try {
      const file = join(directory, "a7c2-lossless-l.ARW");
      const manifest = await readManifest("a7c2-lossless-l.ARW");
      await copyFile(resolve("fixtures", manifest.file), file);
      const authored = {
        sha256: manifest.sha256,
        provenance: { source: "retained source" },
        libraw: manifest.libraw,
        raw: { compression: -1 },
      };
      await writeFile(file.replace(/\.ARW$/, ".json"), JSON.stringify(authored));
      execFileSync("python3", ["fixtures/tools/manifest.py", file], { timeout: 30_000 });
      const regenerated = JSON.parse(await readFile(file.replace(/\.ARW$/, ".json"), "utf8"));
      expect(regenerated.provenance).toEqual(authored.provenance);
      expect(regenerated.libraw).toEqual(manifest.libraw);
      expect(regenerated.raw).toEqual(manifest.raw);
      expect(regenerated.sha256).toBe(manifest.sha256);
    } finally {
      await rm(directory, { recursive: true });
    }
  }, 30_000);
  test("refuses to carry image-specific annotations onto changed image bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-manifest-changed-"));
    try {
      const manifest = await readManifest("a7c2-lossless-l.ARW");
      const file = join(directory, manifest.file);
      const manifestFile = file.replace(/\.ARW$/, ".json");
      await copyFile(resolve("fixtures", manifest.file), file);
      const authored = JSON.stringify({ ...manifest, sam_probes: [{ subject: "old image" }] });
      await writeFile(manifestFile, authored);
      await appendFile(file, "changed image bytes");
      expect(() =>
        execFileSync("python3", ["fixtures/tools/manifest.py", file], { timeout: 30_000 }),
      ).toThrow(/image SHA-256 changed/);
      expect(await readFile(manifestFile, "utf8")).toBe(authored);
    } finally {
      await rm(directory, { recursive: true });
    }
  }, 30_000);
  test("provides immutable compression facts for every committed RAW mode", async () => {
    expect(manifests.map(({ file, raw }) => [file, raw.compression, raw.defaultCrop])).toEqual([
      ["a7c2-lossless-l.ARW", 7, [7008, 4672]],
      ["a7c2-lossy.ARW", 32767, [7008, 4672]],
      ["a7c2.ARW", 1, [7008, 4672]],
    ]);
  });
  test("records independently measured ARW facts", async () => {
    const manifest = await readManifest();
    expect(manifest.file).toBe("a7c2.ARW");
    expect(manifest.previews.map((preview) => [preview.width, preview.height])).toEqual([
      [160, 120],
      [1616, 1080],
      [7008, 4672],
    ]);
    expect(manifest.exif.OffsetTimeOriginal).toBe("+02:00");
  });
});
