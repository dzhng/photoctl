import { spawnPhotoctl } from "@photoctl/test-harness";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("every accepted file image has the same source-independent offline JPEG preview", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-offline-preview-"));
  temporaryDirectories.push(parent);
  const sources = join(parent, "sources");
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  await mkdir(sources);
  const inputs = [
    ["jpeg.unknown", "jpeg"],
    ["png.jpg", "png"],
    ["tiff", "tiff"],
  ] as const;
  await Promise.all(
    inputs.map(async ([name, format]) =>
      writeFile(
        join(sources, name),
        await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
          .toFormat(format)
          .toBuffer(),
      ),
    ),
  );
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const onlineEnv = {
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online`,
  };
  const imported = await inputs.reduce<Promise<Awaited<ReturnType<typeof spawnPhotoctl>>[]>>(
    async (previous, [name]) => [
      ...(await previous),
      await spawnPhotoctl(["import", join(sources, name), "--link"], {
        libraryDir: library,
        env: onlineEnv,
      }),
    ],
    Promise.resolve([]),
  );

  await Promise.all(
    imported.map(async (result) => {
      expect(result.code).toBe(0);
      const id = (result.json as { data: { ids: string[] } }).data.ids[0];
      const shown = await spawnPhotoctl(["show", id], {
        libraryDir: library,
        env: { ...onlineEnv, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:offline` },
      });
      expect(shown.code).toBe(0);
      const preview = (shown.json as { data: { preview: string } }).data.preview;
      expect(preview).toContain(id);
      expect((await stat(preview)).isFile()).toBe(true);
      expect((await readFile(preview)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      const metadata = await sharp(preview).metadata();
      expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(1616);
    }),
  );
}, 30_000);

test("copy imports preserve the same contract from a library-owned original", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-copy-preview-"));
  temporaryDirectories.push(parent);
  const source = join(parent, "source.unknown");
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  await writeFile(
    source,
    await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer(),
  );
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const env = { PHOTOCTL_CACHE: cache, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` };
  const imported = await spawnPhotoctl(["import", source, "--copy"], {
    libraryDir: library,
    env,
  });
  expect(imported.code).toBe(0);
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });
  expect(shown.json).toMatchObject({
    data: {
      id,
      preview: expect.stringContaining(id),
      locators: [{ path: expect.stringContaining("originals/") }],
    },
  });
  expect(resolve((shown.json as { data: { preview: string } }).data.preview)).toContain(
    resolve(cache),
  );
}, 30_000);

test("reimport repairs a corrupt file-image preview", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-preview-repair-"));
  temporaryDirectories.push(parent);
  const source = join(parent, "source.unknown");
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  await writeFile(
    source,
    await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer(),
  );
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const env = { PHOTOCTL_CACHE: cache, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` };
  const first = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  const id = (first.json as { data: { ids: string[] } }).data.ids[0];
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });
  const view = (shown.json as { data: { preview: string } }).data.preview;
  const pinned = join(view.slice(0, view.indexOf(`${join("view", id)}`)), "emb", `${id}.jpg`);
  await writeFile(pinned, "corrupt");

  const second = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  expect(second.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { already_present: 1, ids: [id], previews: { embedded_extracted: 1 } },
  });
  expect((await readFile(pinned)).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
}, 30_000);
