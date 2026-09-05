import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import sharp from "sharp";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
});

test("generate imports the canonical provider artifact with durable provenance and no automatic upscale", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const gateway = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onRequest: (request) => requests.push(request),
  });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  await handle.query(
    `INSERT INTO settings (key, value) VALUES ('providers', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } })],
  );

  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "blue hour mountains", "--size", "40x30", "--seed", "17"],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );

  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected success data");
  const generated = generateDataSchema.parse(envelope.data);
  expect(generated).toMatchObject({
    requested: { w: 40, h: 30 },
    tag: "generated",
    generation: { returned: { w: 20, h: 15 } },
    artifact: { w: 20, h: 15, media_type: "image/tiff" },
    upscale: {
      enabled: false,
      executed: false,
      input: { w: 20, h: 15 },
      target: { w: 40, h: 30 },
      final: { w: 20, h: 15 },
    },
    executions: [{ kind: "generate", reused: false }],
  });
  expect(requests).toEqual([
    {
      path: "/v1/images/generations",
      body: {
        model: "openai/gpt-image-2",
        prompt: "blue hour mountains",
        size: "40x30",
        output_format: "png",
        seed: 17,
      },
    },
  ]);
  expect(
    (
      await handle.query<{ tag: string }>("SELECT tag FROM tags WHERE photo_id = $1", [
        generated.id,
      ])
    ).rows,
  ).toEqual([{ tag: "generated" }]);
  expect(
    (
      await handle.query<{ volume_uuid: string; rel_path: string }>(
        "SELECT volume_uuid, rel_path FROM files WHERE photo_id = $1",
        [generated.id],
      )
    ).rows,
  ).toEqual([
    {
      volume_uuid: "photoctl-library",
      rel_path: expect.stringMatching(/^artifacts\/sha256\/[0-9a-f]{2}\/a_[0-9a-f]{64}\.tif$/),
    },
  ]);
  expect(
    (
      await handle.query<{ kind: string; recipe_version: number; inputs: string }>(
        `SELECT node.kind, node.recipe_version,
          (SELECT count(*)::text FROM image_node_inputs WHERE photo_id = node.photo_id AND node_id = node.id) AS inputs
         FROM image_nodes AS node WHERE node.photo_id = $1`,
        [generated.id],
      )
    ).rows,
  ).toEqual(
    expect.arrayContaining([
      { kind: "generate", recipe_version: 2, inputs: "0" },
      { kind: "output", recipe_version: 1, inputs: "1" },
    ]),
  );
  expect(
    (
      await handle.query<{ provider_execution: { seed: number; target_px: number } }>(
        "SELECT provider_execution FROM node_executions WHERE photo_id = $1",
        [generated.id],
      )
    ).rows[0]?.provider_execution,
  ).toMatchObject({ seed: 17, target_px: 1200 });
});

test("explicit generate upscale reaches the requested size and sends a normalized reference", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-upscale-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const referencePath = join(parent, "reference.jpg");
  await sharp({ create: { width: 8, height: 6, channels: 3, background: "#aa7733" } })
    .jpeg()
    .toFile(referencePath);
  const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const gateway = await startGatewayFixture(0, {
    imageMode: "smallerdims",
    onRequest: (request) => requests.push(request),
  });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  await handle.query(
    `INSERT INTO settings (key, value) VALUES ('providers', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } })],
  );

  const envelope = await dispatch(
    {
      verb: "generate",
      args: [
        "--prompt",
        "blue hour mountains",
        "--ref",
        referencePath,
        "--size",
        "40x30",
        "--upscale",
      ],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected success data");
  const generated = generateDataSchema.parse(envelope.data);
  expect(generated).toMatchObject({
    reference: { used: true },
    artifact: { w: 40, h: 30 },
    upscale: {
      enabled: true,
      executed: true,
      input: { w: 20, h: 15 },
      target: { w: 40, h: 30 },
      generated: { w: 40, h: 30 },
      final: { w: 40, h: 30 },
      density_satisfied: true,
    },
    executions: [{ kind: "generate" }, { kind: "upscale" }],
  });
  expect(requests[0]).toMatchObject({
    path: "/v1/images/generations",
    body: { size: "40x30", reference_image: expect.stringMatching(/^data:image\/png;base64,/) },
  });
});

test("generate provider geometry failure leaves no catalog or graph state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-failure-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const gateway = await startGatewayFixture(0, { imageMode: "wrongaspect" });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");

  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "invalid geometry", "--size", "40x30"],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );
  expect(envelope).toMatchObject({ ok: false });
  expect(
    (
      await handle.query<{ photos: string; tags: string; executions: string }>(
        `SELECT
          (SELECT count(*)::text FROM photos) AS photos,
          (SELECT count(*)::text FROM tags) AS tags,
          (SELECT count(*)::text FROM node_executions) AS executions`,
      )
    ).rows,
  ).toEqual([{ photos: "0", tags: "0", executions: "0" }]);
});

test("generate without gateway credentials fails before catalog mutation", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-unconfigured-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  cleanups.push(
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );

  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "no credentials", "--size", "40x30"],
      cwd: parent,
      env: { noDaemon: true, cacheRoot: join(parent, "cache") },
    },
    { version: "test", library: handle },
  );
  expect(envelope).toMatchObject({ ok: false, code: "provider_unconfigured" });
  expect((await handle.query("SELECT 1 FROM photos")).rows).toEqual([]);
});

test("explicit upscale preserves provider pixels that already cover the requested size", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-covered-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const gateway = await startGatewayFixture(0, { imageMode: "wrongdims" });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  await handle.query(
    `INSERT INTO settings (key, value) VALUES ('providers', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } })],
  );

  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "already large", "--size", "40x30", "--upscale"],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture-key",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected success data");
  expect(generateDataSchema.parse(envelope.data)).toMatchObject({
    requested: { w: 40, h: 30 },
    generation: { returned: { w: 80, h: 60 } },
    artifact: { w: 80, h: 60 },
    upscale: { enabled: true, executed: false, final: { w: 80, h: 60 } },
    executions: [{ kind: "generate" }],
  });
});
