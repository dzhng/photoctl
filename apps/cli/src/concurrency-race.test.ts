import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { measureProcessTiming, seedPhotoRows, spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("eight real clients append every requested tag without losing a row", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-race-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: join(parent, "cache"),
    PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
  };
  expect(
    (
      await spawnPhotoctl(["init", "--path", library], {
        env: { PHOTOCTL_NO_DAEMON: "1" },
      })
    ).code,
  ).toBe(0);
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env: { ...env, PHOTOCTL_NO_DAEMON: "1" },
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0];
  expect((await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env })).code).toBe(0);

  const clients = Array.from({ length: 8 }, (_, client) => runClient(client, id, library, env));
  const results = (await Promise.all(clients)).flat();
  const expected = Array.from({ length: 8 }, (_, client) =>
    Array.from({ length: 25 }, (_, row) => `p${client}-${row}`),
  )
    .flat()
    .sort();
  const shown = await spawnPhotoctl(["show", id], { libraryDir: library, env });
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });

  expect(results.map((result) => result.code)).toEqual(Array.from({ length: 200 }, () => 0));
  expect((shown.json as { data: { tags: string[] } }).data.tags).toEqual(expected);
}, 60_000);

test("queue overflow fails loudly and commits every accepted batch in full", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-queue-"));
  directories.push(parent);
  const library = join(parent, "library");
  const timing = await measureProcessTiming();
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_LOCK_BUDGET_MS: String(timing.lockBudgetMs),
    PHOTOCTL_POLL_CEILING_MS: String(timing.pollCeilingMs),
  };
  expect(
    (
      await spawnPhotoctl(["init", "--path", library], {
        env: { PHOTOCTL_NO_DAEMON: "1" },
      })
    ).code,
  ).toBe(0);
  const ids = await seedPhotoRows(library, 25);
  const started = await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env });
  expect(started.code).toBe(0);
  const daemonPid = (started.json as { data: { pid: number } }).data.pid;

  process.kill(daemonPid, "SIGSTOP");
  let pending: ReturnType<typeof spawnPhotoctl>[] = [];
  let resumed = false;
  let contenders;
  try {
    pending = Array.from({ length: 24 }, (_, client) =>
      spawnPhotoctl(["tag", ...ids, "--add", `client-${client}`], { libraryDir: library, env }),
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
    process.kill(daemonPid, "SIGCONT");
    resumed = true;
    contenders = await Promise.all(pending);
  } finally {
    if (!resumed) process.kill(daemonPid, "SIGCONT");
  }
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  const successful = contenders.filter((result) => result.code === 0);
  const failed = contenders.filter((result) => result.code !== 0);
  const handle = await import("@photoctl/library").then(({ openLibrary }) => openLibrary(library));
  const rows = await handle.query<{ tag: string }>("SELECT tag FROM tags ORDER BY tag, photo_id");
  await handle.close();

  expect(successful.length).toBeGreaterThan(0);
  expect(failed.length).toBeGreaterThan(0);
  expect(failed.map((result) => result.code)).toEqual(
    Array.from({ length: failed.length }, () => 75),
  );
  expect(failed.map((result) => result.json)).toEqual(
    failed.map(() => expect.objectContaining({ ok: false, code: "library_locked" })),
  );
  expect(rows.rows).toHaveLength(25 * successful.length);
  expect(new Set(rows.rows.map((row) => row.tag))).toEqual(
    new Set(
      contenders
        .map((result, client) => ({ result, tag: `client-${client}` }))
        .filter(({ result }) => result.code === 0)
        .map(({ tag }) => tag),
    ),
  );
}, 30_000);

async function runClient(client: number, id: string, library: string, env: NodeJS.ProcessEnv) {
  const results = [];
  for (let row = 0; row < 25; row += 1) {
    results.push(
      await spawnPhotoctl(["tag", id, "--add", `p${client}-${row}`], {
        libraryDir: library,
        env,
      }),
    );
  }
  return results;
}
