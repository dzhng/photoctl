/* eslint-disable no-await-in-loop -- Public command order is the contract under test. */
import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import {
  evaluateGraphNode,
  planOutputDensity,
  readArtifactLinear,
  readArtifactMask,
  loadActiveDocument,
  describeFillBranch,
  applyDevelopGeometry,
  inspectGraphNode,
  canonicalJson,
  deterministicExecutionId,
  normalizeArtifact,
  publishArtifact,
  registerPublishedArtifact,
  writePreviewArtifact,
  developFrame,
  srgb2014ProfilePath,
} from "@photoctl/render";
import { exitCodeFor, fillStrictDataSchema } from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import type { Server } from "node:http";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

const directories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("historical fill frames recover without replaying paid generation", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const filled = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [fixture.id, "--layer", segmented.layer_id, "--remove"]),
      ),
    );
    const evaluate = async () =>
      await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: filled.composite.node,
        source: fixture.sourceProducer,
      });
    const before = await evaluate();
    const paidBefore = await fixture.handle.query(
      "SELECT execution_id, output_artifact_hash FROM node_executions WHERE photo_id = $1 AND NOT deterministic",
      [fixture.id],
    );
    await fixture.handle.query(
      "UPDATE node_executions SET render_frame = NULL WHERE photo_id = $1",
      [fixture.id],
    );
    const recovered = await evaluate();
    expect(recovered.artifact.artifactHash).toBe(before.artifact.artifactHash);
    expect(recovered.executionId).toBe(before.executionId);
    const paid = await fixture.handle.query(
      "SELECT execution_id, output_artifact_hash FROM node_executions WHERE photo_id = $1 AND NOT deterministic",
      [fixture.id],
    );
    expect(paid.rows).toEqual(paidBefore.rows);
  } finally {
    await fixture.handle.close();
  }
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

test("same-ratio provider dimensions remain intrinsic until the graph placement", async () => {
  const fixture = await fillFixture("wrongdims");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
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

    expect(filled.generation).toEqual(expect.objectContaining({ returned: { w: 32, h: 32 } }));
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
    const generationId = graph.nodes.find(({ kind }) => kind === "generate")?.id;
    const generation = success(
      await command(fixture, "graph", ["node", fixture.id, generationId!]),
    ) as { parameters: { request: { crop: number[] } } };
    expect(generation.parameters.request.crop).toEqual([16, 0, 16, 16]);
    const generated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: generationId!,
      source: fixture.sourceProducer,
    });
    expect(generated.artifact).toMatchObject({ w: 32, h: 32 });
    expect(
      planOutputDensity({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: 16, h: 16 },
        },
        generated: {
          id: generated.artifact.artifactHash,
          dimensions: { w: generated.artifact.w, h: generated.artifact.h },
        },
        cachedUpscales: [],
        supportedScales: [2, 4],
        limits: {
          maxInputPixels: 16_000_000,
          maxOutputPixels: 64_000_000,
          maxOutputEdge: 16_384,
        },
        sourceContext: { tier: "fixture", pixelScale: 1, resolutionLimited: false },
      }).requiredScale,
    ).toBe(0.5);
    expect(resample.parameters).toEqual({
      w: 40,
      h: 30,
      kernel: "lanczos3",
      target: { x: 16, y: 0, w: 16, h: 16 },
    });
    const placed = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: resampleId!,
      source: fixture.sourceProducer,
    });
    expect(placed.artifact).toMatchObject({ w: 40, h: 30 });
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

test("a smaller provider raster remains intrinsic for density planning", async () => {
  const fixture = await fillFixture("smallerdims");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
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
    const generated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.generation.node,
      source: fixture.sourceProducer,
    });
    expect(generated.artifact).toMatchObject({ w: 8, h: 8 });
    expect(filled.generation.returned).toEqual({ w: 8, h: 8 });
    const generation = success(
      await command(fixture, "graph", ["node", fixture.id, filled.generation.node]),
    ) as { parameters: { request: { returned: [number, number] } } };
    expect(generation.parameters.request.returned).toEqual([8, 8]);
    expect(
      planOutputDensity({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: 16, h: 16 },
        },
        generated: {
          id: generated.artifact.artifactHash,
          dimensions: { w: generated.artifact.w, h: generated.artifact.h },
        },
        cachedUpscales: [],
        supportedScales: [2, 4],
        limits: {
          maxInputPixels: 16_000_000,
          maxOutputPixels: 64_000_000,
          maxOutputEdge: 16_384,
        },
        sourceContext: { tier: "fixture", pixelScale: 1, resolutionLimited: false },
      }),
    ).toMatchObject({
      requiredScale: 2,
      upscale: {
        generated: { w: 16, h: 16 },
        operations: [
          { kind: "upscale", scale: 2, expectedDimensions: { w: 16, h: 16 } },
          { kind: "resize", dimensions: { w: 16, h: 16 } },
        ],
      },
    });
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

