import {
  hybridSearch,
  initializeLibrary,
  upsertPhotoEmbedding,
  type LibraryHandle,
} from "@photoctl/library";
import { startGatewayFixture } from "@photoctl/test-harness";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";

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

test("hybrid search returns tag-only and vector-only hits in deterministic RRF order", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-search-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const textId = "0199a7c2-0000-7000-8000-000000000011";
  const vectorId = "0199a7c2-0000-7000-8000-000000000012";
  await seedPhoto(handle, textId, "text.jpg");
  await seedPhoto(handle, vectorId, "vector.jpg");
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'ceremony')", [textId]);

  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const queryBody = Buffer.from(
    JSON.stringify({
      model: "google/gemini-embedding-2",
      dimensions: 3_072,
      input: ["ceremony"],
    }),
  );
  const queryVector = deterministicVector(queryBody, 0);
  await upsertPhotoEmbedding(handle, vectorId, "google/gemini-embedding-2", queryVector);

  const result = await dispatch(
    {
      verb: "search",
      args: ["ceremony"],
      cwd: directory,
      env: {
        noDaemon: true,
        gatewayApiKey: "explicit-test-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({
    ok: true,
    data: {
      hits: [
        { id: textId, file: "text.jpg", sources: ["text"] },
        { id: vectorId, file: "vector.jpg", sources: ["vector"] },
      ],
    },
  });
});

test("search without an explicit key stays text-only and warns", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-search-keyless-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000021";
  await seedPhoto(handle, id, "events/wedding.jpg");
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'ceremony')", [id]);

  const result = await dispatch(
    { verb: "search", args: ["ceremony"], cwd: directory, env: { noDaemon: true } },
    { version: "test", library: handle },
  );

  expect(result).toMatchObject({
    ok: true,
    data: { hits: [{ id, file: "wedding.jpg", sources: ["text"] }] },
    warnings: [{ code: "provider_unconfigured" }],
  });
  expect(
    await dispatch(
      { verb: "search", args: ["events wedding"], cwd: directory, env: { noDaemon: true } },
      { version: "test", library: handle },
    ),
  ).toMatchObject({
    ok: true,
    data: { hits: [{ id, file: "wedding.jpg", sources: ["text"] }] },
  });
});

test("text search normalizes filename, folder, and tag punctuation like the index", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-search-punctuation-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const cases = [
    ["0199a7c2-0000-7000-8000-000000000024", "IMG_1234.JPG", "IMG_1234.JPG"],
    ["0199a7c2-0000-7000-8000-000000000025", "foo-bar.jpg", "foo-bar.jpg"],
    ["0199a7c2-0000-7000-8000-000000000026", "events/wedding.jpg", "events/wedding.jpg"],
  ] as const;
  for (const [id, file] of cases) await seedPhoto(handle, id, file);
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'Anna & Ben')", [cases[0][0]]);

  for (const [id, _file, query] of cases) {
    const result = await dispatch(
      { verb: "search", args: [query], cwd: directory, env: { noDaemon: true } },
      { version: "test", library: handle },
    );
    expect(result).toMatchObject({ ok: true, data: { hits: [{ id, sources: ["text"] }] } });
  }
  expect(
    await dispatch(
      { verb: "search", args: ["Anna & Ben"], cwd: directory, env: { noDaemon: true } },
      { version: "test", library: handle },
    ),
  ).toMatchObject({
    ok: true,
    data: { hits: [{ id: cases[0][0], sources: ["text"] }] },
  });
  expect(
    await dispatch(
      { verb: "search", args: ["!!!"], cwd: directory, env: { noDaemon: true } },
      { version: "test", library: handle },
    ),
  ).toMatchObject({ ok: true, data: { hits: [] } });
});

