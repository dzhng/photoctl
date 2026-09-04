import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("init creates a library with default settings", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-init-"));
  directories.push(parent);
  const library = join(parent, "library");

  const initialized = await spawnPhotoctl(["init", "--path", library]);

  expect(initialized.code).toBe(0);
  expect(initialized.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      library,
      db: expect.stringMatching(/^pglite \d+\.\d+\.\d+ \/ pg \d+\.\d+$/),
      cache_max_bytes: 20 * 1024 ** 3,
    },
    warnings: [],
  });
});

test("init rejects unknown options without creating a library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-init-args-"));
  directories.push(parent);
  const library = join(parent, "library");

  const initialized = await spawnPhotoctl(["init", "--path", library, "--cache-mxa", "1GiB"]);

  expect(initialized.code).toBe(2);
  expect(initialized.json).toMatchObject({ schema: 1, ok: false, code: "usage" });
  await expect(stat(library)).rejects.toMatchObject({ code: "ENOENT" });
});

test("doctor reports persisted library settings", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-doctor-"));
  directories.push(parent);
  const library = join(parent, "library");
  const cacheRoot = join(parent, "cache");

  const initialized = await spawnPhotoctl(["init", "--path", library, "--cache-max", "1GiB"]);
  expect(initialized.code).toBe(0);

  const diagnosed = await spawnPhotoctl(["doctor"], {
    libraryDir: library,
    env: { PHOTOCTL_CACHE: cacheRoot },
  });

  expect(diagnosed.code).toBe(0);
  const data = diagnosed.json.data as {
    library_id: string;
    cache: { root: string };
  };
  expect(data.library_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(data.cache.root).toBe(join(cacheRoot, data.library_id));
  expect(diagnosed.json).toMatchObject({
    schema: 1,
    ok: true,
    data: {
      library,
      library_id: data.library_id,
      node: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      db: expect.stringMatching(/^pglite \d+\.\d+\.\d+ \/ pg \d+\.\d+$/),
      vector: { installed: true, version: expect.any(String) },
      cache: { root: expect.any(String), max_bytes: 1024 ** 3 },
      lock_holder: null,
    },
    warnings: [],
  });
});

test("doctor rejects positional arguments", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-doctor-args-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const diagnosed = await spawnPhotoctl(["doctor", "nonsense"], { libraryDir: library });

  expect(diagnosed.code).toBe(2);
  expect(diagnosed.json).toMatchObject({ schema: 1, ok: false, code: "usage" });
});

test("init refuses to replace an existing library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-reinit-"));
  directories.push(parent);
  const library = join(parent, "library");

  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const before = await spawnPhotoctl(["doctor"], { libraryDir: library });
  const beforeData = before.json.data as { library_id: string; cache: { max_bytes: number } };

  const repeated = await spawnPhotoctl(["init", "--path", library, "--cache-max", "1GiB"]);

  expect(repeated.code).toBe(2);
  expect(repeated.json).toMatchObject({ schema: 1, ok: false, code: "usage" });
  const after = await spawnPhotoctl(["doctor"], { libraryDir: library });
  expect(after.json.data).toMatchObject({
    library_id: beforeData.library_id,
    cache: { max_bytes: beforeData.cache.max_bytes },
  });
});

test("doctor refuses a junk catalog without moving or replacing it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-junk-"));
  directories.push(parent);
  const library = join(parent, "library");
  await mkdir(library);
  const marker = join(library, "keep-me.txt");
  await writeFile(marker, "not a database\n");

  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library });

  expect(diagnosed.code).toBe(69);
  expect(diagnosed.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "catalog_unreadable",
    data: { path: library, hint: `photoctl restore --path ${library}` },
  });
  expect(await readFile(marker, "utf8")).toBe("not a database\n");
  expect(await readdir(parent)).toEqual(["library"]);
  expect(await readdir(library)).toEqual(["keep-me.txt"]);
});

