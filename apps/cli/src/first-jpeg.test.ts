import { mkdtemp, open, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { readManifest } from "@photoctl/test-harness";
import sharp from "sharp";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("imports one linked ARW and returns its photo id", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-first-jpeg-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };

  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });

  expect(imported.code).toBe(0);
  expect(imported.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      imported: 1,
      already_present: 0,
      skipped_unsupported: 0,
      ids: [expect.stringMatching(/^[0-9a-f-]{36}$/)],
      volume: { uuid: "fixture-volume", mount: volumeMount, online: true },
      xmp_read: { sidecars_found: 0, ratings: 0, keywords: 0, labels: 0 },
      previews: { embedded_extracted: 1, bytes: expect.any(Number) },
      embeddings: { queued: 0 },
    },
    warnings: [],
  });
}, 30_000);

test("show preserves fixture metadata and shot offset across host timezones", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-show-jpeg-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const losAngeles = await spawnPhotoctl(["show", id.slice(0, 13)], {
    libraryDir: library,
    env: { ...env, TZ: "America/Los_Angeles" },
  });
  const tokyo = await spawnPhotoctl(["show", id], {
    libraryDir: library,
    env: { ...env, TZ: "Asia/Tokyo" },
  });

  const expected = {
    id,
    dims: { w: 7008, h: 4672, orientation: 1 },
    crop: null,
    camera: { make: "SONY", model: "ILCE-7CM2", lens: "FE 24-70mm F4 ZA OSS" },
    exposure: { shutter: "1/100", f: 7.1, iso: 100, focal_mm: 24, wb: "auto" },
    shot: "2023-10-02T18:18:37+02:00",
    rating: 0,
    flag: "none",
    label: null,
    tags: [],
    locators: [{ volume: "fixture-volume", path: "fixtures/a7c2.ARW", online: true }],
    content_key: "ck_3dac5c943a33dcc4",
    develop: {},
    develop_hash: null,
    layers: { count: 0, stale: 0 },
    xmp: null,
  };
  expect(losAngeles.code).toBe(0);
  expect(tokyo.code).toBe(0);
  expect(losAngeles.json).toMatchObject({ schema: 1, ok: true, data: expected, warnings: [] });
  expect(tokyo.json).toMatchObject({ schema: 1, ok: true, data: expected, warnings: [] });
}, 30_000);

test("show reports limited offline detail and promotes it when the full source returns", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-show-detail-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const cache = join(parent, "cache");
  const onlineEnv = {
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const offline = await spawnPhotoctl(["show", id, "--region", "0,0,1000,1000"], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:offline`,
    },
  });
  expect(offline.code).toBe(0);
  expect(offline.json).toMatchObject({
    data: {
      preview_info: {
        requested: { region: [0, 0, 1000, 1000], long_edge: "native" },
        source_tier: "pinned-preview",
        source_dimensions: { w: 1616, h: 1080 },
        resolution_limited: true,
        cache_source: "render_master",
      },
    },
    warnings: [
      { code: "source_offline", id },
      { code: "preview_resolution_limited", id },
    ],
  });
  const offlineInfo = (offline.json as { data: { preview_info: { actual: { w: number } } } }).data
    .preview_info;
  expect(offlineInfo.actual.w).toBeLessThan(1000);

  const online = await spawnPhotoctl(["show", id, "--region", "0,0,1000,1000"], {
    libraryDir: library,
    env: onlineEnv,
  });
  expect(online.code).toBe(0);
  expect(online.json).toMatchObject({
    data: {
      preview_info: {
        actual: { w: 1000, h: 1000 },
        source_tier: "online-jpeg-range",
        source_dimensions: { w: 7008, h: 4672 },
        pixel_scale: 1,
        resolution_limited: false,
        cache_source: "render_master",
        color_space: "srgb",
        icc: "sRGB2014",
        base_to_view: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        view_to_base: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        visible_base_polygon: [
          [0, 0],
          [1000, 0],
          [1000, 1000],
          [0, 1000],
        ],
      },
    },
    warnings: [],
  });
  const preview = (online.json as { data: { preview: string } }).data.preview;
  await expect(sharp(preview).metadata()).resolves.toMatchObject({ width: 1000, height: 1000 });
}, 30_000);

test("export copies the full embedded JPEG byte-for-byte", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-export-jpeg-"));
  directories.push(parent);
  const library = join(parent, "library");
  const outputDirectory = join(parent, "output");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const result = await spawnPhotoctl(["export", id, "--to", outputDirectory, "--format", "jpeg"], {
    libraryDir: library,
    env,
  });

  const outputPath = join(outputDirectory, "a7c2.jpg");
  const manifest = await readManifest();
  const full = manifest.previews.find((preview) => preview.width === 7008);
  if (!full) throw new Error("Fixture manifest has no full embedded preview");
  const source = await open(fixture, "r");
  const expected = Buffer.allocUnsafe(full.length);
  try {
    const { bytesRead } = await source.read(expected, 0, expected.length, full.offset);
    expect(bytesRead).toBe(expected.length);
  } finally {
    await source.close();
  }

  expect(result.code).toBe(0);
  expect(result.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [{ id, ok: true, file: outputPath, w: 7008, h: 4672, bytes: full.length }],
    warnings: [],
  });
  expect(await readFile(outputPath)).toEqual(expected);
}, 30_000);

test("offline export renders the pinned preview and warns", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-offline-jpeg-"));
  directories.push(parent);
  const library = join(parent, "library");
  const outputDirectory = join(parent, "output");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const cache = join(parent, "cache");
  const onlineEnv = {
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const exported = await spawnPhotoctl(["export", id, "--to", outputDirectory], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:offline`,
    },
  });

  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [{ id, ok: true, w: 1616, h: 1080 }],
    warnings: [{ code: "source_offline", id }],
  });
}, 30_000);

