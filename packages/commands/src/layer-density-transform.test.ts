/* eslint-disable no-await-in-loop -- Command order is the transform/cache behavior under test. */
import { layerTransformDataSchema } from "@photoctl/protocol";
import { evaluateGraphNode, readArtifactImage, readArtifactMask } from "@photoctl/render";
import { afterEach, describe, expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

describe.sequential("generated layer density transforms", () => {
  let fixture: Awaited<ReturnType<typeof fillUpscaleFixture>> | undefined;

  afterEach(async () => {
    await fixture?.close();
    fixture = undefined;
  });

  test("a larger uniform scale runs the smallest sufficient upscale from generation", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(1);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );

    expect(fixture.upscaleCalls()).toBe(2);
    expect(transformed.upscale).toMatchObject({
      enabled: true,
      executed: true,
      density_satisfied: true,
      input: { w: 16, h: 15 },
      target: { w: 64, h: 60 },
      generated: { w: 64, h: 60 },
      final: { w: 64, h: 60 },
    });

    const smaller = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "0.5",
        ]),
      ),
    );
    expect(smaller.upscale).toMatchObject({ density_satisfied: true, target: { w: 16, h: 15 } });
    expect(fixture.upscaleCalls()).toBe(2);

    const reused = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(reused.upscale).toMatchObject({ density_satisfied: true, generated: { w: 64, h: 60 } });
    expect(fixture.upscaleCalls()).toBe(2);
  });

  test("auto intent survives a sufficient no-upscale fill for later scaling", async () => {
    fixture = await fillUpscaleFixture();
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    const filled = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    ) as { upscale: { node: string | null } };
    expect(filled.upscale.node).toBeNull();
    expect(fixture.upscaleCalls()).toBe(0);
    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ executed: true, density_satisfied: true });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("an explicit no-upscale refill replaces earlier automatic density intent", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
        "--no-upscale",
      ]),
    );
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ enabled: false, executed: false });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("density growth is relative to scale already baked into generation input", async () => {
    fixture = await fillUpscaleFixture();
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "0.5",
        "--anchor",
        "0,0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(0);

    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "1",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({ executed: true, density_satisfied: true });
    expect(fixture.upscaleCalls()).toBe(1);
  });

  test("an adapter upgrade is paid once and then reuses its exact direct child", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    fixture.replaceUpscaleAdapterVersion("2");
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "2",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(2);
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--scale",
        "2",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(2);
  });

  test("a limit-bound upscale reports the density planner warning", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "8,8,16,16"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const response = await fixtureCommand(fixture, "layer", [
      "transform",
      fixture.id,
      segmented.layer_id,
      "--scale",
      "4",
    ]);
    expect(response).toMatchObject({
      ok: true,
      warnings: [{ code: "upscale_resolution_limited" }],
      data: { upscale: { density_satisfied: false } },
    });
  });

  test("move, flip, and quarter rotation reuse pinned pixels without provider availability", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    expect(fixture.upscaleCalls()).toBe(1);
    fixture.fill.upscaleSettings.providers!.upscale!["photoctl/fake-upscale-v1"]!.configured =
      false;
    for (const args of [
      ["--dx", "2"],
      ["--flip", "h"],
      ["--rotate", "90"],
    ]) {
      const result = layerTransformDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", [
            "transform",
            fixture.id,
            segmented.layer_id,
            ...args,
          ]),
        ),
      );
      expect(result.upscale).toMatchObject({ executed: true, density_satisfied: true });
    }
    expect(fixture.upscaleCalls()).toBe(1);
    const graph = success(
      await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
    ) as { nodes: Array<{ kind: string; recipe_version: number }> };
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ kind: "resample", recipe_version: 2 }),
    );
  });

  test("a failed larger upscale still commits the transform with the best prior pixels", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    const filled = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    ) as { upscale: { node: string } };
    fixture.replaceUpscaleMode("transport-failure");
    const response = await fixtureCommand(fixture, "layer", [
      "transform",
      fixture.id,
      segmented.layer_id,
      "--scale",
      "2",
    ]);
    expect(response).toMatchObject({
      ok: true,
      warnings: [{ code: "upscale_failed" }],
      data: {
        upscale: {
          node: filled.upscale.node,
          density_satisfied: false,
          generated: { w: 16, h: 16 },
        },
      },
    });
    expect(fixture.upscaleCalls()).toBe(2);
    const failedRows = await fixture.handle.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM image_nodes WHERE photo_id = $1 AND kind = 'upscale'",
      [fixture.id],
    );
    expect(failedRows.rows[0]!.count).toBe("1");
  });

  test("a layer transformed before fill rebases onto affine placement", async () => {
    fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
    ) as { layer_id: string };
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        segmented.layer_id,
        "--dx",
        "2",
        "--anchor",
        "0,0",
      ]),
    );
    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]),
    );
    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--scale",
          "2",
          "--anchor",
          "0,0",
        ]),
      ),
    );
    expect(transformed.matrix).toEqual([2, 0, 0, 2, 0, 0]);
    expect(transformed.upscale).toMatchObject({ density_satisfied: true });
    const graph = success(
      await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
    ) as { nodes: Array<{ id: string; kind: string; recipe_version: number }> };
    const resample = graph.nodes.find(
      ({ kind, recipe_version }) => kind === "resample" && recipe_version === 2,
    )!;
    const mask = graph.nodes.find(({ kind }) => kind === "transform")!;
    const [resampleEvaluation, maskEvaluation] = await Promise.all([
      evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: resample.id,
        source: fixture.sourceProducer,
      }),
      evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: mask.id,
        source: fixture.sourceProducer,
      }),
    ]);
    const placed = await readArtifactImage(
      resampleEvaluation.artifact.path,
      resampleEvaluation.artifact.artifactHash,
    );
    const transformedMask = await readArtifactMask(
      maskEvaluation.artifact.path,
      maskEvaluation.artifact.artifactHash,
    );
    const placedBounds = nonzeroBounds(placed.data, placed.w, 3);
    const maskBounds = nonzeroBounds(transformedMask.data, transformedMask.w, 1);
    expect(placedBounds.x).toBeLessThanOrEqual(maskBounds.x);
    expect(placedBounds.y).toBeLessThanOrEqual(maskBounds.y);
    expect(placedBounds.x + placedBounds.w).toBeGreaterThanOrEqual(maskBounds.x + maskBounds.w);
    expect(placedBounds.y + placedBounds.h).toBeGreaterThanOrEqual(maskBounds.y + maskBounds.h);
  });
});

function nonzeroBounds(data: ArrayLike<number>, width: number, channels: number) {
  let left = width;
  let top = Number.MAX_SAFE_INTEGER;
  let right = 0;
  let bottom = 0;
  for (let pixel = 0; pixel < data.length / channels; pixel += 1) {
    let nonzero = false;
    for (let channel = 0; channel < channels; channel += 1) {
      if (data[pixel * channels + channel]! > 0) nonzero = true;
    }
    if (!nonzero) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}