test("doctor directs a different Postgres major to restore", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-version-"));
  directories.push(parent);
  const library = join(parent, "library");
  await mkdir(library);
  const versionFile = join(library, "PG_VERSION");
  await writeFile(versionFile, "17\n");

  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library });

  expect(diagnosed.code).toBe(69);
  expect(diagnosed.json).toMatchObject({
    schema: 1,
    ok: false,
    code: "migrate_required",
    data: {
      path: library,
      found_version: "17",
      expected_version: "18",
      hint: `photoctl restore --path ${library}`,
    },
  });
  expect(await readFile(versionFile, "utf8")).toBe("17\n");
  expect(await readdir(parent)).toEqual(["library"]);
  expect(await readdir(library)).toEqual(["PG_VERSION"]);
});

test("doctor waits for a live library holder and succeeds after release", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-lock-wait-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const holder = spawn(
    process.execPath,
    [resolve("packages/test-harness/dist/hold-lock.js"), library],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    await waitForOutput(holder, "READY");
    const diagnosis = spawnPhotoctl(["doctor"], {
      libraryDir: library,
      env: { PHOTOCTL_LOCK_BUDGET_MS: "2000" },
    });

    const finishedWhileHeld = await Promise.race([
      diagnosis.then(() => true),
      new Promise<false>((resolveDelay) => setTimeout(() => resolveDelay(false), 100)),
    ]);
    expect(finishedWhileHeld).toBe(false);

    holder.stdin.end("release\n");
    expect((await diagnosis).code).toBe(0);
  } finally {
    await stopHolder(holder);
  }
});

test("doctor reports the live holder when its lock budget expires", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-lock-timeout-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);

  const holder = spawn(
    process.execPath,
    [resolve("packages/test-harness/dist/hold-lock.js"), library],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  try {
    await waitForOutput(holder, "READY");
    const diagnosed = await spawnPhotoctl(["doctor"], {
      libraryDir: library,
      env: { PHOTOCTL_LOCK_BUDGET_MS: "50" },
    });

    expect(diagnosed.code).toBe(75);
    expect(diagnosed.json).toMatchObject({
      schema: 1,
      ok: false,
      code: "library_locked",
      data: { holder_pid: holder.pid, waited_ms: 50 },
    });
  } finally {
    await stopHolder(holder);
  }
});

test("doctor reclaims a lock left by a dead process", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-lock-dead-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const lockPath = join(library, ".photoctl-open.lock");
  await writeFile(
    lockPath,
    JSON.stringify({ pid: 2_147_483_647, socket: null, startedAt: Date.now() }),
  );

  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library });

  expect(diagnosed.code).toBe(0);
  expect(await readdir(library)).not.toContain(".photoctl-open.lock");
});

test.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)("%s releases the library lock", async (signal, expectedExit) => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-lock-signal-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const holder = spawn(
    process.execPath,
    [resolve("packages/test-harness/dist/hold-lock.js"), library],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await waitForOutput(holder, "READY");

  const exited = waitForExit(holder);
  holder.kill(signal);

  expect(await exited).toBe(expectedExit);
  expect(await readdir(library)).not.toContain(".photoctl-open.lock");
  expect((await spawnPhotoctl(["doctor"], { libraryDir: library })).code).toBe(0);
});

test("doctor recovers after a holder is killed without cleanup", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-lock-kill-"));
  directories.push(parent);
  const library = join(parent, "library");
  expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
  const holder = spawn(
    process.execPath,
    [resolve("packages/test-harness/dist/hold-lock.js"), library],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await waitForOutput(holder, "READY");

  const exited = waitForExit(holder);
  holder.kill("SIGKILL");
  await exited;
  expect(await readdir(library)).toContain(".photoctl-open.lock");

  const diagnosed = await spawnPhotoctl(["doctor"], { libraryDir: library });
  expect(diagnosed.code).toBe(0);
  expect(await readdir(library)).not.toContain(".photoctl-open.lock");
});

async function waitForOutput(
  child: ChildProcessWithoutNullStreams,
  expected: string,
): Promise<void> {
  await new Promise<void>((resolveOutput, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (output.includes(expected)) resolveOutput();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!output.includes(expected)) reject(new Error(`Lock holder exited ${code}: ${output}`));
    });
  });
}

async function stopHolder(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  if (!child.stdin.writableEnded) child.stdin.end("release\n");
  await new Promise<void>((resolveExit) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return child.exitCode;
  return await new Promise((resolveExit) => child.once("exit", resolveExit));
}