test("search keeps text hits when the optional vector provider rejects or cannot serve", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-search-provider-fallback-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  const id = "0199a7c2-0000-7000-8000-000000000022";
  await seedPhoto(handle, id, "events/reception.jpg");
  await handle.query("INSERT INTO tags (photo_id, tag) VALUES ($1, 'ceremony')", [id]);
  let status = 401;
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(status, { "retry-after": "0" }).end();
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind TCP");
  const hits: unknown[] = [];
  const events: unknown[] = [];

  expect(
    await dispatch(
      {
        verb: "search",
        args: ["ceremony"],
        cwd: directory,
        env: {
          noDaemon: true,
          gatewayApiKey: "expired-key",
          gatewayUrl: `http://127.0.0.1:${address.port}`,
        },
      },
      { version: "test", library: handle },
    ),
  ).toMatchObject({
    ok: true,
    data: { hits: [{ id, file: "reception.jpg", sources: ["text"] }] },
    warnings: [{ code: "provider_unconfigured" }],
  });

  status = 429;
  const result = await dispatch(
    {
      verb: "search",
      args: ["ceremony", "--stream"],
      cwd: directory,
      env: {
        noDaemon: true,
        gatewayApiKey: "expired-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    {
      version: "test",
      library: handle,
      stream: (hit) => hits.push(hit),
      emit: (event) => events.push(event),
    },
  );

  expect(result).toMatchObject({
    ok: true,
    data: { hits: [] },
    warnings: [{ code: "provider_warning" }],
  });
  expect(hits).toMatchObject([{ id, file: "reception.jpg", sources: ["text"] }]);
  expect(events).toContainEqual(
    expect.objectContaining({ event: "warn", code: "provider_warning" }),
  );

  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" }).end("not-json");
  });
  await new Promise<void>((resolveListen) => server!.listen(0, "127.0.0.1", resolveListen));
  const malformedAddress = server.address();
  if (!malformedAddress || typeof malformedAddress === "string") {
    throw new Error("fixture did not bind TCP");
  }
  expect(
    await dispatch(
      {
        verb: "search",
        args: ["ceremony"],
        cwd: directory,
        env: {
          noDaemon: true,
          gatewayApiKey: "explicit-key",
          gatewayUrl: `http://127.0.0.1:${malformedAddress.port}`,
        },
      },
      { version: "test", library: handle },
    ),
  ).toMatchObject({
    ok: true,
    data: { hits: [{ id, file: "reception.jpg", sources: ["text"] }] },
    warnings: [{ code: "provider_warning" }],
  });
});

test("vector ranking returns every current-model hit despite many closer old-model rows", async () => {
  directory = await mkdtemp(join(tmpdir(), "photoctl-search-model-filter-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  handle = initialized.handle;
  await handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     SELECT ('0199a7c2-0000-7000-8000-' || lpad(value::text, 12, '0'))::uuid,
            'ck_model_' || value::text, 1, 1, 1, 1
     FROM generate_series(1, 123) AS value`,
  );
  const queryVector = [1, ...Array(3_071).fill(0)];
  const currentVector = [0, 1, ...Array(3_070).fill(0)];
  await handle.query(
    `INSERT INTO embeddings (photo_id, model, vec, created_at)
     SELECT id, 'old-model', $1::halfvec, now() FROM photos
     WHERE id > '0199a7c2-0000-7000-8000-000000000003'::uuid`,
    [`[${queryVector.join(",")}]`],
  );
  await handle.query(
    `INSERT INTO embeddings (photo_id, model, vec, created_at)
     SELECT id, 'current-model', $1::halfvec, now() FROM photos
     WHERE id <= '0199a7c2-0000-7000-8000-000000000003'::uuid`,
    [`[${currentVector.join(",")}]`],
  );
  await handle.query("SET enable_seqscan = off");
  let vectorQuery: { sql: string; params: unknown[] } | undefined;
  const observingHandle = Object.create(handle) as LibraryHandle;
  observingHandle.query = (async (sql: string, params: unknown[] = []) => {
    if (sql.includes("ORDER BY vec <=>")) vectorQuery = { sql, params };
    return await handle!.query(sql, params);
  }) as LibraryHandle["query"];

  const hits = await hybridSearch(observingHandle, "no text match", 50, {
    vector: queryVector,
    model: "current-model",
  });

  expect(hits.map((hit) => hit.id)).toEqual([
    "0199a7c2-0000-7000-8000-000000000001",
    "0199a7c2-0000-7000-8000-000000000002",
    "0199a7c2-0000-7000-8000-000000000003",
  ]);
  if (!vectorQuery) throw new Error("vector query was not observed");
  const plan = await handle.query<{ "QUERY PLAN": string }>(
    `EXPLAIN ${vectorQuery.sql}`,
    vectorQuery.params,
  );
  const planText = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
  expect(planText).toContain("CTE Scan on matching");
  expect(planText).not.toContain("embeddings_vec_hnsw");
});

async function seedPhoto(database: LibraryHandle, id: string, file: string): Promise<void> {
  await database.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, $2, 1, 1, 1, 1)`,
    [id, `ck_${id.slice(-8)}`],
  );
  await database.query(
    `INSERT INTO volumes (uuid, last_mount, last_seen)
     VALUES ('fixture', '/fixture', now()) ON CONFLICT DO NOTHING`,
  );
  await database.query(
    `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
     VALUES ($1, $2, 'fixture', $3, now())`,
    [`0199a7c2-0000-7000-8001-${id.slice(-12)}`, id, file],
  );
}

function deterministicVector(bytes: Buffer, index: number): number[] {
  const digest = createHash("sha256").update(bytes).update(String(index)).digest();
  return Array.from(
    { length: 3_072 },
    (_, offset) => (digest[offset % digest.length]! - 127.5) / 127.5,
  );
}