test("expanded fill changes the final document outside the selection and preserves its effective exterior", async () => {
  const fixture = await fillFixture();
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
          "--prompt",
          "A blue vase",
          "--fit",
          "expand=2",
          "--pad",
          "0",
        ]),
      ),
    );
    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.graph.output_node,
      source: fixture.sourceProducer,
    });
    const image = await readArtifactLinear(evaluated.artifact.path);
    expect(image.data[(8 * 40 + 7) * 3]).not.toBe(0.25);
    expect(image.data.slice((8 * 40 + 5) * 3, (8 * 40 + 5) * 3 + 3)).toEqual(
      new Float32Array([0.25, 0.25, 0.25]),
    );
    const repeated = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--prompt",
          "A blue vase",
          "--fit",
          "expand=2",
          "--pad",
          "0",
        ]),
      ),
    );
    expect(repeated.graph.render_hash).toBe(filled.graph.render_hash);
    expect(await generatedExecutionCount(fixture)).toBe(1);
    const currentMask = async () => {
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      const layer = document.layers.find(({ id }) => id === segmented.layer_id)!;
      const branch = (await describeFillBranch(fixture.handle, fixture.id, layer.contentNodeId))!;
      const evaluatedMask = await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: branch.maskNodeId,
        source: fixture.sourceProducer,
      });
      return (await readArtifactMask(evaluatedMask.artifact.path)).data;
    };
    success(
      await command(fixture, "layer", ["transform", fixture.id, segmented.layer_id, "--dx", "3"]),
    );
    const movedMask = await currentMask();
    success(
      await command(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--prompt",
        "A blue vase",
        "--fit",
        "expand=2",
        "--pad",
        "0",
      ]),
    );
    expect(await currentMask()).toEqual(movedMask);
  } finally {
    await fixture.handle.close();
  }
});

test("moving an expanded edge selection anchors the subject and vacancy to original selection intent", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "0,6,8,8"]),
    ) as { layer_id: string };
    success(
      await command(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--prompt",
        "Blue vase",
        "--fit",
        "expand=2",
      ]),
    );
    const moved = success(
      await command(fixture, "fill", [fixture.id, "--move", segmented.layer_id, "--to", "20,16"]),
    ) as { matrix: number[]; vacancy_layer_id: string };
    expect(moved.matrix).toEqual([1, 0, 0, 1, 16, 6]);
    const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
    const vacancy = document.layers.find(({ id }) => id === moved.vacancy_layer_id)!;
    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: vacancy.maskNodeId,
      source: fixture.sourceProducer,
    });
    const mask = await readArtifactMask(evaluated.artifact.path);
    expect([...mask.data].filter((value) => value > 0)).toHaveLength(64);
    expect(mask.data[6 * 40 + 8]).toBe(0);
  } finally {
    await fixture.handle.close();
  }
});

test("feather coverage is applied once through fill, fractional transforms, and refresh", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "16,10,8,8"]),
    ) as { layer_id: string };
    success(
      await command(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--strength",
        "0.03125",
        "--pad",
        "0",
      ]),
    );
    const assertCoverage = async () => {
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      const layer = document.layers.find(({ id }) => id === segmented.layer_id)!;
      const branch = (await describeFillBranch(fixture.handle, fixture.id, layer.contentNodeId))!;
      expect(branch.fit).toEqual({ operation: "fit", mode: "strict", expand_px: 0, feather_px: 2 });
      const evaluate = async (nodeId: string) =>
        (
          await evaluateGraphNode({
            database: fixture.handle,
            libraryPath: fixture.handle.path,
            photoId: fixture.id,
            nodeId,
            source: fixture.sourceProducer,
          })
        ).artifact;
      const output = await readArtifactLinear((await evaluate(document.roots.output!)).path);
      const content = await readArtifactLinear((await evaluate(layer.contentNodeId)).path);
      const mask = await readArtifactMask((await evaluate(branch.maskNodeId)).path);
      const generated = await readArtifactLinear((await evaluate(branch.resample.id)).path);
      expect(mask.data.some((value) => value > 0 && value < 1)).toBe(true);
      expect(output.data).toEqual(content.data);
      for (let pixel = 0; pixel < mask.data.length; pixel++) {
        for (let channel = 0; channel < 3; channel++) {
          const index = pixel * 3 + channel;
          expect(output.data[index]).toBeCloseTo(
            0.25 + (generated.data[index]! - 0.25) * mask.data[pixel]!,
            6,
          );
        }
      }
      return mask.data;
    };
    const originalMask = await assertCoverage();
    success(
      await command(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--dx",
        "0.5",
        "--dy",
        "0.5",
      ]),
    );
    const movedMask = await assertCoverage();
    expect(movedMask).not.toEqual(originalMask);
    success(await command(fixture, "layer", ["refresh", fixture.id, segmented.layer_id]));
    expect(await assertCoverage()).toEqual(movedMask);
  } finally {
    await fixture.handle.close();
  }
});

