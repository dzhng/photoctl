import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("export refuses exact-copy when linked source content no longer matches the catalogue", async () => {
  const setup = await setupImportedPhoto("mutated-source");
  const before = await stat(setup.source);
  const source = await open(setup.source, "r+");
  try {
    const original = Buffer.alloc(1);
    await source.read(original, 0, 1, 0);
    await source.write(Buffer.from([original[0] ^ 0xff]), 0, 1, 0);
  } finally {
    await source.close();
  }
  await utimes(setup.source, before.atime, before.mtime);

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [{ id: setup.id, ok: true, w: 1616, h: 1080 }],
    warnings: [{ code: "source_offline", id: setup.id }],
  });
  expect((await readFile(join(setup.output, "a7c2.jpg"))).length).toBeGreaterThan(0);
});

test("export exact-copies matching linked content after an mtime-only touch", async () => {
  const setup = await setupImportedPhoto("changed-mtime");
  const before = await stat(setup.source);
  await utimes(setup.source, before.atime, new Date(before.mtimeMs + 2_000));

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    results: [{ id: setup.id, ok: true, w: 7008, h: 4672, bytes: 6_730_200 }],
    warnings: [],
  });
});

test("export tries later catalogued locators when the first source is gone", async () => {
  const setup = await setupImportedPhoto("multiple-locators");
  const replacement = join(setup.parent, "volume", "replacement.ARW");
  await copyFile(setup.source, replacement);
  const reimported = await spawnPhotoctl(["import", replacement, "--link"], {
    libraryDir: setup.library,
    env: setup.env,
  });
  expect(reimported.code).toBe(0);
  expect(reimported.json).toMatchObject({
    schema: 1,
    ok: true,
    data: { imported: 0, already_present: 1, ids: [setup.id] },
  });
  await rm(setup.source);

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    results: [
      {
        id: setup.id,
        ok: true,
        file: join(setup.output, "replacement.jpg"),
        w: 7008,
        h: 4672,
        bytes: 6_730_200,
      },
    ],
    warnings: [],
  });
});

test("a corrupt pinned preview returns the stable offline envelope", async () => {
  const setup = await setupImportedPhoto("corrupt-pin");
  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: setup.library,
    env: setup.env,
  });
  const cacheRoot = (diagnosed.json as { data: { cache: { root: string } } }).data.cache.root;
  await writeFile(join(cacheRoot, "emb", `${setup.id}.jpg`), "not a jpeg");

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: {
      ...setup.env,
      PHOTOCTL_VOLUME_MAP: `${join(setup.parent, "volume")}=fixture-volume:offline`,
    },
  });

  expect(exported.code).toBe(69);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "file_offline",
    summary: { ok: 0, failed: 1 },
    results: [{ id: setup.id, ok: false, code: "file_offline" }],
  });
});

test("a changed online source falls back to the pinned preview with a warning", async () => {
  const setup = await setupImportedPhoto("invalid-online");
  const before = await stat(setup.source);
  const source = await open(setup.source, "r+");
  try {
    const fullPreviewEnd = 659_456 + 6_730_200;
    await source.write(Buffer.alloc(2), 0, 2, fullPreviewEnd - 2);
  } finally {
    await source.close();
  }
  await utimes(setup.source, before.atime, before.mtime);

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(0);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [{ id: setup.id, ok: true }],
    warnings: [{ id: setup.id, code: "source_offline" }],
  });
});

test("a destination write failure returns a stable volume error envelope", async () => {
  const setup = await setupImportedPhoto("write-failure");
  await mkdir(setup.output);
  await mkdir(join(setup.output, "a7c2.jpg"));

  const exported = await spawnPhotoctl(["export", setup.id, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(69);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "volume_readonly",
    summary: { ok: 0, failed: 1 },
    results: [
      {
        id: setup.id,
        ok: false,
        code: "volume_readonly",
        path: join(setup.output, "a7c2.jpg"),
      },
    ],
  });
});

test("an all-failed heterogeneous export is partial regardless of input order", async () => {
  const setup = await setupImportedPhoto("heterogeneous-batch");
  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: setup.library,
    env: setup.env,
  });
  const cacheRoot = (diagnosed.json as { data: { cache: { root: string } } }).data.cache.root;
  await writeFile(join(cacheRoot, "emb", `${setup.id}.jpg`), "not a jpeg");
  const missingId = "00000000-0000-7000-8000-000000000000";
  const offlineEnv = {
    ...setup.env,
    PHOTOCTL_VOLUME_MAP: `${join(setup.parent, "volume")}=fixture-volume:offline`,
  };

  const forward = await spawnPhotoctl(
    ["export", missingId, setup.id, "--to", join(setup.parent, "forward")],
    { libraryDir: setup.library, env: offlineEnv },
  );
  const reverse = await spawnPhotoctl(
    ["export", setup.id, missingId, "--to", join(setup.parent, "reverse")],
    { libraryDir: setup.library, env: offlineEnv },
  );

  for (const exported of [forward, reverse]) {
    expect(exported.code).toBe(65);
    expect(exported.json).toMatchObject({
      schema: 1,
      ok: false,
      code: "partial",
      summary: { ok: 0, failed: 2 },
    });
    expect(
      (exported.json as { results: Array<{ code: string }> }).results
        .map(({ code }) => code)
        .toSorted(),
    ).toEqual(["file_offline", "not_found"]);
  }
});

test("an all-failed homogeneous export retains the shared error code", async () => {
  const setup = await setupImportedPhoto("homogeneous-batch");
  const ids = ["00000000-0000-7000-8000-000000000000", "00000000-0000-7000-8000-000000000001"];

  const exported = await spawnPhotoctl(["export", ...ids, "--to", setup.output], {
    libraryDir: setup.library,
    env: setup.env,
  });

  expect(exported.code).toBe(65);
  expect(exported.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "not_found",
    summary: { ok: 0, failed: 2 },
    results: ids.map((id) => ({ id, ok: false, code: "not_found" })),
  });
});

interface ImportedPhotoSetup {
  parent: string;
  library: string;
  source: string;
  output: string;
  id: string;
  env: { PHOTOCTL_CACHE: string; PHOTOCTL_VOLUME_MAP: string };
}

async function setupImportedPhoto(label: string): Promise<ImportedPhotoSetup> {
  const parent = await mkdtemp(join(tmpdir(), `photoctl-export-${label}-`));
  directories.push(parent);
  const volume = join(parent, "volume");
  const library = join(parent, "library");
  const output = join(parent, "output");
  const source = join(volume, "a7c2.ARW");
  await mkdir(volume);
  await copyFile(resolve("fixtures/a7c2.ARW"), source);
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${volume}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", source, "--link"], {
    libraryDir: library,
    env,
  });
  expect(imported.code).toBe(0);
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
  return { parent, library, source, output, id, env };
}
