import { fillStrictDataSchema } from "@photoctl/protocol";
import { evaluateGraphNode } from "@photoctl/render";
import { describe, expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

describe.sequential("fill upscale policy", () => {
  test("configured auto upscale owns policy and inserts one upscale before placement", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const filled = fillStrictDataSchema.parse(
        success(
          await fixtureCommand(fixture, "fill", [
            fixture.id,
            "--layer",
            segmented.layer_id,
            "--remove",
            "--pad",
            "0",
          ]),
        ),
      );

      expect(fixture.upscaleCalls()).toBe(1);
      expect(filled.source_context).toEqual({
        tier: "online-file",
        pixel_scale: 1,
        resolution_limited: false,
      });
      expect(filled.upscale).toMatchObject({
        enabled: true,
        executed: true,
        adapter: "photoctl/fake-upscale-v1",
        model: "photoctl/fake-upscale-v1",
        input: { w: 8, h: 8 },
        target: { w: 16, h: 16 },
        generated: { w: 16, h: 16 },
        final: { w: 16, h: 16 },
        density_satisfied: true,
        warnings: [],
      });
      expect(filled.upscale.node).toMatch(/^node_[0-9a-f]{64}$/);
      expect(filled.executions.map(({ kind }) => kind)).toEqual(["generate", "upscale"]);
      const graph = success(await fixtureCommand(fixture, "graph", ["show", fixture.id])) as {
        nodes: Array<{ kind: string }>;
      };
      expect(graph.nodes.filter(({ kind }) => kind === "upscale")).toHaveLength(1);
      expect(graph.nodes.filter(({ kind }) => kind === "resample")).toHaveLength(1);
      const pinned = await evaluateGraphNode({
        database: fixture.handle,
        libraryPath: fixture.handle.path,
        photoId: fixture.id,
        nodeId: filled.upscale.node!,
        source: fixture.sourceProducer,
      });
      expect(pinned.reused).toBe(true);
      expect(fixture.upscaleCalls()).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  test("--no-upscale overrides configured auto without calling the adapter", async () => {
    const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const filled = fillStrictDataSchema.parse(
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
        ),
      );
      expect(fixture.upscaleCalls()).toBe(0);
      expect(filled.upscale).toMatchObject({ enabled: false, executed: false, node: null });
    } finally {
      await fixture.close();
    }
  });

  test("unconfigured auto preserves the successful generation with a soft warning", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      upscaleConfigured: false,
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);
      expect(response).toMatchObject({
        ok: true,
        warnings: [{ code: "upscale_unconfigured" }],
        data: {
          upscale: {
            enabled: true,
            executed: false,
            node: null,
            density_satisfied: false,
          },
        },
      });
      expect(fixture.generationCalls()).toBe(1);
      expect(fixture.upscaleCalls()).toBe(0);
    } finally {
      await fixture.close();
    }
  });

  test("sufficient intrinsic generation skips the paid upscaler", async () => {
    const fixture = await fillUpscaleFixture();
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const filled = fillStrictDataSchema.parse(
        success(
          await fixtureCommand(fixture, "fill", [
            fixture.id,
            "--layer",
            segmented.layer_id,
            "--remove",
            "--pad",
            "0",
          ]),
        ),
      );
      expect(fixture.upscaleCalls()).toBe(0);
      expect(filled.upscale).toMatchObject({
        executed: false,
        density_satisfied: true,
        node: null,
      });
    } finally {
      await fixture.close();
    }
  });

  test("--upscale-model implies enabled and overrides an off library model", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      generationUpscale: "off",
      libraryUpscaleModel: "missing/library-model",
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const filled = fillStrictDataSchema.parse(
        success(
          await fixtureCommand(fixture, "fill", [
            fixture.id,
            "--layer",
            segmented.layer_id,
            "--remove",
            "--pad",
            "0",
            "--upscale-model",
            "photoctl/fake-upscale-v1",
          ]),
        ),
      );
      expect(fixture.upscaleCalls()).toBe(1);
      expect(filled.upscale).toMatchObject({
        enabled: true,
        executed: true,
        model: "photoctl/fake-upscale-v1",
      });
    } finally {
      await fixture.close();
    }
  });

  test("adapter limits use the largest valid scale and report unsatisfied output density", async () => {
    const fixture = await fillUpscaleFixture({
      intrinsicDivisor: 4,
      upscaleLimits: { maxOutputPixels: 80 },
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);
      expect(response).toMatchObject({
        ok: true,
        warnings: [{ code: "upscale_resolution_limited" }],
        data: {
          upscale: {
            executed: true,
            generated: { w: 8, h: 8 },
            final: { w: 16, h: 16 },
            density_satisfied: false,
          },
        },
      });
      expect(fixture.upscaleCalls()).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  test("a reversible provider frame is cropped before the single exact placement", async () => {
    const fixture = await fillUpscaleFixture({
      generationMode: "smallerdims",
      upscaleMode: "mapped-frame",
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = fillStrictDataSchema.parse(
        success(
          await fixtureCommand(fixture, "fill", [
            fixture.id,
            "--layer",
            segmented.layer_id,
            "--remove",
            "--pad",
            "0",
          ]),
        ),
      );

      expect(response.upscale).toMatchObject({
        executed: true,
        generated: { w: 16, h: 16 },
        density_satisfied: true,
      });
      const graph = success(await fixtureCommand(fixture, "graph", ["show", fixture.id])) as {
        nodes: Array<{ kind: string }>;
      };
      expect(graph.nodes.filter(({ kind }) => kind === "resample")).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  test("source limits remain separate when output density is satisfied", async () => {
    const fixture = await fillUpscaleFixture({
      sourceContext: { tier: "pinned-preview", pixelScale: 0.5, resolutionLimited: true },
    });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const response = await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--remove",
        "--pad",
        "0",
      ]);
      expect(response).toMatchObject({
        ok: true,
        warnings: [{ code: "source_resolution_limited" }],
        data: {
          source_context: {
            tier: "pinned-preview",
            pixel_scale: 0.5,
            resolution_limited: true,
          },
          upscale: { density_satisfied: true },
        },
      });
    } finally {
      await fixture.close();
    }
  });

  test("a matching cached upscale is reused before exact placement", async () => {
    const fixture = await fillUpscaleFixture({ intrinsicDivisor: 4 });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const args = [fixture.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
      const first = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );
      const second = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );

      expect(second.generation.node).toBe(first.generation.node);
      expect(second.upscale.node).toBe(first.upscale.node);
      expect(second.upscale.executed).toBe(true);
      expect(second.executions).toEqual([
        expect.objectContaining({ kind: "generate", reused: true }),
        expect.objectContaining({ kind: "upscale", reused: true }),
      ]);
      expect(fixture.generationCalls()).toBe(1);
      expect(fixture.upscaleCalls()).toBe(1);
    } finally {
      await fixture.close();
    }
  });

  test("a cached upscale from another adapter version is rejected while generation is reused", async () => {
    const fixture = await fillUpscaleFixture({ intrinsicDivisor: 4 });
    try {
      const segmented = success(
        await fixtureCommand(fixture, "segment", [fixture.id, "--box", "18,7,5,5"]),
      ) as { layer_id: string };
      const args = [fixture.id, "--layer", segmented.layer_id, "--remove", "--pad", "0"];
      const first = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );
      fixture.replaceUpscaleAdapterVersion("2");
      const second = fillStrictDataSchema.parse(
        success(await fixtureCommand(fixture, "fill", args)),
      );

      expect(second.generation.node).toBe(first.generation.node);
      expect(second.upscale.node).not.toBe(first.upscale.node);
      expect(second.executions).toEqual([
        expect.objectContaining({ kind: "generate", reused: true }),
        expect.objectContaining({ kind: "upscale", reused: false }),
      ]);
      expect(fixture.generationCalls()).toBe(1);
      expect(fixture.upscaleCalls()).toBe(2);
    } finally {
      await fixture.close();
    }
  });
});
