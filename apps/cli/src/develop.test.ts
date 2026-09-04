import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the built CLI persists resolved develop state without rendering new pixels", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-develop-cli-"));
  directories.push(parent);
  const library = join(parent, "library");
  const cache = join(parent, "cache");
  const env = {
    PHOTOCTL_NO_DAEMON: "1",
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json.data as { ids: string[] }).ids[0];
  const before = await spawnPhotoctl(["show", id], { libraryDir: library, env });
  const doctor = await spawnPhotoctl(["doctor"], { libraryDir: library, env });
  const libraryId = (doctor.json.data as { library_id: string }).library_id;

  const developed = await spawnPhotoctl(
    ["develop", id, "--preset", "people", "--set", "exposure=0.3"],
    { libraryDir: library, env },
  );
  expect(developed.code).toBe(0);
  expect(developed.json).toMatchObject({
    schema: 1,
    ok: true,
    results: [
      {
        id,
        ok: true,
        develop_hash: expect.stringMatching(/^h_/),
        layers: { delta_applied: [], stale: [] },
      },
    ],
  });
  const renderHash = (developed.json.results as Array<{ render_hash: string }>)[0].render_hash;
  await expect(access(join(cache, libraryId, "view", id, renderHash))).rejects.toMatchObject({
    code: "ENOENT",
  });

  const graph = await spawnPhotoctl(["graph", "show", id], { libraryDir: library, env });
  expect(graph.code).toBe(0);
  expect(graph.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      id,
      render_hash: renderHash,
      nodes: [
        { kind: "output", artifact_available: false },
        { kind: "develop", artifact_available: false },
        { kind: "source", artifact_available: true },
      ],
    },
  });
  expect((before.json.data as { render_hash: string }).render_hash).not.toBe(renderHash);
}, 20_000);
