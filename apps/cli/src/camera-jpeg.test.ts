import { copyFile, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { importDataSchema, showDataSchema } from "@photoctl/protocol";
import { spawnPhotoctl } from "@photoctl/test-harness";

test.each([
  ["DSC07730.JPG", 4672, 7008, "2026-01-21T20:19:03+08:00"],
  ["DSC09903.JPG", 3072, 4608, "2026-06-22T12:32:24+07:00"],
  ["DSC08819.JPG", 4608, 3072, "2026-06-13T17:16:27+07:00"],
] as const)(
  "camera JPEG %s retains metadata and upright pixels through import, offline preview and delivery",
  async (file, width, height, shot) => {
    const original = resolve("fixtures/camera", file);
    const directory = await mkdtemp(join(tmpdir(), "photoctl-camera-jpeg-"));
    const source = join(directory, file);
    const library = join(directory, "library");
    const output = join(directory, "delivery");
    const env = {
      PHOTOCTL_CACHE: join(directory, "cache"),
      PHOTOCTL_VOLUME_MAP: `${directory}=camera-test:online`,
      AI_GATEWAY_API_KEY: "",
    };
    const run = (args: string[], overrides = {}) =>
      spawnPhotoctl(args, { libraryDir: library, env: { ...env, ...overrides } });
    try {
      const manifest = JSON.parse(await readFile(`${original}.json`, "utf8"));
      expect(await sha256(original)).toBe(manifest.sha256);
      await copyFile(original, source);
      expect((await run(["init", "--path", library])).code).toBe(0);
      const imported = await run(["import", source, "--link"]);
      expect(imported.code).toBe(0);
      if (!imported.json.ok || !("data" in imported.json)) throw new Error("Import failed");
      const data = importDataSchema.parse(imported.json.data);
      expect(data).toMatchObject({ imported: 1, skipped_unsupported: 0 });
      const [id] = data.ids;
      const shown = await run(["show", id]);
      expect(shown.code).toBe(0);
      if (!shown.json.ok || !("data" in shown.json)) throw new Error("Show failed");
      const view = showDataSchema.parse(shown.json.data);
      expect(view).toMatchObject({
        dims: { w: width, h: height, orientation: manifest.orientation },
        camera: { make: "SONY", model: "ILCE-7CM2" },
        exposure: { iso: manifest.exif.ISO, f: manifest.exif.FNumber },
        shot,
        locators: [{ path: file, online: true }],
      });
      await expectUprightPixels(view.preview, original);

      await rename(source, `${source}.disconnected`);
      const offline = await run(["show", id, "--preview-size", "640"], {
        PHOTOCTL_VOLUME_MAP: `${directory}=camera-test:offline`,
      });
      expect(offline.code).toBe(0);
      if (!offline.json.ok || !("data" in offline.json)) throw new Error("Offline show failed");
      const cached = showDataSchema.parse(offline.json.data);
      expect(cached.dims).toEqual(view.dims);
      expect(cached.preview_info.source_tier).toBe("pinned-preview");
      expect(offline.json.warnings).toEqual(
        expect.arrayContaining([{ code: "source_offline", id, message: expect.any(String) }]),
      );
      await expectUprightPixels(cached.preview, original);
      await rename(`${source}.disconnected`, source);

      await mkdir(output);
      const exported = await run(["export", id, "--to", output]);
      expect(exported.code).toBe(0);
      expect(exported.json).toMatchObject({
        summary: { ok: 1, failed: 0 },
        results: [{ id, w: width, h: height }],
      });
      const delivered = join(output, file.replace(".JPG", ".jpg"));
      await expect(sharp(delivered).metadata()).resolves.toMatchObject({
        format: "jpeg",
        width,
        height,
        hasProfile: true,
      });
      await expectUprightPixels(delivered, original);
      expect(await sha256(source)).toBe(manifest.sha256);
      const repeated = await run(["import", source, "--link"]);
      expect(repeated.json).toMatchObject({ data: { imported: 0, already_present: 1, ids: [id] } });
      const second = join(directory, "second.JPG");
      await copyFile(source, second);
      const relocated = await run(["import", second, "--link"]);
      expect(relocated.json).toMatchObject({
        data: { imported: 0, already_present: 1, ids: [id] },
      });
      const located = await run(["show", id]);
      expect(located.json).toMatchObject({
        data: {
          id,
          locators: expect.arrayContaining([
            expect.objectContaining({ path: file, online: true }),
            expect.objectContaining({ path: "second.JPG", online: true }),
          ]),
        },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);

async function expectUprightPixels(actual: string, original: string) {
  expect((await sharp(actual).metadata()).orientation ?? 1).toBe(1);
  const [result, expected] = await Promise.all(
    [sharp(actual), sharp(original).rotate()].map((image) =>
      image.resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer(),
    ),
  );
  expect(result.length).toBe(expected.length);
  const distance = (reference: Buffer) => {
    let difference = 0;
    for (let index = 0; index < result.length; index += 1)
      difference += Math.abs(result[index] - reference[index]);
    return difference / result.length;
  };
  const wrongRotations = await Promise.all(
    [90, 180, 270].map(async (angle) =>
      distance(
        await sharp(expected, { raw: { width: 64, height: 64, channels: 3 } })
          .rotate(angle)
          .raw()
          .toBuffer(),
      ),
    ),
  );
  // This is an orientation oracle, not color parity: production's linear-light
  // downsampling differs from Sharp's display-space thumbnail of the original.
  expect(distance(expected)).toBeLessThan(Math.min(...wrongRotations) / 4);
}

async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
