import { openLibrary } from "@photoctl/library";
import { daemonSocketPath } from "@photoctl/commands";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, expect, test } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the real CLI restores imported photo identities and content keys", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-cli-restore-"));
  directories.push(parent);
  const library = join(parent, "library");
  const sources = join(parent, "sources");
  const cache = join(parent, "cache");
  await mkdir(sources);
  await Promise.all(
    ["red", "green", "blue"].map(
      async (color, index) =>
        await writeFile(
          join(sources, `${index}.jpg`),
          await sharp({ create: { width: 3 + index, height: 2, channels: 3, background: color } })
            .jpeg()
            .toBuffer(),
        ),
    ),
  );
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const env = { PHOTOCTL_CACHE: cache, PHOTOCTL_VOLUME_MAP: `${parent}=fixture-volume:online` };
  const imports = await [0, 1, 2].reduce<Promise<number[]>>(
    async (previous, index) => [
      ...(await previous),
      (
        await spawnPhotoctl(["import", join(sources, `${index}.jpg`), "--link"], {
          libraryDir: library,
          env,
        })
      ).code,
    ],
    Promise.resolve([]),
  );
  expect(imports).toEqual([0, 0, 0]);
  const before = await photoIdentities(library);

  const backedUp = await spawnPhotoctl(["backup"], { libraryDir: library });
  expect(backedUp.code).toBe(0);
  const backup = (backedUp.json as { data: { path: string } }).data.path;
  const mutated = await openLibrary(library);
  try {
    await mutated.query("DELETE FROM photos");
  } finally {
    await mutated.close();
  }
  expect(await photoIdentities(library)).toEqual([]);

  const restored = await spawnPhotoctl(["restore", "--from", backup], { libraryDir: library });
  expect(restored.code).toBe(0);
  expect(restored.json).toEqual({
    schema: 1,
    ok: true,
    data: { library, from: backup, schema_version: 4 },
    warnings: [],
  });
  expect(await photoIdentities(library)).toEqual(before);
  expect((await readdir(parent)).filter((name) => name.includes(".rollback-"))).toEqual([]);
}, 30_000);

async function photoIdentities(
  library: string,
): Promise<Array<{ id: string; content_key: string }>> {
  const handle = await openLibrary(library);
  try {
    return (
      await handle.query<{ id: string; content_key: string }>(
        "SELECT id::text, content_key FROM photos ORDER BY id",
      )
    ).rows;
  } finally {
    await handle.close();
  }
}

test("invalid restore SQL reports catalog_unreadable without replacing the library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-cli-invalid-restore-"));
  directories.push(parent);
  const library = join(parent, "library");
  const invalid = join(parent, "invalid.sql");
  await writeFile(invalid, "definitely not SQL");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const before = await spawnPhotoctl(["doctor"], { libraryDir: library });

  const restored = await spawnPhotoctl(["restore", "--from", invalid], {
    libraryDir: library,
  });

  expect(restored.code).toBe(69);
  expect(restored.json).toMatchObject({ ok: false, code: "catalog_unreadable" });
  const after = await spawnPhotoctl(["doctor"], { libraryDir: library });
  expect(after.json.data).toMatchObject({
    library_id: (before.json as { data: { library_id: string } }).data.library_id,
  });
}, 15_000);

test("restore reports exit 75 while another process holds the library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-cli-locked-restore-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const backup = await spawnPhotoctl(["backup"], { libraryDir: library });
  const backupPath = (backup.json as { data: { path: string } }).data.path;
  const holder = spawn(
    process.execPath,
    [resolve("packages/test-harness/dist/hold-lock.js"), library],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    await waitForOutput(holder, "READY");
    const restored = await spawnPhotoctl(["restore", "--from", backupPath], {
      libraryDir: library,
      env: { PHOTOCTL_LOCK_BUDGET_MS: "50" },
    });
    expect(restored.code).toBe(75);
    expect(restored.json).toMatchObject({
      ok: false,
      code: "library_locked",
      data: { holder_pid: holder.pid },
    });
  } finally {
    holder.stdin.end("release\n");
    await new Promise<void>((resolveClose) => holder.once("close", () => resolveClose()));
  }
});

test("the daemon creates one automatic backup and deduplicates successful opens", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-backup-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  try {
    await waitFor(async () => (await sqlBackups(library)).length === 1);
    expect((await spawnPhotoctl(["doctor"], { libraryDir: library, env })).code).toBe(0);
    expect(await sqlBackups(library)).toHaveLength(1);
  } finally {
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  }
}, 15_000);

