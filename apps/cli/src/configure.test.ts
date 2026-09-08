import { execFile, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseEnv, promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { openLibrary } from "@photoctl/library";
import sharp from "sharp";

test("explicit daemon startup uses the saved key for already queued automatic embedding", async () => {
  const home = mkdtempSync(join(tmpdir(), "openphoto-configure-start-"));
  const library = join(home, "library");
  const authorizations: Array<string | undefined> = [];
  const gateway = createServer((request, response) => {
    authorizations.push(request.headers.authorization);
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ embeddings: [Array(3_072).fill(0.25)] }));
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PHOTOCTL_LIBRARY: library,
    PHOTOCTL_CACHE: join(home, "cache"),
    PHOTOCTL_NO_DAEMON: "1",
    PHOTOCTL_VOLUME_MAP: `${home}=fixture:online`,
  };
  delete env.AI_GATEWAY_API_KEY;
  const cli = resolve("apps/cli/dist/bin.js");
  const run = promisify(execFile);
  try {
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No test gateway address");
    env.PHOTOCTL_GATEWAY_URL = `http://127.0.0.1:${address.port}`;
    await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } })
      .jpeg()
      .toFile(join(home, "input.jpg"));
    await run(process.execPath, [cli, "init", "--embed", "auto"], { env });
    await run(process.execPath, [cli, "import", join(home, "input.jpg"), "--link"], { env });
    mkdirSync(join(home, ".openphoto"));
    writeFileSync(join(home, ".openphoto", ".env"), "AI_GATEWAY_API_KEY=start-secret\n");
    env.PHOTOCTL_NO_DAEMON = "0";
    await run(process.execPath, [cli, "daemon", "start"], { env });
    const deadline = Date.now() + 3_000;
    while (authorizations.length === 0 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    expect(authorizations).toEqual(["Bearer start-secret"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await run(process.execPath, [cli, "daemon", "stop"], { env });
    const handle = await openLibrary(library);
    try {
      const rows = await handle.query<{ model: string }>("SELECT model FROM embeddings");
      expect(rows.rows).toEqual([{ model: "google/gemini-embedding-2" }]);
    } finally {
      await handle.close();
    }
  } finally {
    await run(process.execPath, [cli, "daemon", "stop"], { env }).catch(() => {});
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test("configure saves a private gateway credential without opening a library or printing it", () => {
  const home = mkdtempSync(join(tmpdir(), "openphoto-configure-"));
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "configure", "--key-stdin"],
      {
        input: "fixture-secret\n",
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          AI_GATEWAY_API_KEY: "",
          PHOTOCTL_LIBRARY: join(home, "absent"),
        },
      },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("fixture-secret");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { configured: true } });
    const file = join(home, ".openphoto", ".env");
    expect(readFileSync(file, "utf8")).toContain("AI_GATEWAY_API_KEY=fixture-secret");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".openphoto")).mode & 0o777).toBe(0o700);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("CLI requests load the saved key and environment overrides win even with a running daemon", async () => {
  const home = mkdtempSync(join(tmpdir(), "openphoto-configure-"));
  const authorizations: Array<string | undefined> = [];
  const gateway = createServer((request, response) => {
    authorizations.push(request.headers.authorization);
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3072).fill(0.25) }] }));
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PHOTOCTL_LIBRARY: join(home, "library"),
    PHOTOCTL_NO_DAEMON: "0",
  };
  delete env.AI_GATEWAY_API_KEY;
  const cli = resolve("apps/cli/dist/bin.js");
  const run = promisify(execFile);
  try {
    mkdirSync(join(home, ".openphoto"));
    writeFileSync(join(home, ".openphoto", ".env"), "AI_GATEWAY_API_KEY=saved-secret\n");
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("No test gateway address");
    env.PHOTOCTL_GATEWAY_URL = `http://127.0.0.1:${address.port}`;
    await run(process.execPath, [cli, "init"], { env });
    for (const override of [undefined, "override-secret", ""]) {
      const requestEnv = {
        ...env,
        ...(override === undefined ? {} : { AI_GATEWAY_API_KEY: override }),
      };
      const result = await run(process.execPath, [cli, "search", "sunset"], { env: requestEnv });
      expect(JSON.parse(result.stdout).ok).toBe(true);
      expect(result.stdout + result.stderr).not.toMatch(/saved-secret|override-secret/u);
    }
    expect(authorizations).toEqual(["Bearer saved-secret", "Bearer override-secret"]);
  } finally {
    await run(process.execPath, [cli, "daemon", "stop"], { env }).catch(() => {});
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

test("configure replaces old credentials while retaining other dotenv settings", () => {
  const home = mkdtempSync(join(tmpdir(), "openphoto-configure-"));
  try {
    mkdirSync(join(home, ".openphoto"));
    const file = join(home, ".openphoto", ".env");
    writeFileSync(
      file,
      'AI_GATEWAY_API_KEY="old-secret"\nOTHER_KEY="retain # this"\nLITERAL=\'literal\\nvalue\'\n',
    );
    const result = spawnSync(
      process.execPath,
      [resolve("apps/cli/dist/bin.js"), "configure", "--from-env"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home, AI_GATEWAY_API_KEY: "replacement-secret" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const contents = readFileSync(file, "utf8");
    expect(contents).not.toContain("old-secret");
    expect(parseEnv(contents)).toEqual({
      AI_GATEWAY_API_KEY: "replacement-secret",
      OTHER_KEY: "retain # this",
      LITERAL: "literal\\nvalue",
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
