import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, expect, test } from "vitest";
import { measureProcessTiming, spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("a warm daemon serves show with p50 below 250 ms", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-perf-"));
  directories.push(parent);
  const library = join(parent, "library");
  const timing = await measureProcessTiming();
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_LOCK_BUDGET_MS: String(timing.lockBudgetMs),
    PHOTOCTL_POLL_CEILING_MS: String(timing.pollCeilingMs),
    PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
  };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];

  for (let index = 0; index < 3; index += 1) {
    expect((await spawnPhotoctl(["show", id], { libraryDir: library, env })).code).toBe(0);
  }
  const durations = [];
  for (let index = 0; index < 20; index += 1) {
    const startedAt = performance.now();
    expect((await spawnPhotoctl(["show", id], { libraryDir: library, env })).code).toBe(0);
    durations.push(performance.now() - startedAt);
  }
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  durations.sort((left, right) => left - right);
  const p50 = durations[Math.floor(durations.length / 2)];

  expect(p50, `spawn probe ${timing.spawnMs} ms; samples ${durations.join(", ")}`).toBeLessThan(
    250,
  );
}, 30_000);