test.each([
  { name: "fractional online", offline: false, geometry: { straighten_deg: 5 } },
  { name: "fractional offline", offline: true, geometry: { straighten_deg: 5 } },
  { name: "same-size rotation", offline: false, geometry: { rotate: 180 as const } },
  { name: "origin crop", offline: false, geometry: { crop: { x: 0, y: 0, w: 24, h: 20 } } },
])("develop projection preserves single coverage: $name", async ({ offline, geometry }) => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "16,10,8,8"]),
    ) as { layer_id: string };
    success(
      await command(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--strength",
        "0.03125",
        "--pad",
        "0",
      ]),
    );
    expect(
      await command(fixture, "develop", [
        fixture.id,
        ...Object.entries(geometry).flatMap(([key, value]) => [
          "--set",
          `${key}=${JSON.stringify(value)}`,
        ]),
      ]),
    ).toMatchObject({ ok: true });
    const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
    const layer = document.layers.find(({ id }) => id === segmented.layer_id)!;
    const source = async () => {
      const original = await fixture.sourceProducer();
      return offline
        ? {
            image: {
              ...original.image,
              w: 20,
              h: 15,
              data: new Float32Array(20 * 15 * 3).fill(0.25),
            },
            provenance: {
              ...original.provenance,
              w: 20,
              h: 15,
              tier: "pinned-preview" as const,
              locator: { kind: "pinned-preview" as const, cache_path: "fixture-offline.jpg" },
            },
          }
        : original;
    };
    const pixels = async (nodeId: string) => {
      const evaluated = await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId,
        source,
      });
      return await readArtifactLinear(evaluated.artifact.path);
    };
    const content = await applyDevelopGeometry(await pixels(layer.contentNodeId), geometry);
    const background = await applyDevelopGeometry((await source()).image, geometry);
    const output = await pixels(document.roots.output!);
    const base = await pixels(document.roots.base);
    expect(output.data.slice(0, 3)).toEqual(base.data.slice(0, 3));
    let boundary = 0;
    for (let pixel = 0; pixel < output.w * output.h; pixel++) {
      const i = pixel * 3;
      if (content.data[i]! < background.data[i]! - 0.00001) {
        boundary++;
        expect(output.data.slice(i, i + 3)).toEqual(content.data.slice(i, i + 3));
      }
    }
    expect([output.w, output.h]).toEqual([content.w, content.h]);
    expect(boundary).toBeGreaterThan(0);
  } finally {
    await fixture.handle.close();
  }
});

test("renderer correction bypasses warmed old pixels and views without replaying paid generation", async () => {
  const fixture = await fillFixture();
  try {
    const layer = (
      success(await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"])) as {
        layer_id: string;
      }
    ).layer_id;
    const filled = fillStrictDataSchema.parse(
      success(await command(fixture, "fill", [fixture.id, "--layer", layer, "--remove"])),
    );
    expect(await command(fixture, "develop", [fixture.id, "--set", "rotate=180"])).toMatchObject({
      ok: true,
    });
    const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
    const node = await inspectGraphNode(fixture.handle, {
      photoId: fixture.id,
      nodeId: document.roots.output!,
    });
    const evaluate = async (nodeId: string) =>
      await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId,
        source: fixture.sourceProducer,
      });
    const inputs = await Promise.all(node.inputNodeIds.map(evaluate));
    // This is the actual pre-projection renderer cache format, deliberately warmed with wrong pixels.
    const oldEvaluation = `eval_${legacyCacheHash(canonicalJson({ input_artifact_hashes: inputs.map((input) => input.artifact.artifactHash), kind: node.kind, node_recipe_hash: node.recipeHash, recipe_version: node.recipeVersion, source: null }))}`;
    const wrong = await publishArtifact(
      fixture.handle.path,
      await normalizeArtifact({
        ...(await fixture.sourceProducer()).image,
        data: new Float32Array(40 * 30 * 3).fill(0.75),
      }),
    );
    await registerPublishedArtifact(fixture.handle, wrong);
    await fixture.handle.query(
      `INSERT INTO node_executions (photo_id, execution_id, node_id, evaluation_hash, deterministic, output_artifact_hash) VALUES ($1,$2,$3,$4,true,$5)`,
      [
        fixture.id,
        deterministicExecutionId(oldEvaluation),
        node.id,
        oldEvaluation,
        wrong.artifactHash,
      ],
    );
    const oldRender = `r_${legacyCacheHash(node.id)}`;
    const oldPreview = join(fixture.env.cacheRoot, "view", fixture.id, oldRender, "master.jpg");
    const wrongJpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ff0000" },
    })
      .withIccProfile(srgb2014ProfilePath)
      .jpeg()
      .toBuffer();
    await writePreviewArtifact(oldPreview, wrongJpeg, {
      sourceTier: "online-file",
      sourceDimensions: { w: 40, h: 30 },
      frame: developFrame({ w: 40, h: 30 }, { w: 40, h: 30 }),
    });
    const output = await evaluate(node.id);
    expect(output.artifact.artifactHash).not.toBe(wrong.artifactHash);
    expect(output.evaluationHash).not.toBe(oldEvaluation);
    expect((await loadActiveDocument(fixture.handle, fixture.id))!.renderHash).not.toBe(oldRender);
    const shown = success(
      await command(fixture, "show", [fixture.id, "--preview-size", "native"]),
    ) as { preview: string };
    expect(shown.preview).not.toBe(oldPreview);
    await expect(access(oldPreview)).resolves.toBeUndefined();
    expect((await evaluate(filled.generation.node)).reused).toBe(true);
    expect(await generatedExecutionCount(fixture)).toBe(1);
  } finally {
    await fixture.handle.close();
  }
});

