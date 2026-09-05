/* eslint-disable no-await-in-loop -- Public command order is the contract under test. */
import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import {
  evaluateGraphNode,
  readArtifactLinear,
  readArtifactMask,
} from "@photoctl/render";
import { exitCodeFor, fillStrictDataSchema } from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import type { Server } from "node:http";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("strict fill commits generated pixels through a mask composite without changing uncovered samples", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const before = await revisionCount(fixture);

    const filled = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [fixture.id, "--layer", segmented.layer_id, "--remove"]),
      ),
    );

    expect(filled).toMatchObject({
      graph: {
        layer: segmented.layer_id,
      },
      generation: {
        adapter: "gateway-image-v1",
        model: "openai/gpt-image-2",
        resampled: false,
      },
      composite: {
        unmasked_bit_exact: true,
      },
    });
    expect(filled.graph.output_node).toMatch(/^node_[0-9a-f]{64}$/);
    expect(filled.graph.render_hash).toMatch(/^r_[0-9a-f]{64}$/);
    expect(filled.generation.node).toMatch(/^node_[0-9a-f]{64}$/);
    expect(filled.composite.node).toMatch(/^node_[0-9a-f]{64}$/);
    expect(await revisionCount(fixture)).toBe(before + 1);
    expect(filled.graph.revision).toMatch(/^[0-9a-f-]{36}$/);
    expect(filled).not.toHaveProperty("preview");
    await expect(
      access(
        join(fixture.env.cacheRoot, "view", fixture.id, filled.graph.render_hash, "master.jpg"),
      ),
    ).rejects.toThrow();

    const graph = success(await command(fixture, "graph", ["show", fixture.id])) as {
      nodes: Array<{ id: string; kind: string; input_node_ids: string[] }>;
    };
    expect(graph.nodes.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["generate", "resample", "mask_composite", "composite"]),
    );

    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.composite.node,
      source: fixture.sourceProducer,
    });
    const result = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );
    const compositeNode = graph.nodes.find(({ id }) => id === filled.composite.node)!;
    const baseNode = compositeNode.input_node_ids[0]!;
    const maskNode = compositeNode.input_node_ids[2]!;
    const base = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: baseNode,
      source: fixture.sourceProducer,
    });
    const mask = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: maskNode,
      source: fixture.sourceProducer,
    });
    const basePixels = (await readArtifactLinear(base.artifact.path, base.artifact.artifactHash))
      .data;
    const maskPixels = (await readArtifactMask(mask.artifact.path, mask.artifact.artifactHash))
      .data;
    for (let pixel = 0; pixel < maskPixels.length; pixel += 1) {
      if (maskPixels[pixel] === 0) {
        expect(result.data.slice(pixel * 3, pixel * 3 + 3)).toEqual(
          basePixels.slice(pixel * 3, pixel * 3 + 3),
        );
      }
    }
  } finally {
    await fixture.handle.close();
  }
});

test("same-ratio provider dimensions are normalized deterministically and recorded in the DAG", async () => {
  const fixture = await fillFixture("wrongdims");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const filled = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--remove",
          "--pad",
          "0",
        ]),
      ),
    );

    expect(filled.generation).toEqual(
      expect.objectContaining({ resampled: true, returned: { w: 32, h: 32 } }),
    );
    const graph = success(await command(fixture, "graph", ["show", fixture.id])) as {
      nodes: Array<{ id: string; kind: string }>;
    };
    const resampleId = graph.nodes.find(({ kind }) => kind === "resample")?.id;
    expect(resampleId).toMatch(/^node_[0-9a-f]{64}$/);
    const resample = success(
      await command(fixture, "graph", ["node", fixture.id, resampleId!]),
    ) as {
      parameters: unknown;
    };
    expect(resample.parameters).toEqual({
      w: 40,
      h: 30,
      kernel: "lanczos3",
    });
    const generationId = graph.nodes.find(({ kind }) => kind === "generate")?.id;
    const generation = success(
      await command(fixture, "graph", ["node", fixture.id, generationId!]),
    ) as { parameters: { request: { crop: number[] } } };
    expect(generation.parameters.request.crop).toEqual([0, 0, 16, 16]);
    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.composite.node,
      source: fixture.sourceProducer,
    });
    expect(evaluated.artifact).toMatchObject({ w: 40, h: 30 });
  } finally {
    await fixture.handle.close();
  }
});

