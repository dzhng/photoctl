import { openLibrary } from "@photoctl/library";
import { dispatch } from "@photoctl/commands";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directories: string[] = [];
const daemonCleanups: Array<{ library: string; env: NodeJS.ProcessEnv }> = [];
let gateway: Server | undefined;
afterEach(async () => {
  await Promise.all(
    daemonCleanups
      .splice(0)
      .map(
        async ({ library, env }) =>
          await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env }).catch(
            () => undefined,
          ),
      ),
  );
  await new Promise<void>((resolveClose) => gateway?.close(() => resolveClose()) ?? resolveClose());
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
  gateway = undefined;
});

test("auto import reports queued cost and the built CLI streams keyless text hits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-search-cli-"));
  directories.push(directory);
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  const initialized = await spawnPhotoctl(["init", "--embed", "auto"], {
    libraryDir: library,
  });
  expect(initialized).toMatchObject({ code: 0, json: { ok: true, data: { embed: "auto" } } });
  const handle = await openLibrary(library);
  const imported = await dispatch(
    {
      verb: "import",
      args: [resolve("fixtures/a7c2.ARW"), "--link"],
      cwd: process.cwd(),
      env: {
        noDaemon: true,
        cacheRoot: cache,
        volumeMap: `${process.cwd()}=fixture:online`,
      },
    },
    { version: "test", library: handle },
  );
  expect(imported).toMatchObject({
    ok: true,
    data: { embeddings: { queued: 1, est_usd: 0.00045 } },
  });
  const id = (imported as { data: { ids: string[] } }).data.ids[0]!;
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'ceremony')", [id]);
  await handle.close();

  const searched = await spawnPhotoctl(["search", "ceremony", "--stream"], {
    libraryDir: library,
    env: {
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online`,
    },
  });

  expect(searched.code).toBe(0);
  expect(searched.stream).toMatchObject([{ id, file: "a7c2.ARW", sources: ["text"] }]);
  expect(searched.events).toContainEqual(
    expect.objectContaining({ event: "warn", code: "provider_unconfigured" }),
  );
});

test("a running daemon applies the importing command's embedding key and cache root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-command-env-"));
  directories.push(directory);
  const library = join(directory, "library");
  const staleCache = join(directory, "stale-cache");
  const currentCache = join(directory, "current-cache");
  const baseEnv = { PHOTOCTL_NO_DAEMON: "0", PHOTOCTL_CACHE: staleCache };
  daemonCleanups.push({ library, env: baseEnv });
  expect(
    await spawnPhotoctl(["init", "--embed", "auto"], { libraryDir: library, env: baseEnv }),
  ).toMatchObject({ code: 0 });

  let requests = 0;
  gateway = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => gateway!.listen(0, "127.0.0.1", resolveListen));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");
  const currentEnv = {
    ...baseEnv,
    PHOTOCTL_CACHE: currentCache,
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online`,
    AI_GATEWAY_API_KEY: "current-command-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  daemonCleanups[0] = { library, env: currentEnv };

  expect(
    await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
      libraryDir: library,
      env: currentEnv,
    }),
  ).toMatchObject({ code: 0, json: { ok: true, data: { embeddings: { queued: 1 } } } });
  await waitFor(() => requests === 1);
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env: currentEnv });

  const handle = await openLibrary(library);
  expect(
    Number(
      (await handle.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embeddings"))
        .rows[0]?.count ?? 0,
    ),
  ).toBe(1);
  await handle.close();
});