test("free fit softens selection and explicit zero strength removes feather without growing the next selection", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "16,10,8,8"]),
    ) as { layer_id: string };
    const args = [
      fixture.id,
      "--layer",
      segmented.layer_id,
      "--prompt",
      "Blue vase",
      "--fit",
      "free",
    ];
    success(await command(fixture, "fill", args));
    const coverage = async () => {
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      const layer = document.layers.find(({ id }) => id === segmented.layer_id)!;
      const branch = (await describeFillBranch(fixture.handle, fixture.id, layer.contentNodeId))!;
      const artifact = await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: branch.maskNodeId,
        source: fixture.sourceProducer,
      });
      return { mask: await readArtifactMask(artifact.artifact.path), fit: branch.fit };
    };
    const soft = await coverage();
    expect(soft.fit).toMatchObject({ mode: "free", feather_px: 24 });
    expect(soft.mask.data[10 * 40 + 15]).toBeGreaterThan(0);
    expect(soft.mask.data[10 * 40 + 15]).toBeLessThan(1);
    success(await command(fixture, "fill", [...args, "--strength", "0"]));
    const hard = await coverage();
    expect(hard.fit).toMatchObject({ mode: "free", feather_px: 0 });
    expect(hard.mask.data[10 * 40 + 15]).toBe(0);
    expect(hard.mask.data[10 * 40 + 16]).toBe(1);
  } finally {
    await fixture.handle.close();
  }
});

test("free fit accepts declared whole-frame edits while the effective mask still owns coverage", async () => {
  const fixture = await fillFixture("wholeframe");
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "16,10,8,8"]),
    ) as { layer_id: string };
    const filled = fillStrictDataSchema.parse(
      success(
        await command(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--prompt",
          "Blue vase",
          "--fit",
          "free",
          "--strength",
          "0",
        ]),
      ),
    );
    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.graph.output_node,
      source: fixture.sourceProducer,
    });
    const output = await readArtifactLinear(evaluated.artifact.path);
    expect(output.data.slice(0, 3)).toEqual(new Float32Array([0.25, 0.25, 0.25]));
    expect(output.data[(12 * 40 + 18) * 3]).not.toBe(0.25);
  } finally {
    await fixture.handle.close();
  }
});

test("invalid fit and strength fail before generation or revision changes", async () => {
  const fixture = await fillFixture();
  try {
    const segmented = success(
      await command(fixture, "segment", [fixture.id, "--box", "8,6,8,8"]),
    ) as { layer_id: string };
    const before = await revisionCount(fixture);
    for (const flags of [
      ["--fit", "expand=-1"],
      ["--fit", "expand=4097"],
      ["--fit", "stretch"],
      ["--strength", "-0.1"],
      ["--strength", "1.1"],
      ["--strength", "NaN"],
    ]) {
      expect(
        await command(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--remove",
          ...flags,
        ]),
      ).toMatchObject({ ok: false, code: "usage" });
    }
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
    const evaluated = await evaluateGraphNode({
      database: fixture.handle,
      libraryPath: fixture.handle.path,
      photoId: fixture.id,
      nodeId: filled.graph.output_node,
      source: fixture.sourceProducer,
    });
    const output = await readArtifactLinear(evaluated.artifact.path);
    // Prompt's default expansion covers this point 20px beyond the selection.
    expect(output.data[(10 * 40 + 35) * 3]).not.toBe(0.25);
  } finally {
    await fixture.handle.close();
  }
});

function legacyCacheHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function fillFixture(mode?: "wrongdims" | "smallerdims" | "wholeframe" | "wrongaspect") {
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