test("strict fill rejects a whole-frame provider result with data exit 65 and no revision", async () => {
  const fixture = await fillFixture("wholeframe");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const before = await revisionCount(fixture);

    const refused = await command(fixture, "fill", [
      fixture.id,
      "--layer",
      segmented.layer_id,
      "--remove",
    ]);

    expect(refused).toMatchObject({ ok: false, code: "provider_whole_frame" });
    expect(exitCodeFor("provider_whole_frame")).toBe(65);
    expect(await revisionCount(fixture)).toBe(before);
    expect(await generatedExecutionCount(fixture)).toBe(0);
  } finally {
    await fixture.handle.close();
  }
});

test("an unexplained provider aspect change is discarded before graph activation", async () => {
  const fixture = await fillFixture("wrongaspect");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const before = await revisionCount(fixture);

    expect(
      await command(fixture, "fill", [fixture.id, "--layer", segmented.layer_id, "--remove"]),
    ).toMatchObject({ ok: false, code: "provider_whole_frame" });
    expect(await revisionCount(fixture)).toBe(before);
    expect(await generatedExecutionCount(fixture)).toBe(0);
  } finally {
    await fixture.handle.close();
  }
});

test("prompt fill stores the exact instruction in its immutable generation recipe", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const prompt = "Replace the selection with a small blue vase";
    const filled = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--prompt",
          prompt,
        ]),
      ),
    );
    const generation = success(
      await command(fixture, "graph", ["node", fixture.id, filled.generation.node]),
    ) as { parameters: { prompt: string; prompt_version: number } };
    expect(generation.parameters).toMatchObject({ prompt, prompt_version: 1 });
  } finally {
    await fixture.handle.close();
  }
});

async function fillFixture(mode?: "wrongdims" | "wholeframe" | "wrongaspect") {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-strict-"));
  directories.push(parent);
  const source = join(parent, "source.png");
  const pixels = Buffer.alloc(40 * 30 * 3);
  for (let index = 0; index < pixels.length; index += 3) {
    pixels[index] = (index / 3) % 251;
    pixels[index + 1] = 80;
    pixels[index + 2] = 160;
  }
  await sharp(pixels, { raw: { width: 40, height: 30, channels: 3 } })
    .png()
    .toFile(source);
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const env = {
    noDaemon: true,
    cacheRoot: join(parent, "cache"),
    volumeMap: `${parent}=fixture-volume:online`,
  };
  const imported = success(
    await dispatch(
      { verb: "import", args: [source, "--link"], cwd: parent, env },
      { version: "test", library: handle },
    ),
  ) as { ids: string[] };
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture gateway unavailable");
  const rawGateway = new GatewayClient({
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  const gateway = {
    imageEdits: async (form: FormData) => {
      if (mode) form.set("fixture_mode", mode);
      return await rawGateway.imageEdits(form);
    },
  };
  const sourceProducer = async () => ({
    image: {
      w: 40,
      h: 30,
      data: new Float32Array(40 * 30 * 3).fill(0.25),
      orientationApplied: true as const,
      space: "scene-linear-rec2020" as const,
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    },
    provenance: {
      locator: {
        kind: "online-file" as const,
        volume_uuid: "fixture-volume",
        rel_path: "source.png",
      },
      tier: "online-file" as const,
      w: 40,
      h: 30,
      decoderId: "fixture",
      decoderVersion: "1",
    },
  });
  return {
    parent,
    handle,
    env,
    id: imported.ids[0]!,
    fill: {
      adapter: new GatewayImageModelAdapter({
        model: "openai/gpt-image-2",
        mask: "native",
        maskPolarity: "transparent-edits",
      }),
      gateway,
      model: "openai/gpt-image-2",
      source: sourceProducer,
    },
    sourceProducer,
  };
}

async function command(
  fixture: Awaited<ReturnType<typeof fillFixture>>,
  verb: string,
  args: string[],
) {
  return await dispatch(
    { verb, args, cwd: fixture.parent, env: fixture.env },
    { version: "test", library: fixture.handle, fill: fixture.fill },
  );
}

function success(envelope: Awaited<ReturnType<typeof dispatch>>): unknown {
  expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
  if (!envelope.ok || !("data" in envelope)) throw new Error("Expected data envelope");
  return envelope.data;
}

async function revisionCount(fixture: {
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"];
}) {
  return Number(
    (
      await fixture.handle.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM document_revisions",
      )
    ).rows[0]!.count,
  );
}

async function generatedExecutionCount(fixture: {
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"];
}) {
  return Number(
    (
      await fixture.handle.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM node_executions AS execution
         JOIN image_nodes AS node ON node.photo_id = execution.photo_id AND node.id = execution.node_id
         WHERE node.kind = 'generate'`,
      )
    ).rows[0]!.count,
  );
}