test("a foreground tag quiesces an in-flight worker and then resumes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-foreground-quiescence-"));
  directories.push(directory);
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  let requests = 0;
  gateway = createServer((request, response) => {
    requests += 1;
    request.resume();
    if (requests === 1) return;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => gateway!.listen(0, "127.0.0.1", resolveListen));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online`,
    AI_GATEWAY_API_KEY: "explicit-key",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  daemonCleanups.push({ library, env });
  expect(
    await spawnPhotoctl(["init", "--embed", "auto"], { libraryDir: library, env }),
  ).toMatchObject({ code: 0 });
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
  await waitFor(() => requests === 1);

  const startedAt = performance.now();
  expect(
    await spawnPhotoctl(["tag", id, "--add", "foreground"], { libraryDir: library, env }),
  ).toMatchObject({ code: 0, json: { ok: true } });
  expect(performance.now() - startedAt).toBeLessThan(2_000);
  await waitFor(() => requests === 2);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });

  const handle = await openLibrary(library);
  expect(
    Number(
      (await handle.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embeddings"))
        .rows[0]?.count ?? 0,
    ),
  ).toBe(1);
  expect(
    (await handle.query<{ tag: string }>("SELECT tag FROM tags WHERE photo_id = $1", [id])).rows,
  ).toEqual([{ tag: "foreground" }]);
  await handle.close();
});

test("a foreground embed emits progress while one provider request is still in flight", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-progress-"));
  directories.push(directory);
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  const baseEnv = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online`,
  };
  daemonCleanups.push({ library, env: baseEnv });
  expect(
    await spawnPhotoctl(["init", "--embed", "manual"], { libraryDir: library, env: baseEnv }),
  ).toMatchObject({ code: 0 });
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env: baseEnv,
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;

  gateway = createServer((request, response) => {
    request.resume();
    setTimeout(() => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
    }, 5_500);
  });
  await new Promise<void>((resolveListen) => gateway!.listen(0, "127.0.0.1", resolveListen));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");
  const embedded = await spawnPhotoctl(["embed", id], {
    libraryDir: library,
    env: {
      ...baseEnv,
      AI_GATEWAY_API_KEY: "explicit-command-key",
      PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
    },
  });

  expect(embedded).toMatchObject({ code: 0, json: { ok: true } });
  expect(
    embedded.events.filter(
      (event) => event.event === "progress" && event.phase === "embed" && event.done === 0,
    ).length,
  ).toBeGreaterThanOrEqual(2);
  expect(embedded.events).toContainEqual(
    expect.objectContaining({ event: "progress", phase: "embed", done: 1, total: 1 }),
  );
}, 15_000);

test("daemon search stays alive through provider retry and returns text fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-search-progress-"));
  directories.push(directory);
  const library = join(directory, "library");
  const baseEnv = { PHOTOCTL_NO_DAEMON: "0" };
  daemonCleanups.push({ library, env: baseEnv });
  expect(await spawnPhotoctl(["init"], { libraryDir: library, env: baseEnv })).toMatchObject({
    code: 0,
  });
  const imported = await spawnPhotoctl(["import", resolve("fixtures/a7c2.ARW"), "--link"], {
    libraryDir: library,
    env: { ...baseEnv, PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online` },
  });
  const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
  expect(
    await spawnPhotoctl(["tag", id, "--add", "ceremony"], { libraryDir: library, env: baseEnv }),
  ).toMatchObject({ code: 0 });

  let requests = 0;
  gateway = createServer((request, response) => {
    requests += 1;
    request.resume();
    if (requests < 3) {
      response.writeHead(429, { "retry-after": "2" }).end();
      return;
    }
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" }).end("not-json");
    }, 28_000);
  });
  await new Promise<void>((resolveListen) => gateway!.listen(0, "127.0.0.1", resolveListen));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");

  const searched = await spawnPhotoctl(["search", "ceremony"], {
    libraryDir: library,
    env: {
      ...baseEnv,
      PHOTOCTL_LOCK_BUDGET_MS: "0",
      AI_GATEWAY_API_KEY: "explicit-key",
      PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
    },
  });

  expect(searched).toMatchObject({
    code: 0,
    json: {
      ok: true,
      data: { hits: [{ id, file: "a7c2.ARW", sources: ["text"] }] },
      warnings: [{ code: "provider_warning" }],
    },
  });
  expect(
    searched.events.filter(
      (event) => event.event === "progress" && event.phase === "search" && event.done === 0,
    ).length,
  ).toBeGreaterThanOrEqual(2);
}, 45_000);

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for embedding request");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}