test("a persistent daemon reports an upgrade once and current schema on repeated migrate", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-cli-migrate-"));
  directories.push(parent);
  const library = join(parent, "library");
  const fixture = await readFile(
    new URL("../../../fixtures/libraries/schema-v1.pgsql", import.meta.url),
    "utf8",
  );
  const db = await PGlite.create({ dataDir: library });
  await db.exec(fixture);
  await db.close();
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  try {
    const first = await spawnPhotoctl(["migrate"], { libraryDir: library, env });
    const second = await spawnPhotoctl(["migrate"], { libraryDir: library, env });
    expect(first.json).toMatchObject({
      ok: true,
      data: { library, from_version: 1, to_version: 4, applied: [2, 3, 4] },
    });
    expect(second.json).toMatchObject({
      ok: true,
      data: { library, from_version: 4, to_version: 4, applied: [] },
    });
  } finally {
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  }
}, 15_000);

test("an automatic backup failure is logged without failing library work", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-daemon-backup-failure-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  await writeFile(join(library, "backups"), "blocks the backup directory");
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  try {
    expect((await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env })).code).toBe(0);
    expect((await spawnPhotoctl(["doctor"], { libraryDir: library, env })).code).toBe(0);
    const socket = daemonSocketPath(library, "0.1.0");
    const log = join(tmpdir(), `${basename(socket, ".sock")}.log`);
    expect(await readFile(log, "utf8")).toContain("Automatic backup failed:");
  } finally {
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
  }
}, 15_000);

test("direct no-daemon commands never create automatic snapshots", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-direct-no-backup-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  expect((await spawnPhotoctl(["doctor"], { libraryDir: library })).code).toBe(0);
  expect(await sqlBackups(library)).toEqual([]);
});

test("restore stops a live daemon and performs the directory swap directly", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-live-daemon-"));
  directories.push(parent);
  const library = join(parent, "library");
  const env = { PHOTOCTL_NO_DAEMON: "0" };
  expect((await spawnPhotoctl(["init", "--path", library], { env })).code).toBe(0);
  const backup = await spawnPhotoctl(["backup"], { libraryDir: library, env });
  const from = (backup.json as { data: { path: string } }).data.path;

  const restored = await spawnPhotoctl(["restore", "--from", from], {
    libraryDir: library,
    env,
  });

  expect(restored.code).toBe(0);
  expect(restored.json).toMatchObject({ data: { library, from, schema_version: 4 } });
  expect((await spawnPhotoctl(["daemon", "status"], { libraryDir: library, env })).code).toBe(69);
}, 20_000);

test("restore --path replaces a mismatched Postgres cluster with a current dump", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-pg-major-"));
  directories.push(parent);
  const source = join(parent, "source-library");
  const target = join(parent, "old-library");
  expect((await spawnPhotoctl(["init", "--path", source])).code).toBe(0);
  const sourceDoctor = await spawnPhotoctl(["doctor"], { libraryDir: source });
  const backup = await spawnPhotoctl(["backup"], { libraryDir: source });
  const from = (backup.json as { data: { path: string } }).data.path;
  await mkdir(target);
  await writeFile(join(target, "PG_VERSION"), "17\n");

  const restored = await spawnPhotoctl(["restore", "--path", target, "--from", from]);

  expect(restored.code).toBe(0);
  expect(restored.json).toMatchObject({ data: { library: target, from, schema_version: 4 } });
  const targetDoctor = await spawnPhotoctl(["doctor"], { libraryDir: target });
  expect(targetDoctor.json.data).toMatchObject({
    library_id: (sourceDoctor.json as { data: { library_id: string } }).data.library_id,
  });
}, 20_000);

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolveReady, reject) => {
    const onData = (chunk: Buffer) => {
      if (!chunk.toString().includes(expected)) return;
      child.stdout.off("data", onData);
      resolveReady();
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null) reject(new Error(`holder exited ${code} before ${expected}`));
    });
  });
}

async function sqlBackups(library: string): Promise<string[]> {
  try {
    return (await readdir(join(library, "backups"))).filter((name) => name.endsWith(".sql"));
  } catch {
    return [];
  }
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  async function attempt(): Promise<void> {
    if (await condition()) return;
    if (Date.now() >= deadline) throw new Error("condition did not become true");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    await attempt();
  }
  await attempt();
}
