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
import { join } from "node:path";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";

import sharp from "sharp";
import { identifyFile } from "@photoctl/library";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("export falls back when linked bytes change without an mtime change", async () => {
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
    results: [{ id: setup.id, ok: true, w: 640, h: 480 }],
    warnings: [{ code: "source_offline", id: setup.id }],
  });
  expect((await readFile(join(setup.output, "source.jpg"))).length).toBeGreaterThan(0);
});

test("export accepts matching linked content after an mtime-only touch", async () => {
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
    results: [{ id: setup.id, ok: true, w: 640, h: 480, bytes: expect.any(Number) }],
    warnings: [],
  });
}, 30_000);

test("export tries later catalogued locators when the first source is gone", async () => {
  const setup = await setupImportedPhoto("multiple-locators");
  const replacement = join(setup.parent, "volume", "replacement.jpg");
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
        w: 640,
        h: 480,
        bytes: expect.any(Number),
      },
    ],
    warnings: [],
  });
}, 30_000);

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

test("a corrupt image with unchanged sampled identity falls back to its pinned preview", async () => {
  const bytes = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: "#7090b0" },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  const setup = await setupImportedPhoto("invalid-online", bytes);
  const before = await stat(setup.source);
  const identity = await identifyFile(setup.source);
  expect(before.size).toBeGreaterThan(3 * 1024 * 1024);
  const source = await open(setup.source, "r+");
  try {
    const offset = 1024 * 1024 + 16;
    const byte = Buffer.alloc(1);
    await source.read(byte, 0, 1, offset);
    byte[0] ^= 0xff;
    await source.write(byte, 0, 1, offset);
  } finally {
    await source.close();
  }
  await utimes(setup.source, before.atime, before.mtime);

  expect((await identifyFile(setup.source)).contentKey).toBe(identity.contentKey);
  await expect(sharp(setup.source, { failOn: "error" }).stats()).rejects.toThrow();

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
  await mkdir(join(setup.output, "source.jpg"));

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
        path: join(setup.output, "source.jpg"),
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

async function setupImportedPhoto(label: string, bytes?: Buffer): Promise<ImportedPhotoSetup> {
  const parent = await mkdtemp(join(tmpdir(), `photoctl-export-${label}-`));
  directories.push(parent);
  const volume = join(parent, "volume");
  const library = join(parent, "library");
  const output = join(parent, "output");
  const source = join(volume, bytes ? "source.png" : "source.jpg");
  await mkdir(volume);
  if (bytes) await writeFile(source, bytes);
  else
    await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 140, b: 180 } },
    })
      .jpeg()
      .toFile(source);
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
