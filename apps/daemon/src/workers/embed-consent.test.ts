import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { initializeLibrary, type LibraryHandle } from "@photoctl/library";
import { startGatewayFixture } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dispatch, embedPhotoBatch } from "@photoctl/commands";
import { deriveEmbedTiming, EmbedWorker } from "./embed.js";

let handle: LibraryHandle | undefined;
let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  await handle?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  if (directory) await rm(directory, { recursive: true, force: true });
  handle = undefined;
  server = undefined;
  directory = undefined;
});

test("the inter-batch yield is derived from the same foreground poll budget", () => {
  expect(deriveEmbedTiming(75)).toEqual({ pollCeilingMs: 75, interBatchYieldMs: 150 });
  expect(() => deriveEmbedTiming(0)).toThrow("positive integer");
});

test("ambient credentials do no image work until embed or init auto supplies consent", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-consent-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000031";
  await seedPhoto(handle, id);
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const env = {
    noDaemon: false,
    cacheRoot: cacheBase,
    gatewayApiKey: "ambient-key",
    gatewayUrl: `http://127.0.0.1:${address.port}`,
  } as const;
  const worker = new EmbedWorker({
    handle,
    env,
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 5,
  });

  worker.kick();
  await waitFor(() => !worker.isBusy());
  expect(await embeddingCount(handle)).toBe(0);

  const explicit = await dispatch(
    { verb: "embed", args: [id], cwd: directory, env },
    { version: "test", library: handle },
  );
  expect(explicit).toMatchObject({ ok: true, results: [{ id, ok: true }] });
  expect(await embeddingCount(handle)).toBe(1);

  await handle.query("DELETE FROM embeddings");
  await handle.query(`UPDATE settings SET value = '"auto"'::jsonb WHERE key = 'embed_mode'`);
  worker.kick();
  await waitFor(async () => (await embeddingCount(handle!)) === 1);
  await worker.stop();
});

test("a command can refresh the worker key and cache context after daemon startup", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-context-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000035";
  await seedPhoto(handle, id, "context");
  const currentCache = join(directory, "current-cache");
  const preview = pinnedEmbeddedJpegPath(
    cacheRootForLibrary(initialized.libraryId, currentCache),
    id,
  );
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const worker = new EmbedWorker({
    handle,
    env: { noDaemon: false, cacheRoot: join(directory, "stale-cache") },
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 5,
  });

  worker.kick();
  await waitFor(() => !worker.isBusy());
  expect(await embeddingCount(handle)).toBe(0);
  worker.updateContext(
    {
      noDaemon: false,
      cacheRoot: currentCache,
      gatewayApiKey: "current-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    directory,
  );
  worker.kick();
  await waitFor(async () => (await embeddingCount(handle!)) === 1);
  await worker.stop();
});

