import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import sharp from "sharp";

const encodedImages = {
  jpg: "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJwAmj1//9k=",
  png: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMQqbgDQQxwFgBPxAhxt4XlIQAAAABJRU5ErkJggg==",
  tiff: "SUkqADYAAAD/2P/AABEIAAIAAwMBIgACEQEDEQH/2gAMAwEAAhEDEQA/AOcooor9NPz0/9kAEQAAAQMAAQAAAAMAAAABAQMAAQAAAAIAAAACAQMAAwAAABgBAAADAQMAAQAAAAcAAAAGAQMAAQAAAAYAAAARAQQAAQAAAAgAAAASAQMAAQAAAAEAAAAVAQMAAQAAAAMAAAAWAQMAAQAAAAABAAAXAQQAAQAAAC0AAAAaAQUAAQAAAAgBAAAbAQUAAQAAABABAAAcAQMAAQAAAAEAAAAoAQMAAQAAAAIAAABTAQMAAwAAAB4BAABbAQcAPgIAAFQBAAAUAgUABgAAACQBAAAAAAAAMzPLAAAACAAzM8sAAAAIAAgACAAIAAEAAQABAAAAAAABAAAA/wAAAAEAAACAAAAAAQAAAP8AAAABAAAAgAAAAAEAAAD/AAAAAQAAAP/Y/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9k=",
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("accepted file-source images import and export without descriptive EXIF", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-file-source-"));
  temporaryDirectories.push(parent);
  const sourceDirectory = join(parent, "source");
  const library = join(parent, "library");
  const output = join(parent, "output");
  await mkdir(sourceDirectory, { recursive: true });
  await Promise.all(
    Object.entries(encodedImages).map(([extension, bytes]) =>
      writeFile(
        join(sourceDirectory, `image-${extension}.${extension}`),
        Buffer.from(bytes, "base64"),
      ),
    ),
  );

  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const sources = Object.keys(encodedImages).map((extension) =>
    join(sourceDirectory, `image-${extension}.${extension}`),
  );
  const imported = await sources.reduce<Promise<Awaited<ReturnType<typeof spawnPhotoctl>>[]>>(
    async (previous, source) => [
      ...(await previous),
      await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env }),
    ],
    Promise.resolve([]),
  );
  for (const result of imported) {
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({
      schema: 1,
      ok: true,
      data: { imported: 1, already_present: 0, skipped_unsupported: 0 },
      warnings: [],
    });
  }
  const ids = imported.flatMap((result) => (result.json as { data: { ids: string[] } }).data.ids);
  expect(ids).toHaveLength(3);

  await Promise.all(
    ids.map(async (id) => {
      const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });
      expect(shown.code).toBe(0);
      expect(shown.json).toMatchObject({
        schema: 1,
        ok: true,
        data: { id, dims: { w: 3, h: 2, orientation: 1 } },
      });
    }),
  );

  const exported = await spawnPhotoctl(["export", ...ids, "--to", output], {
    libraryDir: library,
    env,
  });
  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 3, failed: 0 },
  });
  const outputBytes = await Promise.all(
    ["jpg", "png", "tiff"].map(async (extension) => {
      const bytes = await readFile(join(output, `image-${extension}.jpg`));
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      return bytes;
    }),
  );
  expect(outputBytes[0]).toEqual(Buffer.from(encodedImages.jpg, "base64"));
  expect(outputBytes[1]).not.toEqual(Buffer.from(encodedImages.png, "base64"));
  expect(outputBytes[2]).not.toEqual(Buffer.from(encodedImages.tiff, "base64"));
}, 30_000);

test("an oriented whole-file image is not rotated again from its pinned preview", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-oriented-source-"));
  temporaryDirectories.push(parent);
  const source = join(parent, "oriented.jpg");
  const library = join(parent, "library");
  const output = join(parent, "output");
  await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(source);
  const onlineEnv = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online`,
  };
  const offlineEnv = {
    ...onlineEnv,
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:offline`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env: offlineEnv });
  expect(shown.code).toBe(0);
  expect(shown.json).toMatchObject({
    data: {
      dims: { w: 3, h: 2, orientation: 6 },
      preview_info: { actual: { w: 3, h: 2 }, source_tier: "pinned-preview" },
    },
    warnings: [{ code: "source_offline", id }],
  });

  const exported = await spawnPhotoctl(["export", id, "--to", output], {
    libraryDir: library,
    env: offlineEnv,
  });
  expect(exported.code).toBe(0);
  const showHash = (shown.json as { data: { render_hash: string } }).data.render_hash;
  expect(exported.json).toMatchObject({
    results: [{ id, w: 3, h: 2, render_hash: showHash }],
    warnings: [{ code: "source_offline", id }],
  });
  await expect(sharp(join(output, "oriented.jpg")).metadata()).resolves.toMatchObject({
    width: 3,
    height: 2,
  });
}, 30_000);

test("a missing extensionless source is not reported as a skipped format", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-missing-source-"));
  temporaryDirectories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", join(parent, "missing-folder"), "--link"], {
    libraryDir: library,
    env: { PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` },
  });

  expect(imported.code).toBe(65);
  expect(imported.json).toMatchObject({ schema: 1, ok: false, code: "not_found" });
}, 30_000);

test("directory import admits supported top-level files", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-directory-scope-"));
  temporaryDirectories.push(parent);
  const sourceDirectory = join(parent, "source");
  const library = join(parent, "library");
  await mkdir(sourceDirectory);
  await writeFile(join(sourceDirectory, "image.jpg"), Buffer.from(encodedImages.jpg, "base64"));
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", sourceDirectory, "--link"], {
    libraryDir: library,
    env: { PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` },
  });

  expect(imported.code).toBe(0);
  expect(imported.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { imported: 1, already_present: 0, skipped_unsupported: 0 },
  });
}, 30_000);

test("a PNG with a JPEG extension is rendered instead of copied into a false JPEG", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-mislabeled-jpeg-"));
  temporaryDirectories.push(parent);
  const source = join(parent, "mislabeled.jpg");
  const library = join(parent, "library");
  const output = join(parent, "output");
  const sourceBytes = Buffer.from(encodedImages.png, "base64");
  await writeFile(source, sourceBytes);
  const env = {
    PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online`,
    PHOTOCTL_CACHE: join(parent, "cache"),
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], { libraryDir: library, env });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const exported = await spawnPhotoctl(["export", id, "--to", output], {
    libraryDir: library,
    env,
  });
  const outputBytes = await readFile(join(output, "mislabeled.jpg"));

  expect(exported.code).toBe(0);
  expect(outputBytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(outputBytes).not.toEqual(sourceBytes);
}, 30_000);

test("an unusable cache root returns a stable JSON destination error", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-cache-destination-"));
  temporaryDirectories.push(parent);
  const library = join(parent, "library");
  const cacheFile = join(parent, "not-a-directory");
  await writeFile(cacheFile, "occupied");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cacheFile,
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
    },
  });

  expect(imported.code).toBe(69);
  expect(imported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "volume_readonly",
    data: { path: expect.stringContaining(cacheFile) },
  });
}, 30_000);
