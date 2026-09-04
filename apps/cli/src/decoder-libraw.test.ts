import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";

test("the built CLI probes and decodes the LibRaw fixture", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-libraw-cli-"));
  const library = join(parent, "library");
  const output = join(parent, "libraw.tif");
  const fixture = resolve("fixtures/a7c2.ARW");
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
        w: 1752,
        h: 1168,
        space: "scene-linear-rec2020",
      },
      warnings: [],
    });
    expect(await sharp(output).metadata()).toMatchObject({
      format: "tiff",
      width: 1752,
      height: 1168,
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
}, 120_000);
