import { layerRefreshDataSchema } from "@photoctl/protocol";
import {
  commitRevision,
  compositeV2Projection,
  describeFillBranch,
  loadActiveDocument,
} from "@photoctl/render";
import sharp from "sharp";
import { describe, expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

describe.sequential("fill branch refresh", () => {
  test("generation refresh adopts current develop and rebuilds deterministic descendants", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
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
      ) as { generation: { node: string }; graph: { revision: string; render_hash: string } };
      const developed = await fixtureCommand(fixture, "develop", [
        fixture.id,
        "--set",
        "exposure=1",
      ]);
      expect(developed).toMatchObject({ ok: true });
      if (!("results" in developed)) throw new Error("Expected develop results");

      const refreshed = layerRefreshDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", ["refresh", fixture.id, segmented.layer_id]),
        ),
      );

      expect(fixture.generationCalls()).toBe(2);
      expect(fixture.upscaleCalls()).toBe(2);
      expect(refreshed).toMatchObject({
        graph: { layer: segmented.layer_id },
        refreshed: { kind: "generate", from_node: filled.generation.node },
        source_context: { tier: "online-file", resolution_limited: false },
        upscale: { enabled: true, executed: true, density_satisfied: true },
        composite: { unmasked_bit_exact: true },
      });
      expect(refreshed.refreshed.node).not.toBe(filled.generation.node);
      expect(refreshed.graph.revision).not.toBe(filled.graph.revision);
      expect(refreshed.graph.render_hash).not.toBe(developed.results[0]!.render_hash);

      const graph = success(
        await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
      ) as {
        roots: { content: string };
        nodes: Array<{ id: string; kind: string; input_node_ids: string[] }>;
      };
      const generation = graph.nodes.find(({ id }) => id === refreshed.refreshed.node)!;
      const refreshedBase = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, generation.input_node_ids[0]!]),
      ) as { kind: string; input_node_ids: string[] };
      const refreshedDevelop = success(
        await fixtureCommand(fixture, "graph", [
          "node",
          fixture.id,
          refreshedBase.input_node_ids[0]!,
        ]),
      ) as { kind: string; parameters: { exposure: number } };
      expect(refreshedBase.kind).toBe("output");
      expect(refreshedDevelop).toMatchObject({ kind: "develop", parameters: { exposure: 1 } });
      expect(graph.nodes.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining(["generate", "resample", "mask_composite"]),
      );
      expect(graph.nodes.map(({ kind }) => kind)).not.toContain("delta");
      expect(graph.roots.content).not.toBe(refreshed.refreshed.node);
    } finally {
      await fixture.close();
    }
  });

  test("upscale refresh reuses generation and creates a new pinned execution", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
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
      ) as { generation: { node: string }; upscale: { node: string } };
      const firstUpscale = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, filled.upscale.node]),
      ) as { executions: Array<{ execution_id: string; output_artifact_hash: string }> };
      fixture.fill.source = async () => {
        throw new Error("the original source is offline");
      };
      fixture.fill.sourceContext = undefined;
      const developed = await fixtureCommand(fixture, "develop", [
        fixture.id,
        "--set",
        "exposure=1",
      ]);
      expect(developed).toMatchObject({ ok: true });

      const refreshed = layerRefreshDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", [
            "refresh",
            fixture.id,
            segmented.layer_id,
            "--from",
            filled.upscale.node.slice(0, 18),
          ]),
        ),
      );

      expect(fixture.generationCalls()).toBe(1);
      expect(fixture.upscaleCalls()).toBe(2);
      expect(refreshed).toMatchObject({
        refreshed: { kind: "upscale", from_node: filled.upscale.node },
        generation: { node: filled.generation.node },
        source_context: { tier: "online-file", resolution_limited: false },
        upscale: { enabled: true, executed: true, density_satisfied: true },
        composite: { unmasked_bit_exact: true },
        executions: [
          { kind: "generate", node: filled.generation.node, reused: true },
          { kind: "upscale", reused: false },
        ],
      });
      expect(refreshed.refreshed.node).not.toBe(filled.upscale.node);
      const nextUpscale = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, refreshed.refreshed.node]),
      ) as { executions: Array<{ execution_id: string }> };
      expect(nextUpscale.executions[0]!.execution_id).not.toBe(
        firstUpscale.executions[0]!.execution_id,
      );
      const graph = success(
        await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
      ) as { nodes: Array<{ kind: string }> };
      expect(graph.nodes.map(({ kind }) => kind)).toContain("delta");
    } finally {
      await fixture.close();
    }
  });

  test("refresh records the currently executing adapter and model versions", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
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
      fixture.replaceGenerationAdapterVersion("2");

      const generationRefresh = layerRefreshDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", ["refresh", fixture.id, segmented.layer_id]),
        ),
      );
      const generation = success(
        await fixtureCommand(fixture, "graph", [
          "node",
          fixture.id,
          generationRefresh.generation.node,
        ]),
      ) as { parameters: { adapter_version: string } };
      expect(generation.parameters.adapter_version).toBe("2");

      fixture.replaceUpscaleAdapterVersion("2");
      const upscaleRefresh = layerRefreshDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", [
            "refresh",
            fixture.id,
            segmented.layer_id,
            "--from",
            generationRefresh.upscale.node!,
          ]),
        ),
      );
      const upscale = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, upscaleRefresh.refreshed.node]),
      ) as {
        parameters: { adapter_version: string; model_version: string };
        executions: Array<{
          provider_provenance: { adapter_version: string; model_version: string };
        }>;
      };
      expect(upscale.parameters).toMatchObject({ adapter_version: "2", model_version: "2" });
      expect(upscale.executions[0]!.provider_provenance).toMatchObject({
        adapter_version: "2",
        model_version: "2",
      });
      expect(fixture.generationCalls()).toBe(2);
      expect(fixture.upscaleCalls()).toBe(3);
      expect(upscaleRefresh.refreshed.node).not.toBe(filled.upscale.node);
    } finally {
      await fixture.close();
    }
  });

  test("upscale refresh still requires configured provider consent", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
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
      ) as { upscale: { node: string }; graph: { revision: string } };
      fixture.fill.upscaleSettings.providers.upscale["photoctl/fake-upscale-v1"] = {
        configured: false,
      };

      const response = await fixtureCommand(fixture, "layer", [
        "refresh",
        fixture.id,
        segmented.layer_id,
        "--from",
        filled.upscale.node,
      ]);

      expect(response).toMatchObject({ ok: false, code: "provider_unconfigured" });
      expect(fixture.upscaleCalls()).toBe(1);
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      expect(document.revisionId).toBe(filled.graph.revision);
    } finally {
      await fixture.close();
    }
  });

  test("generation refresh rebases a transformed pre-fill input onto current pixels", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      expect(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--dx",
          "2",
        ]),
      ).toMatchObject({ ok: true });
      const filled = success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--layer",
          segmented.layer_id,
          "--remove",
          "--pad",
          "0",
          "--no-upscale",
        ]),
      ) as { graph: { revision: string } };
      const generationCalls = fixture.generationCalls();
      expect(fixture.generationMasks()).toHaveLength(1);
      expect(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          segmented.layer_id,
          "--dx",
          "3",
        ]),
      ).toMatchObject({ ok: true });

      const response = await fixtureCommand(fixture, "layer", [
        "refresh",
        fixture.id,
        segmented.layer_id,
      ]);

      expect(response).toMatchObject({ ok: true });
      expect(fixture.generationCalls()).toBe(generationCalls + 1);
      const [originalMask, refreshedMask] = await Promise.all(
        fixture.generationMasks().map(async (png) => await transparentBounds(png)),
      );
      expect(refreshedMask).toEqual(originalMask);
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      expect(document.revisionId).not.toBe(filled.graph.revision);
      const shown = success(
        await fixtureCommand(fixture, "layer", ["show", fixture.id, segmented.layer_id]),
      ) as { chain: { mask: Array<{ kind: string; parameters: unknown }> } };
      expect(shown.chain.mask[0]).toMatchObject({
        kind: "transform",
        parameters: { matrix: [1, 0, 0, 1, 3, 0] },
      });
      const refreshed = layerRefreshDataSchema.parse(success(response));
      const refreshedGeneration = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, refreshed.generation.node]),
      ) as { parameters: { request: { input_matrix?: number[] } } };
      expect(refreshedGeneration.parameters.request.input_matrix).toEqual([1, 0, 0, 1, 2, 0]);
    } finally {
      await fixture.close();
    }
  });

  test("generation refresh renormalizes placement when intrinsic dimensions change", async () => {
    const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
    try {
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
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      const selected = document.layers.find(({ id }) => id === segmented.layer_id)!;
      const before = (await describeFillBranch(
        fixture.handle,
        fixture.id,
        selected.contentNodeId,
      ))!;
      fixture.replaceGenerationMode("smallerdims");

      const refreshed = layerRefreshDataSchema.parse(
        success(
          await fixtureCommand(fixture, "layer", ["refresh", fixture.id, segmented.layer_id]),
        ),
      );
      const graph = success(
        await fixtureCommand(fixture, "graph", ["show", fixture.id, "--layer", segmented.layer_id]),
      ) as { nodes: Array<{ id: string; kind: string; recipe_version: number }> };
      const resample = graph.nodes.find(
        ({ kind, recipe_version }) => kind === "resample" && recipe_version === 2,
      )!;
      const inspected = success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, resample.id]),
      ) as { parameters: { matrix: number[] } };
      expect(inspected.parameters.matrix).toEqual([
        before.crop.w / refreshed.generation.returned.w,
        0,
        0,
        before.crop.h / refreshed.generation.returned.h,
        before.crop.x,
        before.crop.y,
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("refresh refuses a lookalike branch that is not the canonical strict fill recipe", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
        "--no-upscale",
      ]);
      const document = (await loadActiveDocument(fixture.handle, fixture.id))!;
      const selected = document.layers.find(({ id }) => id === segmented.layer_id)!;
      const branch = (await describeFillBranch(
        fixture.handle,
        fixture.id,
        selected.contentNodeId,
      ))!;
      const layers = document.layers.map((layer) => ({
        layer: { layerId: layer.id },
        name: layer.name,
        z: layer.z,
        contentNode:
          layer.id === selected.id
            ? ({ localKey: "soft-composite" } as const)
            : ({ nodeId: layer.contentNodeId } as const),
        maskNode: { nodeId: layer.maskNodeId } as const,
        opacity: layer.opacity,
        blend: layer.blend,
        enabled: layer.enabled,
      }));
      const output = compositeV2Projection({ nodeId: document.roots.base }, layers);
      await commitRevision(fixture.handle, {
        photoId: fixture.id,
        expectedRevisionId: document.revisionId,
        nodes: [
          {
            localKey: "soft-composite",
            kind: "mask_composite",
            recipeVersion: 1,
            parameters: { feather: 1 },
            inputs: branch.composite.inputNodeIds.map((nodeId) => ({ nodeId })),
          },
          { localKey: "output", kind: "composite", recipeVersion: 2, ...output },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "output" } }],
        layers,
      });
      const generationCalls = fixture.generationCalls();

      const response = await fixtureCommand(fixture, "layer", [
        "refresh",
        fixture.id,
        segmented.layer_id,
      ]);

      expect(response).toMatchObject({
        ok: false,
        code: "usage",
      });
      expect(fixture.generationCalls()).toBe(generationCalls);
    } finally {
      await fixture.close();
    }
  });
});

async function transparentBounds(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    if (data[pixel * info.channels + 3]! >= 128) continue;
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}
