import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("root help describes commands without creating a library or daemon", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: directory,
      PHOTOCTL_LIBRARY: join(directory, "absent"),
      PHOTOCTL_NO_DAEMON: "0",
    };
    delete env.AI_GATEWAY_API_KEY;
    const result = spawnSync(process.execPath, [resolve("apps/cli/dist/bin.js"), "--help"], {
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      data: {
        commands: expect.arrayContaining([
          expect.objectContaining({
            command: "segment",
            description: expect.stringContaining("selection"),
          }),
        ]),
      },
    });
    expect(result.stderr).toBe("");
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("help aliases, nested discovery and invalid targets bypass credential and runtime configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    // Reading this as a saved credential fails, even when the test runs as root.
    mkdirSync(join(directory, ".openphoto", ".env"), { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: directory,
      PHOTOCTL_LIBRARY: join(directory, "absent"),
      PHOTOCTL_LOCK_BUDGET_MS: "invalid",
      PHOTOCTL_POLL_CEILING_MS: "invalid",
      PHOTOCTL_NO_DAEMON: "0",
    };
    delete env.AI_GATEWAY_API_KEY;
    const run = (args: string[]) =>
      spawnSync(process.execPath, [resolve("apps/cli/dist/bin.js"), ...args], {
        encoding: "utf8",
        timeout: 10_000,
        env,
      });
    const root = JSON.parse(run(["help"]).stdout).data;
    for (const { command } of root.commands) {
      const result = run([command, "--help"]);
      expect(result.status, `${command}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout).data.usage).toContain(command);
      expect(result.stderr).toBe("");
    }
    for (const args of [
      [],
      ["help"],
      ["help", "doctor"],
      ["graph", "attempts", "--help"],
      ["help", "layer", "transform"],
      ["list", "--stream", "--help"],
      ["help", "configure"],
      ["configure", "--key-stdin", "--help"],
      ["help", "settings"],
    ]) {
      const result = run(args);
      expect(result.status, `${args.join(" ")}: ${result.stdout}${result.stderr}`).toBe(0);
      expect(JSON.parse(result.stdout).data.usage).toEqual(expect.any(String));
      expect(result.stderr).toBe("");
    }
    expect(JSON.parse(run(["help", "layer", "transform"]).stdout).data.usage).toContain("--anchor");
    expect(JSON.parse(run(["help", "doctor"]).stdout).data.notes.join(" ")).toContain("SHA-256");
    expect(JSON.parse(run(["help", "configure"]).stdout).data).toEqual(
      JSON.parse(run(["configure", "--help"]).stdout).data,
    );
    expect(JSON.parse(run(["help", "settings"]).stdout).data).toEqual(
      JSON.parse(run(["settings", "--help"]).stdout).data,
    );
    for (const args of [
      ["help", "does-not-exist"],
      ["does-not-exist", "--help"],
      ["help", "layer", "does-not-exist"],
      ["help", "__proto__"],
    ]) {
      const result = run(args);
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: "usage",
        data: { message: expect.stringContaining("Unknown help target") },
      });
      expect(result.stderr).toBe("");
    }
    expect(readdirSync(directory)).toEqual([".openphoto"]);
    expect(readdirSync(join(directory, ".openphoto"))).toEqual([".env"]);
    expect(readdirSync(join(directory, ".openphoto", ".env"))).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test("human command help prints usage and examples as readable lines", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "help", "segment", "--human"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, HOME: directory, PHOTOCTL_LIBRARY: join(directory, "absent") },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("\n  openphoto segment PHOTO --at 0.45,0.35 --norm\n");
    expect(result.stdout).not.toContain("FIELD | VALUE");
    expect(result.stderr).toBe("");
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("human help preserves executable shell quoting in JSON examples", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "help", "doctor", "--human"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, HOME: directory, PHOTOCTL_LIBRARY: join(directory, "absent") },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `  openphoto settings set models_base_url '"https://models.example.com/pinned/"'\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([
  {
    command: "layer",
    action: "transform",
    example: "openphoto layer transform PHOTO LAYER --dx 10 --dy 20 --relative",
  },
  { command: "graph", action: "attempt", example: "openphoto graph attempt ATTEMPT_UUID" },
])("nested help gives examples for $command $action", ({ command, action, example }) => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "help", command, action],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, HOME: directory, PHOTOCTL_LIBRARY: join(directory, "absent") },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).data.examples).toEqual([example]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("segment help explains text plus click selection without credentials or a library", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "segment", "--help"],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          HOME: directory,
          AI_GATEWAY_API_KEY: "",
          PHOTOCTL_LIBRARY: join(directory, "absent"),
          PHOTOCTL_NO_DAEMON: "1",
        },
      },
    );
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const help = JSON.parse(result.stdout).data;
    expect(help.usage).toContain("segment PHOTO");
    expect(help.examples).toContain(
      "openphoto segment PHOTO --text 'whole person including hair and clothing, excluding the bouquet' --at 0.45,0.35 --norm --dry-run",
    );
    expect(help.notes.join(" ")).toContain("--operation");
    expect(result.stderr).toBe("");
    expect(readdirSync(directory)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the graph attempts example executes against an empty library", () => {
  const directory = mkdtempSync(join(tmpdir(), "openphoto-help-example-"));
  try {
    const env = {
      ...process.env,
      HOME: directory,
      AI_GATEWAY_API_KEY: "",
      PHOTOCTL_LIBRARY: join(directory, "library"),
      PHOTOCTL_NO_DAEMON: "1",
    };
    const run = (args: string[]) =>
      spawnSync(process.execPath, [resolve("apps/cli/dist/bin.js"), ...args], {
        encoding: "utf8",
        timeout: 10_000,
        env,
      });
    const initialized = run(["init"]);
    expect(initialized.status, initialized.stdout + initialized.stderr).toBe(0);
    const help = run(["help", "graph", "attempts"]);
    expect(help.status, help.stdout + help.stderr).toBe(0);
    const example: string = JSON.parse(help.stdout).data.examples[0];
    const result = run(example.split(" ").slice(1));
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).ok).toBe(true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
