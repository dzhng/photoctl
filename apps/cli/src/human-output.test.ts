import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test.each([
  { position: "before the verb", args: ["--human", "version"] },
  { position: "after the verb", args: ["version", "--human"] },
])(
  "--human works $position without changing the JSON default",
  async ({ args }) => {
    const json = await spawnCli(["version"]);
    const human = await spawnCli(args);
    const envelope = JSON.parse(json.stdout) as { data: { version: string } };

    expect(json.code).toBe(0);
    expect(envelope).toMatchObject({
      schema: 1,
      ok: true,
      warnings: [],
    });
    expect(human).toEqual({
      code: json.code,
      stdout: `FIELD | VALUE\n----- | -----\nversion | ${envelope.data.version}\n`,
      stderr: json.stderr,
    });
  },
  30_000,
);

test("human failures retain the stable code and explain the error", async () => {
  const json = await spawnCli(["unknown-command"]);
  const human = await spawnCli(["unknown-command", "--human"]);

  expect(json.code).toBe(2);
  expect(JSON.parse(json.stdout)).toMatchObject({
    ok: false,
    code: "usage",
    data: { message: "Unknown command: unknown-command" },
  });
  expect(human).toEqual({
    code: json.code,
    stdout: "Error [usage]: Unknown command: unknown-command\n",
    stderr: json.stderr,
  });
});

test("human values cannot inject rows or terminal controls", async () => {
  const human = await spawnCli(["bad\n\u001b[31m\u009b32m\u007f", "--human"]);

  expect(human.code).toBe(2);
  expect(human.stdout).toBe("Error [usage]: Unknown command: bad\\n\\u001b[31m\\u009b32m\\u007f\n");
});

test("a mixed batch renders one row per input and the aggregate summary", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-human-batch-"));
  directories.push(parent);
  const library = join(parent, "library");
  const options = {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: join(parent, "cache"),
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
    },
  };
  expect((await spawnCli(["init", "--path", library], options)).code).toBe(0);
  const imported = await spawnCli(["import", resolve("fixtures/a7c2.ARW"), "--link"], options);
  expect(imported.code).toBe(0);
  const id = (JSON.parse(imported.stdout) as { data: { ids: string[] } }).data.ids[0];

  const human = await spawnCli(
    ["tag", id, "--human", "ffffffff", "--add", "keeper | favorite"],
    options,
  );
  const json = await spawnCli(["tag", id, "ffffffff", "--add", "keeper | favorite"], options);
  const lines = human.stdout.trimEnd().split("\n");

  expect(human.code).toBe(65);
  expect(human.stderr).toBe(json.stderr);
  expect(lines[0]).toBe("Error [partial]: Partial failure");
  expect(lines[1].split(" | ")).toEqual(["ID", "OK", "CODE", "ACTION", "TAG"]);
  expect(lines.filter((line) => line.startsWith(id))).toHaveLength(1);
  expect(lines.filter((line) => line.startsWith("ffffffff"))).toHaveLength(1);
  expect(human.stdout).toContain("keeper \\| favorite");
  expect(lines.at(-1)).toBe("Summary: 1 succeeded, 1 failed");
  expect(JSON.parse(json.stdout)).toMatchObject({
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 1 },
    results: [
      { id, ok: true, tag: "keeper | favorite", action: "added" },
      { id: "ffffffff", ok: false, code: "not_found" },
    ],
  });
}, 30_000);

test("human output includes envelope warnings without changing success", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-human-warning-"));
  directories.push(parent);
  const library = join(parent, "library");
  const online = {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: join(parent, "cache"),
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:online`,
    },
  };
  expect((await spawnCli(["init", "--path", library], online)).code).toBe(0);
  const imported = await spawnCli(["import", resolve("fixtures/a7c2.ARW"), "--link"], online);
  expect(imported.code).toBe(0);
  const id = (JSON.parse(imported.stdout) as { data: { ids: string[] } }).data.ids[0];
  const offline = {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: join(parent, "cache"),
      PHOTOCTL_VOLUME_MAP: `${resolve(".")}=fixture-volume:offline`,
    },
  };

  const json = await spawnCli(["show", id], offline);
  const human = await spawnCli(["show", id, "--human"], offline);

  expect(human.code).toBe(json.code);
  expect(human.code).toBe(0);
  expect(human.stderr).toBe(json.stderr);
  expect(human.stdout).toContain(
    `Warning [source_offline] (${id}): One or more source files are offline\n`,
  );
  expect(JSON.parse(json.stdout)).toMatchObject({
    ok: true,
    warnings: [{ code: "source_offline", id, message: "One or more source files are offline" }],
  });
}, 30_000);

test("--human leaves daemon NDJSON events on stderr", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-human-events-"));
  directories.push(parent);
  const library = join(parent, "library");
  const options = {
    libraryDir: library,
    env: {
      PHOTOCTL_NO_DAEMON: "0",
      PHOTOCTL_LOCK_BUDGET_MS: "10000",
      PHOTOCTL_POLL_CEILING_MS: "50",
    },
  };

  try {
    expect((await spawnCli(["init", "--path", library], options)).code).toBe(0);
    const json = await spawnCli(["daemon", "status"], options);
    const human = await spawnCli(["--human", "daemon", "status"], options);

    expect(human.code).toBe(json.code);
    expect(human.code).toBe(0);
    expect(human.stderr).toBe(json.stderr);
    expect(human.stderr.trim()).not.toBe("");
    expect(JSON.parse(human.stderr)).toMatchObject({
      schema: 1,
      event: "daemon",
      action: "connected",
    });
  } finally {
    await spawnCli(["daemon", "stop"], options);
  }
}, 30_000);

async function spawnCli(
  args: string[],
  options: { libraryDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliResult> {
  const cli = resolve(process.cwd(), "apps/cli/dist/bin.js");
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        ...process.env,
        PHOTOCTL_NO_DAEMON: "1",
        ...(options.libraryDir ? { PHOTOCTL_LIBRARY: options.libraryDir } : {}),
        ...options.env,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code: code ?? 1, stdout, stderr }));
  });
}
