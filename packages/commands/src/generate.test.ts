import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
import {
  artifactPath,
  inspectGraphNode,
  retainedArtifacts,
  reconcileArtifactAvailability,
} from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import sharp from "sharp";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(async (cleanup) => await cleanup()));
});

test("generate rejects contradictory upscale flags before opening a library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-flags-"));
  cleanups.push(async () => await rm(parent, { recursive: true }));
  const result = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "a vase", "--upscale", "--no-upscale"],
      cwd: parent,
      env: { noDaemon: true, libraryPath: join(parent, "missing-library") },
    },
    { version: "test" },
  );
  expect(result).toMatchObject({ ok: false, code: "usage" });
});

test("reference-only generation sends variation intent and retains its source without importing it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-variation-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const requests: Array<{ path: string; fields: Readonly<Record<string, unknown>> }> = [];
  const gateway = await startGatewayFixture(0, {
    onImageRequest: ({ path, fields }) => requests.push({ path, fields }),
  });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const reference = join(parent, "reference.png");
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#ff0000" } })
    .png()
    .toBuffer();
  await writeFile(reference, bytes);
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--ref", reference, "--size", "4x4"],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected generation");
  const result = generateDataSchema.parse(envelope.data);
  expect(result).not.toHaveProperty("negative_prompt");
  expect(result).not.toHaveProperty("reference_strength");
  expect(result.reference.used).toBe(true);
  expect(requests).toEqual([
    {
      path: "/v1/images/edits",
      fields: expect.objectContaining({
        prompt:
          "Create a new variation of the reference image. Preserve its main subject and composition while varying visual details.",
      }),
    },
  ]);
  const node = await inspectGraphNode(handle, {
    photoId: result.id,
    nodeId: result.generation.node,
  });
  expect(node.parameters).toMatchObject({ prompt: requests[0]!.fields.prompt, prompt_version: 1 });
  expect(node.parameters).not.toHaveProperty("request.negative_prompt");
  expect(node.parameters).not.toHaveProperty("request.reference_strength");
  expect(node.inputNodeIds).toHaveLength(1);
  expect((await handle.query<{ id: string }>("SELECT id FROM photos")).rows).toEqual([
    { id: result.id },
  ]);
  expect(await readFile(reference)).toEqual(bytes);
});

test.each([false, true])(
  "generation refuses an unsupported required reference before buying an unrelated image (strength=%s)",
  async (strength) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-unsupported-reference-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const requests: string[] = [];
    const gateway = await startGatewayFixture(0, {
      onImageRequest: ({ path }) => requests.push(path),
    });
    cleanups.push(
      async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
      async () => await handle.close(),
      async () => await rm(parent, { recursive: true }),
    );
    const reference = join(parent, "reference.png");
    await writeFile(
      reference,
      await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
        .png()
        .toBuffer(),
    );
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("Fixture unavailable");
    const result = await dispatch(
      {
        verb: "generate",
        args: [
          "--ref",
          reference,
          "--model",
          "example/text-only",
          "--size",
          "4x4",
          ...(strength ? ["--prompt", "a vase", "--strength", "0.5"] : []),
        ],
        cwd: parent,
        env: {
          noDaemon: true,
          cacheRoot: join(parent, "cache"),
          gatewayApiKey: "fixture",
          gatewayUrl: `http://127.0.0.1:${address.port}`,
        },
      },
      { version: "test", library: handle },
    );
    expect(result).toMatchObject({ ok: false, code: "usage" });
    expect(requests).toEqual([]);
    expect((await handle.query("SELECT id FROM photos")).rows).toEqual([]);
    expect((await handle.query("SELECT id FROM provider_image_attempts")).rows).toEqual([]);
  },
);

