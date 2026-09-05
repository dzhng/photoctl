import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { readRawManifests, spawnPhotoctl } from "@photoctl/test-harness";

test.each(await readRawManifests())(
  "the built CLI decodes the LibRaw fixture: $file",
  async (manifest) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-libraw-cli-"));
    const library = join(parent, "library");
    const output = join(parent, "libraw.tif");
    const fixture = resolve("fixtures", manifest.file);
    const [w, h] = manifest.raw.defaultCrop.map((value) => Math.floor(value / 4));
    const env = {
      PHOTOCTL_CACHE: join(parent, "cache"),
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
    };
    try {
      expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
      const imported = await spawnPhotoctl(["import", fixture, "--link"], {
        libraryDir: library,
        env,
      });
      expect(imported.code, JSON.stringify(imported.json)).toBe(0);
      const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

      const decoded = await spawnPhotoctl(
        ["decode", id, "--with", "libraw", "--scale", "0.25", "--to", output],
        { libraryDir: library, env },
      );
      expect(decoded.code).toBe(0);
      expect(decoded.json).toMatchObject({
        schema: 1,
        ok: true,
        data: {
          id,
          decoder: "libraw",
          file: output,
          w,
          h,
          space: "scene-linear-rec2020",
        },
        warnings: [],
      });
      expect(await sharp(output).metadata()).toMatchObject({
        format: "tiff",
        width: w,
        height: h,
        bitsPerSample: 16,
      });

      const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
      expect(doctor.code).toBe(0);
      expect(doctor.json).toMatchObject({
        data: {
          decoders: [{ id: "ciraw" }, { id: "libraw", available: true, version: "0.22.2-Release" }],
        },
      });
    } finally {
      await rm(parent, { recursive: true });
    }
  },
  120_000,
);
