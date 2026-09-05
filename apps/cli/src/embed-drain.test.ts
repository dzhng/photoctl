import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { initializeLibrary, newLibraryEntityId, openLibrary } from "@photoctl/library";
import { dispatch } from "@photoctl/commands";
import { measureProcessTiming, spawnPhotoctl } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const directories: string[] = [];
let gateway: Server | undefined;
let daemonCleanup: { library: string; env: Record<string, string> } | undefined;
afterEach(async () => {
  if (daemonCleanup) {
    await spawnPhotoctl(["daemon", "stop"], {
      libraryDir: daemonCleanup.library,
      env: daemonCleanup.env,
    }).catch(() => undefined);
  }
  await new Promise<void>((resolveClose) => gateway?.close(() => resolveClose()) ?? resolveClose());
  await Promise.all(
    directories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true, force: true })),
  );
  gateway = undefined;
  daemonCleanup = undefined;
});

test("rate p95 stays within 2x warm show p50 while thirty embedding batches drain", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-drain-"));
  directories.push(directory);
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  const initialized = await initializeLibrary(library);
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
    { version: "test", library: initialized.handle },
  );
  if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
  const target = (imported.data as { ids: string[] }).ids[0]!;
  const extraIds = Array.from({ length: 1_499 }, () => newLibraryEntityId());
  const fileIds = extraIds.map(() => newLibraryEntityId());
  await initialized.handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     SELECT id, 'drain_' || id::text, 1, 1, 1, 1
     FROM unnest($1::uuid[]) AS item(id)`,
    [extraIds],
  );
  await initialized.handle.query(
    `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
     SELECT file_id, photo_id, 'fixture', 'drain/' || photo_id::text || '.jpg', now()
     FROM unnest($1::uuid[], $2::uuid[]) AS item(file_id, photo_id)`,
    [fileIds, extraIds],
  );
  const cacheRoot = cacheRootForLibrary(initialized.libraryId, cache);
  const template = join(directory, "preview.jpg");
  await writeFile(template, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  for (let offset = 0; offset < extraIds.length; offset += 100) {
    await Promise.all(
      extraIds.slice(offset, offset + 100).map(async (id) => {
        const path = pinnedEmbeddedJpegPath(cacheRoot, id);
        await mkdir(dirname(path), { recursive: true });
        await link(template, path);
      }),
    );
  }
  await initialized.handle.close();

  const timing = await measureProcessTiming();
  const commonEnv = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: cache,
    PHOTOCTL_VOLUME_MAP: `${process.cwd()}=fixture:online`,
    // This gate measures foreground latency; keep the client idle timeout well
    // above the Float32 source-render cost so it cannot become the verdict.
    PHOTOCTL_LOCK_BUDGET_MS: String(Math.max(timing.lockBudgetMs, 10_000)),
    PHOTOCTL_POLL_CEILING_MS: String(timing.pollCeilingMs),
  };
  daemonCleanup = { library, env: commonEnv };
  await spawnPhotoctl(["show", target], { libraryDir: library, env: commonEnv });
  const showTimes: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    const shown = await spawnPhotoctl(["show", target], { libraryDir: library, env: commonEnv });
    expect(shown, JSON.stringify(shown)).toMatchObject({ code: 0 });
    showTimes.push(performance.now() - start);
  }
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env: commonEnv });

  const handle = await openLibrary(library);
  await handle.query(`UPDATE settings SET value = '"auto"'::jsonb WHERE key = 'embed_mode'`);
  await handle.close();

  let requests = 0;
  gateway = createServer(async (request, response) => {
    await embeddingResponse(request, response);
    requests += 1;
  });
  await new Promise<void>((resolveListen) => gateway!.listen(0, "127.0.0.1", resolveListen));
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("gateway did not bind TCP");
  const drainEnv = {
    ...commonEnv,
    AI_GATEWAY_API_KEY: "explicit-auto-consent",
    PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
  };
  expect(
    (await spawnPhotoctl(["daemon", "start"], { libraryDir: library, env: drainEnv })).code,
  ).toBe(0);
  await waitFor(() => requests > 0);

  const rateTimes: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const start = performance.now();
    expect(
      (
        await spawnPhotoctl(["rate", target, "--stars", String(index % 6)], {
          libraryDir: library,
          env: drainEnv,
        })
      ).code,
    ).toBe(0);
    rateTimes.push(performance.now() - start);
  }
  await waitFor(() => requests >= 1_500, 60_000);
  await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env: drainEnv });

  const verified = await openLibrary(library);
  const embedded = Number(
    (await verified.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM embeddings"))
      .rows[0]?.count ?? 0,
  );
  await verified.close();
  const showP50 = percentile(showTimes, 0.5);
  const rateP95 = percentile(rateTimes, 0.95);
  expect(embedded).toBe(1_500);
  expect(rateP95).toBeLessThanOrEqual(showP50 * 2);
}, 90_000);

async function embeddingResponse(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let received = 0;
  for await (const chunk of request) received += Buffer.byteLength(chunk as Uint8Array);
  if (received === 0) throw new Error("embedding request body is empty");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  const bytes = JSON.stringify({
    data: [{ embedding: Array(3_072).fill(0.125) }],
  });
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(bytes),
  });
  response.end(bytes);
}

function percentile(values: number[], fraction: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the embedding drain");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}
