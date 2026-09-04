import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("tag adds an exact value to every resolved photo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-tag-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const tagged = await spawnPhotoctl(["tag", id, "--add", "ceremony"], {
    libraryDir: library,
    env,
  });
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });

  expect(tagged.code).toBe(0);
  expect(tagged.json).toMatchObject({
    schema: 1,
    ok: true,
    summary: { ok: 1, failed: 0 },
    results: [{ id, ok: true, tag: "ceremony", action: "added" }],
    warnings: [],
  });
  expect(shown.json).toMatchObject({ data: { tags: ["ceremony"] } });
}, 30_000);

test("tag commits the found subset and remove is idempotent", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-tag-partial-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = {
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  const partial = await spawnPhotoctl(["tag", id, "ffffffff", "--add", "keeper"], {
    libraryDir: library,
    env,
  });
  const firstRemove = await spawnPhotoctl(["tag", id, "--remove", "keeper"], {
    libraryDir: library,
    env,
  });
  const repeatedRemove = await spawnPhotoctl(["tag", id, "--remove", "keeper"], {
    libraryDir: library,
    env,
  });
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });

  expect(partial.code).toBe(65);
  expect(partial.json).toMatchObject({
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 1 },
    results: [
      { id, ok: true, tag: "keeper", action: "added" },
      { id: "ffffffff", ok: false, code: "not_found" },
    ],
  });
  expect(firstRemove.code).toBe(0);
  expect(repeatedRemove.code).toBe(0);
  expect(shown.json).toMatchObject({ data: { tags: [] } });
}, 30_000);