test("a retryable short batch wakes at cooldown even after a foreground kick", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-retry-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000036";
  await seedPhoto(handle, id, "retry");
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let requests = 0;
  server = createServer((_request, response) => {
    requests += 1;
    if (requests === 1) {
      response.writeHead(500).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const env = {
    noDaemon: false,
    cacheRoot: cacheBase,
    gatewayApiKey: "retry-key",
    gatewayUrl: `http://127.0.0.1:${address.port}`,
  } as const;
  const worker = new EmbedWorker({
    handle,
    env,
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 5,
    attemptCooldownMs: 50,
  });

  worker.kick();
  await waitFor(() => requests === 1);
  worker.updateContext(env, directory);
  worker.kick();
  await waitFor(async () => (await embeddingCount(handle!)) === 1);
  expect(requests).toBe(2);
  await worker.stop();
});

test("automatic embedding stops after one configuration failure and resumes on refreshed context", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-config-stop-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const cacheBase = join(directory, "cache");
  for (let index = 1; index <= 51; index += 1) {
    const suffix = (100 + index).toString().padStart(12, "0");
    const id = `0199a7c2-0000-7000-8000-${suffix}`;
    await seedPhoto(handle, id, `config-stop-${index}`);
    const preview = pinnedEmbeddedJpegPath(
      cacheRootForLibrary(initialized.libraryId, cacheBase),
      id,
    );
    await mkdir(dirname(preview), { recursive: true });
    await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
  let configured = false;
  let requests = 0;
  server = createServer((_request, response) => {
    requests += 1;
    if (!configured) {
      response.writeHead(401).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const worker = new EmbedWorker({
    handle,
    env: {
      noDaemon: false,
      cacheRoot: cacheBase,
      gatewayApiKey: "expired-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 5,
  });

  try {
    worker.kick();
    await waitFor(() => requests > 0);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    expect(requests).toBe(1);
    expect(worker.isBusy()).toBe(false);
    worker.kick();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    expect(requests).toBe(1);

    configured = true;
    worker.updateContext(
      {
        noDaemon: false,
        cacheRoot: cacheBase,
        gatewayApiKey: "corrected-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
      directory,
    );
    worker.kick();
    await waitFor(async () => (await embeddingCount(handle!)) === 51);
    expect(requests).toBe(52);
  } finally {
    await worker.stop();
  }
});

test("one HTTP 400 image rejection does not configuration-pause later photos", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-item-rejection-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const cacheBase = join(directory, "cache");
  const ids = [41, 42, 43].map(
    (suffix) => `0199a7c2-0000-7000-8000-${suffix.toString().padStart(12, "0")}`,
  );
  for (const id of ids) {
    await seedPhoto(handle, id, `item-rejection-${id.slice(-2)}`);
    const preview = pinnedEmbeddedJpegPath(
      cacheRootForLibrary(initialized.libraryId, cacheBase),
      id,
    );
    await mkdir(dirname(preview), { recursive: true });
    await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }
  let requests = 0;
  server = createServer((request, response) => {
    requests += 1;
    request.resume();
    if (requests === 1) {
      response.writeHead(400).end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const env = {
    noDaemon: false,
    cacheRoot: cacheBase,
    gatewayApiKey: "explicit-key",
    gatewayUrl: `http://127.0.0.1:${address.port}`,
  } as const;
  const foreground = await embedPhotoBatch({
    handle,
    env,
    cwd: directory,
    ids,
    includeCurrent: true,
  });
  expect(foreground.results).toMatchObject([
    { id: ids[0], ok: false, code: "provider_busy" },
    { id: ids[1], ok: true },
    { id: ids[2], ok: true },
  ]);
  await handle.query("DELETE FROM embeddings");
  requests = 0;
  const worker = new EmbedWorker({
    handle,
    env,
    cwd: directory,
    foregroundBusy: () => false,
    attemptCooldownMs: 5_000,
  });

  worker.kick();
  await waitFor(async () => (await embeddingCount(handle!)) === 2);
  expect(requests).toBe(3);
  await worker.stop();
});

test("worker stop aborts an in-flight provider request", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-stop-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000037";
  await seedPhoto(handle, id, "stop");
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let requests = 0;
  server = createServer((_request, response) => {
    requests += 1;
    setTimeout(() => {
      if (!response.destroyed) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
      }
    }, 2_000);
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const worker = new EmbedWorker({
    handle,
    env: {
      noDaemon: false,
      cacheRoot: cacheBase,
      gatewayApiKey: "stop-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 5,
  });

  worker.kick();
  await waitFor(() => requests === 1);
  const startedAt = performance.now();
  await worker.stop();
  expect(performance.now() - startedAt).toBeLessThan(500);
});

test("foreground pause reaches a database-safe point before a transaction and resumes", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-pause-transaction-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000039";
  await seedPhoto(handle, id, "pause-transaction");
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let requests = 0;
  server = createServer((request, response) => {
    requests += 1;
    request.resume();
    if (requests === 1) return;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const worker = new EmbedWorker({
    handle,
    env: {
      noDaemon: false,
      cacheRoot: cacheBase,
      gatewayApiKey: "explicit-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    cwd: directory,
    foregroundBusy: () => false,
  });

  worker.kick();
  await waitFor(() => requests === 1);
  const startedAt = performance.now();
  await worker.pause();
  expect(performance.now() - startedAt).toBeLessThan(500);

  await handle.query("BEGIN");
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'foreground')", [id]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  expect(await embeddingCount(handle)).toBe(0);
  await handle.query("ROLLBACK");

  worker.resume();
  await waitFor(async () => (await embeddingCount(handle!)) === 1);
  expect(requests).toBe(2);
  await worker.stop();
});

test("worker stop interrupts provider retry backoff", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-stop-backoff-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const cacheBase = join(directory, "cache");
  const id = "0199a7c2-0000-7000-8000-000000000099";
  await seedPhoto(handle, id, "stop-backoff");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let requests = 0;
  server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.writeHead(429, { "retry-after": "2" }).end();
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const worker = new EmbedWorker({
    handle,
    env: {
      noDaemon: false,
      cacheRoot: cacheBase,
      gatewayApiKey: "explicit-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    cwd: directory,
    foregroundBusy: () => false,
  });

  worker.kick();
  await waitFor(() => requests === 1);
  const startedAt = performance.now();
  await worker.stop();

  expect(performance.now() - startedAt).toBeLessThan(500);
  expect(requests).toBe(1);
});

test("a background catalog failure is reported once and stop still resolves", async () => {
  const reported: string[] = [];
  const worker = new EmbedWorker({
    handle: {
      query: async () => {
        throw new Error("catalog unavailable");
      },
    } as unknown as LibraryHandle,
    env: { noDaemon: false, gatewayApiKey: "explicit-key" },
    cwd: process.cwd(),
    foregroundBusy: () => false,
    reportError: (message) => reported.push(message),
  });

  worker.kick();
  await expect(worker.stop()).resolves.toBeUndefined();
  expect(reported).toEqual(["Embedding worker stopped: catalog unavailable"]);
});

test("a successful provider call with a failed catalog write escapes and stops automatic work", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-write-failure-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const cacheBase = join(directory, "cache");
  const id = "0199a7c2-0000-7000-8000-000000000038";
  await seedPhoto(handle, id, "write-failure");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let requests = 0;
  server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ data: [{ embedding: Array(3_072).fill(0.25) }] }));
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const failingHandle = Object.create(handle) as LibraryHandle;
  failingHandle.query = (async (sql: string, params?: unknown[]) => {
    if (sql.includes("INSERT INTO embeddings")) throw new Error("catalog write failed");
    return await handle!.query(sql, params);
  }) as LibraryHandle["query"];
  const env = {
    noDaemon: false,
    cacheRoot: cacheBase,
    gatewayApiKey: "explicit-key",
    gatewayUrl: `http://127.0.0.1:${address.port}`,
  } as const;

  await expect(
    embedPhotoBatch({ handle: failingHandle, env, cwd: directory, ids: [id] }),
  ).rejects.toThrow("catalog write failed");
  expect(requests).toBe(1);

  const reported: string[] = [];
  const worker = new EmbedWorker({
    handle: failingHandle,
    env,
    cwd: directory,
    foregroundBusy: () => false,
    reportError: (message) => reported.push(message),
  });
  worker.kick();
  await waitFor(() => reported.length === 1);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

  expect(requests).toBe(2);
  expect(reported).toEqual(["Embedding worker stopped: catalog write failed"]);
  await worker.stop();
});

test("a slow failing sweep attempts more than 100 photos in catalog order", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-monotonic-sweep-"));
  const initialized = await initializeLibrary(join(directory, "library"), undefined, "auto");
  handle = initialized.handle;
  const cacheBase = join(directory, "cache");
  const ids: string[] = [];
  for (let index = 1; index <= 120; index += 1) {
    const id = `0199a7c2-0000-7000-8000-${index.toString().padStart(12, "0")}`;
    ids.push(id);
    await seedPhoto(handle, id, `sweep-${index}`);
    const preview = pinnedEmbeddedJpegPath(
      cacheRootForLibrary(initialized.libraryId, cacheBase),
      id,
    );
    await mkdir(dirname(preview), { recursive: true });
    await writeFile(preview, Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]));
  }
  server = createServer((request, response) => {
    request.resume();
    setTimeout(() => response.writeHead(500).end(), 2);
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const selected: string[] = [];
  const observingHandle = Object.create(handle) as LibraryHandle;
  observingHandle.query = (async (sql: string, params?: unknown[]) => {
    const result = await handle!.query(sql, params);
    if (sql.includes("LEFT JOIN embeddings e") && sql.includes("ORDER BY p.id")) {
      selected.push(...(result.rows as Array<{ id: string }>).map((row) => row.id));
    }
    return result;
  }) as LibraryHandle["query"];
  const worker = new EmbedWorker({
    handle: observingHandle,
    env: {
      noDaemon: false,
      cacheRoot: cacheBase,
      gatewayApiKey: "explicit-key",
      gatewayUrl: `http://127.0.0.1:${address.port}`,
    },
    cwd: directory,
    foregroundBusy: () => false,
    pollCeilingMs: 1,
    attemptCooldownMs: 20,
  });

  worker.kick();
  await waitFor(() => selected.includes(ids.at(-1)!));
  expect(selected.slice(0, 120)).toEqual(ids);
  await worker.stop();
}, 10_000);

test("one missing preview does not starve later items in embed --all", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-isolation-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const missing = "0199a7c2-0000-7000-8000-000000000041";
  const valid = "0199a7c2-0000-7000-8000-000000000042";
  await seedPhoto(handle, missing, "missing");
  await seedPhoto(handle, valid, "valid");
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(
    cacheRootForLibrary(initialized.libraryId, cacheBase),
    valid,
  );
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");

  const result = await dispatch(
    {
      verb: "embed",
      args: ["--all"],
      cwd: directory,
      env: {
        noDaemon: true,
        cacheRoot: cacheBase,
        gatewayApiKey: "explicit-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({
    ok: false,
    code: "partial",
    summary: { ok: 1, failed: 1 },
    data: { failures_omitted: 0 },
    results: [{ id: missing, ok: false, code: "file_offline" }],
  });
  expect(await embeddingCount(handle)).toBe(1);
});

test("embed --all reports totals while bounding retained per-photo failures", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-bounded-all-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  for (let index = 1; index <= 101; index += 1) {
    const suffix = index.toString().padStart(12, "0");
    await seedPhoto(handle, `0199a7c2-0000-7000-8000-${suffix}`, `bounded-${index}`);
  }

  const result = await dispatch(
    {
      verb: "embed",
      args: ["--all"],
      cwd: directory,
      env: { noDaemon: true },
    },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({
    ok: false,
    code: "provider_unconfigured",
    summary: { ok: 0, failed: 101 },
    data: { failures_omitted: 1 },
  });
  const failures = "results" in result ? result.results : undefined;
  expect(failures).toHaveLength(100);
  expect(failures?.[0]).toMatchObject({
    id: "0199a7c2-0000-7000-8000-000000000001",
    ok: false,
    code: "provider_unconfigured",
  });
  expect(failures?.[99]).toMatchObject({
    id: "0199a7c2-0000-7000-8000-000000000100",
    ok: false,
    code: "provider_unconfigured",
  });
});

test("explicit embed batches reject input that cannot have a bounded response", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-explicit-limit-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;

  const result = await dispatch(
    {
      verb: "embed",
      args: Array.from(
        { length: 1_001 },
        (_, index) => `0199a7c2-0000-7000-8000-${index.toString().padStart(12, "0")}`,
      ),
      cwd: directory,
      env: { noDaemon: true },
    },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({ ok: false, code: "usage" });
});

test("explicit embed rejects an oversized ID without echoing it", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-id-limit-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;

  const result = await dispatch(
    {
      verb: "embed",
      args: ["x".repeat(10_000)],
      cwd: directory,
      env: { noDaemon: true },
    },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({ ok: false, code: "usage" });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1_000);
});

test("explicit duplicate IDs finish progress for every returned item", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-embed-duplicate-progress-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000051";
  await seedPhoto(handle, id, "duplicate-progress");
  const cacheBase = join(directory, "cache");
  const preview = pinnedEmbeddedJpegPath(cacheRootForLibrary(initialized.libraryId, cacheBase), id);
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const progress: Array<{ done: number; total: number }> = [];

  const result = await dispatch(
    {
      verb: "embed",
      args: [id, id],
      cwd: directory,
      env: {
        noDaemon: true,
        cacheRoot: cacheBase,
        gatewayApiKey: "explicit-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    {
      version: "test",
      library: handle,
      emit: (event) => {
        if (event.event === "progress") progress.push(event);
      },
    },
  );

  expect(result).toMatchObject({
    ok: true,
    summary: { ok: 2, failed: 0 },
    results: [
      { id, ok: true },
      { id, ok: true },
    ],
  });
  expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });
});

async function seedPhoto(database: LibraryHandle, id: string, suffix = "consent"): Promise<void> {
  await database.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, $2, 1, 1, 1, 1)`,
    [id, `ck_${suffix}`],
  );
  await database.query(
    `INSERT INTO volumes (uuid, last_mount, last_seen)
     VALUES ('fixture', '/fixture', now()) ON CONFLICT DO NOTHING`,
  );
  await database.query(
    `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
     VALUES ($1, $2, 'fixture', $3, now())`,
    [`0199a7c2-0000-7000-8001-${id.slice(-12)}`, id, `${suffix}.jpg`],
  );
}

async function embeddingCount(database: LibraryHandle): Promise<number> {
  return Number(
    (await database.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embeddings"))
      .rows[0]?.count ?? 0,
  );
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for embedding worker");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