test("reference-guided generation retains an immutable reachable image without importing another photo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-reference-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const paths: string[] = [];
  const gateway = await startGatewayFixture(0, { onImageRequest: ({ path }) => paths.push(path) });
  cleanups.push(
    async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
    async () => await handle.close(),
    async () => await rm(parent, { recursive: true }),
  );
  const reference = join(parent, "reference.png");
  await writeFile(
    reference,
    await sharp({ create: { width: 3, height: 2, channels: 3, background: "#ff0000" } })
      .png()
      .toBuffer(),
  );
  const address = gateway.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  const envelope = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "a red vase", "--ref", reference, "--size", "4x4"],
      cwd: parent,
      env: {
        noDaemon: true,
        cacheRoot: join(parent, "cache"),
        gatewayApiKey: "fixture",
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      },
    },
    { version: "test", library: handle },
  );
  expect(envelope).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected generation");
  const result = generateDataSchema.parse(envelope.data);
  expect(result.reference.used).toBe(true);
  expect(paths).toEqual(["/v1/images/edits"]);
  await rm(reference);
  const pinned = await handle.query<{ w: number; h: number; available: boolean }>(
    `
    SELECT artifact.w, artifact.h, artifact.artifact_available AS available
    FROM image_nodes AS generation
    JOIN image_node_inputs AS edge ON edge.photo_id = generation.photo_id AND edge.node_id = generation.id
    JOIN image_nodes AS reference ON reference.photo_id = edge.photo_id AND reference.id = edge.input_node_id
    JOIN image_artifacts AS artifact ON artifact.artifact_hash = reference.parameters->>'artifact_hash'
    WHERE generation.photo_id = $1 AND generation.kind = 'generate' AND reference.kind = 'source'
  `,
    [result.id],
  );
  expect(pinned.rows).toEqual([{ w: 3, h: 2, available: true }]);
  const generation = await inspectGraphNode(handle, {
    photoId: result.id,
    nodeId: result.generation.node,
  });
  const leaf = await inspectGraphNode(handle, {
    photoId: result.id,
    nodeId: generation.inputNodeIds[0]!,
  });
  const pins = leaf.parameters as { artifact_hash: string; encoded_artifact_hash: string };
  expect(leaf.executions).toEqual([]);
  expect(await retainedArtifacts(handle)).toEqual(
    expect.arrayContaining([
      { artifactHash: pins.artifact_hash, available: true },
      { artifactHash: pins.encoded_artifact_hash, available: true },
    ]),
  );
  expect(leaf.artifactAvailable).toBe(true);
  const encodedPath = artifactPath(handle.path, pins.encoded_artifact_hash, "png");
  const encoded = await readFile(encodedPath);
  await writeFile(encodedPath, "corrupt reference");
  expect(await reconcileArtifactAvailability(handle, handle.path)).toMatchObject({
    unavailable: 1,
  });
  expect(await retainedArtifacts(handle)).toEqual(
    expect.arrayContaining([{ artifactHash: pins.encoded_artifact_hash, available: false }]),
  );
  await writeFile(encodedPath, encoded);
  expect(await reconcileArtifactAvailability(handle, handle.path)).toMatchObject({
    unavailable: 0,
  });
  expect((await handle.query<{ id: string }>("SELECT id FROM photos")).rows).toEqual([
    { id: result.id },
  ]);
  const developed = await dispatch(
    {
      verb: "develop",
      args: [result.id, "--set", "exposure=1"],
      cwd: parent,
      env: { noDaemon: true, cacheRoot: join(parent, "cache") },
    },
    { version: "test", library: handle },
  );
  expect(developed).toMatchObject({ ok: true });
});

test.each([{ upscaleFlags: [] }, { upscaleFlags: ["--no-upscale"] }])(
  "generate imports the canonical provider artifact with durable provenance and no automatic upscale ($upscaleFlags)",
  async ({ upscaleFlags }) => {
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
        args: [
          "--prompt",
          "blue hour mountains",
          "--size",
          "40x30",
          "--seed",
          "17",
          ...upscaleFlags,
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
          "SELECT volume_uuid, rel_path FROM files JOIN originals ON originals.id = files.original_id WHERE originals.photo_id = $1",
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
  },
);

test.each(["flag", "model"])(
  "explicit generate upscale via %s reaches the requested size and sends a normalized reference",
  async (selection) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-generate-upscale-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const referencePath = join(parent, "reference.jpg");
    await sharp({ create: { width: 8, height: 6, channels: 3, background: "#aa7733" } })
      .jpeg()
      .toFile(referencePath);
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const uploads: Array<{
      path: string;
      fields: Readonly<Record<string, unknown>>;
      files: ReadonlySet<string>;
    }> = [];
    const gateway = await startGatewayFixture(0, {
      imageMode: "smallerdims",
      onRequest: (request) => requests.push(request),
      onImageRequest: (request) => uploads.push(request),
    });
    cleanups.push(
      async () => await new Promise<void>((resolve) => gateway.close(() => resolve())),
      async () => await handle.close(),
      async () => await rm(parent, { recursive: true }),
    );
    const address = gateway.address();
    if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
    if (selection === "model") {
      await handle.query(
        `INSERT INTO settings (key, value) VALUES ('models', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify({ upscale: "unavailable/library-model" })],
      );
    }
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
          ...(selection === "model"
            ? ["--no-upscale", "--upscale-model", "photoctl/fake-upscale-v1"]
            : ["--upscale"]),
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
      path: "/v1/images/edits",
    });
    expect(uploads[0]).toMatchObject({ fields: { size: "40x30" } });
    expect(uploads[0]!.files).toEqual(new Set(["image[]"]));
    const originals = await handle.query(
      `SELECT attempt.request->>'operation' AS operation, attempt.state, artifact.w, artifact.h FROM provider_image_attempts attempt JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash ORDER BY attempt.created_at, attempt.id`,
    );
    expect(originals.rows).toEqual([
      { operation: "generate", state: "committed", w: 20, h: 15 },
      { operation: "upscale", state: "committed", w: 40, h: 30 },
    ]);
    if (selection === "model") {
      await handle.query(`UPDATE settings SET value = '{}'::jsonb WHERE key = 'providers'`);
      const unconfigured = await dispatch(
        {
          verb: "generate",
          args: [
            "--prompt",
            "a vase",
            "--size",
            "40x30",
            "--upscale-model",
            "photoctl/fake-upscale-v1",
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
      expect(unconfigured).toMatchObject({
        ok: true,
        data: {
          artifact: { w: 20, h: 15 },
          upscale: { enabled: true, executed: false, warnings: [{ code: "upscale_unconfigured" }] },
        },
      });
      expect(
        (
          await handle.query(
            `SELECT id FROM provider_image_attempts WHERE request->>'operation' = 'upscale'`,
          )
        ).rows,
      ).toHaveLength(1);
    }
  },
);

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