test("offline export without a pinned preview returns the stable unavailable envelope", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-missing-preview-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const cache = join(parent, "cache");
  const onlineEnv = {
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library, env: onlineEnv });
  const libraryId = (diagnosed.json as { data: { library_id: string } }).data.library_id;
  await rm(join(cache, libraryId, "emb", `${id}.jpg`));

  const exported = await spawnPhotoctl(["export", id, "--to", join(parent, "output")], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:offline`,
    },
  });

  expect(exported.code).toBe(69);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "file_offline",
    summary: { ok: 0, failed: 1 },
    results: [
      {
        id,
        ok: false,
        code: "file_offline",
        volume: "fixture-volume",
        hint: `mount ${volumeMount}`,
      },
    ],
  });
}, 30_000);

test("import counts an unsupported file without opening it as a photo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-unsupported-"));
  directories.push(parent);
  const library = join(parent, "library");
  const textFile = join(parent, "notes.txt");
  await writeFile(textFile, "not a photograph\n");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", textFile, "--link"], {
    libraryDir: library,
  });

  expect(imported.code).toBe(0);
  expect(imported.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      imported: 0,
      already_present: 0,
      skipped_unsupported: 1,
      ids: [],
      volume: null,
      previews: { embedded_extracted: 0, bytes: 0 },
    },
    warnings: [],
  });
}, 30_000);

test("import skips corrupt bytes without creating a photo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-corrupt-arw-"));
  directories.push(parent);
  const library = join(parent, "library");
  const corrupt = join(parent, "broken.arw");
  await writeFile(corrupt, "not a TIFF\n");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", corrupt, "--link"], {
    libraryDir: library,
    env: { PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` },
  });

  expect(imported.code).toBe(0);
  expect(imported.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { imported: 0, skipped_unsupported: 1, ids: [], volume: null },
  });
}, 30_000);

test("a bad export id does not starve a later valid photo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-partial-export-"));
  directories.push(parent);
  const library = join(parent, "library");
  const outputDirectory = join(parent, "output");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const exported = await spawnPhotoctl(["export", "00000000", id, "--to", outputDirectory], {
    libraryDir: library,
    env,
  });

  expect(exported.code).toBe(65);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 1 },
    results: [
      { id: "00000000", ok: false, code: "not_found" },
      { id, ok: true, file: join(outputDirectory, "a7c2.jpg") },
    ],
  });
  expect((await readFile(join(outputDirectory, "a7c2.jpg"))).subarray(0, 2)).toEqual(
    Buffer.from([0xff, 0xd8]),
  );
}, 30_000);

test("an offline volume is authoritative before import inspects source bytes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-offline-import-"));
  directories.push(parent);
  const library = join(parent, "library");
  const corrupt = join(parent, "broken.arw");
  await writeFile(corrupt, "not a TIFF\n");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const imported = await spawnPhotoctl(["import", corrupt, "--link"], {
    libraryDir: library,
    env: { PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:offline` },
  });

  expect(imported.code).toBe(69);
  expect(imported.json).toMatchObject({ schema: 1, ok: false, code: "file_offline" });
}, 30_000);

test("reimport returns the same photo id and locator", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-reimport-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const first = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const firstId = (first.json as { data: { ids: string[] } }).data.ids[0];
  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const cacheRoot = (diagnosed.json as { data: { cache: { root: string } } }).data.cache.root;
  const pinnedPath = join(cacheRoot, "emb", `${firstId}.jpg`);
  const oldTimestamp = new Date("2000-01-01T00:00:00.000Z");
  await utimes(pinnedPath, oldTimestamp, oldTimestamp);
  const second = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env,
  });
  const shown = await spawnPhotoctl(["show", firstId], { libraryDir: library, env });

  expect(second.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      imported: 0,
      already_present: 1,
      ids: [firstId],
      previews: { embedded_extracted: 0 },
    },
  });
  expect((await stat(pinnedPath)).mtime.toISOString()).toBe(oldTimestamp.toISOString());
  expect(shown.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      id: firstId,
      locators: [{ volume: "fixture-volume", path: "fixtures/a7c2.ARW", online: true }],
    },
  });
}, 30_000);

test("reimport repairs a missing pinned preview", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-repair-preview-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const volumeMount = resolve(".");
  const cache = join(parent, "cache");
  const onlineEnv = {
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const first = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const id = (first.json as { data: { ids: string[] } }).data.ids[0];
  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library, env: onlineEnv });
  const libraryId = (diagnosed.json as { data: { library_id: string } }).data.library_id;
  await rm(join(cache, libraryId, "emb", `${id}.jpg`));

  const second = await spawnPhotoctl(["import", fixture, "--link"], {
    libraryDir: library,
    env: onlineEnv,
  });
  const exported = await spawnPhotoctl(["export", id, "--to", join(parent, "output")], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${volumeMount}=fixture-volume:offline`,
    },
  });

  expect(second.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { imported: 0, already_present: 1, ids: [id], previews: { embedded_extracted: 1 } },
  });
  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    warnings: [{ code: "source_offline", id }],
  });
}, 30_000);
