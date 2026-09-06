import { createHash } from "node:crypto";
import { join } from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import { UpscaleRegistry } from "@photoctl/providers";
import { transformLayer } from "@photoctl/render";
import {
  exportResultSchema,
  fillStrictDataSchema,
  layerTransformDataSchema,
  layerRefreshDataSchema,
  showDataSchema,
} from "@photoctl/protocol";
import sharp from "sharp";
import { expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("outpaint refresh replans upscale density after a failed enlargement", async () => {
  const fixture = await fillUpscaleFixture({ generationMode: "smallerdims" });
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue",
        ]),
      ),
    );
    expect(authored.upscale.generated).toEqual({ w: 44, h: 34 });
    fixture.replaceUpscaleMode("transport-failure");
    const enlarged = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          authored.graph.layer,
          "--scale",
          "2",
        ]),
      ),
    );
    expect(enlarged.upscale).toMatchObject({ target: { w: 88, h: 68 }, density_satisfied: false });
    fixture.replaceUpscaleMode("normal");
    const refreshed = layerRefreshDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "refresh",
          fixture.id,
          authored.graph.layer,
          "--from",
          authored.upscale.node!,
        ]),
      ),
    );
    expect(refreshed.upscale).toMatchObject({
      target: { w: 88, h: 68 },
      generated: { w: 88, h: 68 },
      density_satisfied: true,
    });
    expect(refreshed.generation.node).toBe(authored.generation.node);
    expect(
      success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, refreshed.upscale.node!]),
      ),
    ).toMatchObject({ parameters: { scale: 4 } });
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(3);
    fixture.replaceGenerationMode(undefined);
    const regenerated = layerRefreshDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", ["refresh", fixture.id, authored.graph.layer]),
      ),
    );
    expect(regenerated.generation.returned).toEqual({ w: 44, h: 34 });
    expect(regenerated.upscale).toMatchObject({
      target: { w: 88, h: 68 },
      generated: { w: 88, h: 68 },
      density_satisfied: true,
    });
    expect(
      success(
        await fixtureCommand(fixture, "graph", ["node", fixture.id, regenerated.upscale.node!]),
      ),
    ).toMatchObject({ parameters: { scale: 2 } });
    expect(fixture.generationCalls()).toBe(2);
    expect(fixture.upscaleCalls()).toBe(4);
  } finally {
    await fixture.close();
  }
});

test("deterministic border placement retains independent native RGB and mask rasters", async () => {
  const fixture = await fillUpscaleFixture();
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue",
        ]),
      ),
    );
    success(
      await fixtureCommand(fixture, "layer", [
        "transform",
        fixture.id,
        authored.graph.layer,
        "--scale",
        "2",
      ]),
    );
    await transformLayer(fixture.handle, fixture.handle.path, {
      photoId: fixture.id,
      orientation: 1,
      layer: authored.graph.layer,
      relative: true,
      transform: { dx: 3, dy: 0, scale: 1, rotate: 0, flip: null, anchor: { x: 0, y: 0 } },
    });
    const exported = await fixtureCommand(fixture, "export", [
      fixture.id,
      "--to",
      join(fixture.parent, "placement"),
      "--format",
      "png",
    ]);
    expect(exported, JSON.stringify(exported)).toMatchObject({ ok: true });
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("native-density border keeps live interior, opacity, reversible extent and cached density", async () => {
  const fixture = await fillUpscaleFixture();
  const command = async (verb: string, args: string[]) => await fixtureCommand(fixture, verb, args);
  let delivery = 0;
  const pixels = async () => {
    const result = await command("export", [
      fixture.id,
      "--to",
      join(fixture.parent, `lifecycle-${delivery++}`),
      "--format",
      "png",
    ]);
    expect(result).toMatchObject({ ok: true });
    const file = exportResultSchema.parse((result as { results: unknown[] }).results[0]).file;
    await capture(file, `lifecycle-${delivery}`);
    return await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  };
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [fixture.id, "--outpaint", "--px", "2", "--prompt", "continue"]),
      ),
    );
    const layer = authored.graph.layer;
    success(await command("layer", ["transform", fixture.id, layer, "--scale", "2"]));
    const enlarged = await pixels();
    expect(enlarged.info).toMatchObject({ width: 88, height: 68 });
    const center = (34 * 88 + 44) * 3;
    expect([...enlarged.data.subarray(center, center + 3)]).toEqual([64, 96, 128]);
    success(await command("layer", ["transform", fixture.id, layer, "--scale", "1"]));
    success(await command("layer", ["transform", fixture.id, layer, "--scale", "2"]));
    expect((await pixels()).data).toEqual(enlarged.data);
    expect(fixture.upscaleCalls()).toBe(1);
    expect(await command("develop", [fixture.id, "--set", "exposure=1"])).toMatchObject({
      ok: true,
    });
    const edited = await pixels();
    expect(edited.data[center]).toBeGreaterThan(enlarged.data[center]!);
    success(await command("layer", ["set", fixture.id, layer, "--opacity", "0.5"]));
    const translucent = await pixels();
    expect(translucent.info).toMatchObject({ width: 88, height: 68 });
    expect([...translucent.data.subarray(center, center + 3)]).toEqual([
      ...edited.data.subarray(center, center + 3),
    ]);
    expect(translucent.data[0]).toBeLessThan(edited.data[0]!);
    success(await command("layer", ["remove", fixture.id, layer]));
    expect((await pixels()).info).toMatchObject({ width: 40, height: 30 });
    success(await command("undo", [fixture.id]));
    expect((await pixels()).data).toEqual(translucent.data);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("pinned outpaint retry does not decode its historical photographic input", async () => {
  const fixture = await fillUpscaleFixture({
    generationMode: "smallerdims",
    upscaleMode: "transport-failure",
  });
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue",
        ]),
      ),
    );
    fixture.replaceUpscaleMode("normal");
    fixture.fill.source = async () => {
      throw new Error("historical source must not be decoded for pinned retry");
    };
    expect(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        authored.graph.layer,
        "--prompt",
        "continue",
      ]),
    ).toMatchObject({ ok: true });
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(2);
  } finally {
    await fixture.close();
  }
});

test("explicit outpaint retry satisfies moved enlarged density without generating again", async () => {
  const fixture = await fillUpscaleFixture({ upscaleMode: "transport-failure" });
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue",
        ]),
      ),
    );
    const transformed = layerTransformDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", [
          "transform",
          fixture.id,
          authored.graph.layer,
          "--scale",
          "2",
          "--dx",
          "3",
        ]),
      ),
    );
    expect(transformed.upscale).toMatchObject({
      density_satisfied: false,
      target: { w: 88, h: 68 },
    });
    expect(fixture.upscaleCalls()).toBe(1);
    fixture.replaceUpscaleMode("normal");
    const retry = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--layer",
          authored.graph.layer,
          "--prompt",
          "continue",
        ]),
      ),
    );
    expect(retry.upscale).toMatchObject({
      density_satisfied: true,
      target: { w: 88, h: 68 },
      generated: { w: 88, h: 68 },
    });
    expect(retry.generation.node).toBe(authored.generation.node);
    expect(fixture.upscaleCalls()).toBe(2);
    expect(fixture.generationCalls()).toBe(1);
    const refreshed = layerRefreshDataSchema.parse(
      success(
        await fixtureCommand(fixture, "layer", ["refresh", fixture.id, authored.graph.layer]),
      ),
    );
    expect(refreshed.upscale).toMatchObject({
      target: { w: 88, h: 68 },
      generated: { w: 88, h: 68 },
      density_satisfied: true,
    });
    expect(refreshed.generation.node).not.toBe(authored.generation.node);
    expect(
      showDataSchema.parse(success(await fixtureCommand(fixture, "show", [fixture.id])))
        .preview_info.actual,
    ).toMatchObject({ w: 88, h: 68 });
    expect(fixture.generationCalls()).toBe(2);
    expect(fixture.upscaleCalls()).toBe(3);
  } finally {
    await fixture.close();
  }
});

test("enlarged outpaint retains native upscaler detail without regenerating its border", async () => {
  const fixture = await fillUpscaleFixture();
  const command = async (verb: string, args: string[]) => await fixtureCommand(fixture, verb, args);
  const original = fixture.fill.upscaleRegistry.get("photoctl/fake-upscale-v1")!;
  const registry = new UpscaleRegistry(original.id);
  registry.register({
    ...original,
    upscale: async (input) => {
      const result = await original.upscale(input);
      const { w, h } = result.dimensions;
      const pixels = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          pixels.fill(x % 2 ? 240 : 16, (y * w + x) * 3, (y * w + x + 1) * 3);
      const bytes = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
        .png()
        .toBuffer();
      return {
        ...result,
        artifact: {
          ...result.artifact,
          bytes,
          hash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
        },
      };
    },
  });
  fixture.fill.upscaleRegistry = registry;
  try {
    const authored = fillStrictDataSchema.parse(
      success(
        await command("fill", [
          fixture.id,
          "--outpaint",
          "--px",
          "2",
          "--prompt",
          "continue the photograph",
        ]),
      ),
    );
    const transformed = layerTransformDataSchema.parse(
      success(
        await command("layer", ["transform", fixture.id, authored.graph.layer, "--scale", "2"]),
      ),
    );
    expect(transformed.upscale).toMatchObject({
      density_satisfied: true,
      target: { w: 88, h: 68 },
      generated: { w: 88, h: 68 },
    });
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
    const exported = await command("export", [
      fixture.id,
      "--to",
      join(fixture.parent, "delivery"),
      "--format",
      "png",
    ]);
    expect(exported).toMatchObject({ ok: true });
    const file = exportResultSchema.parse((exported as { results: unknown[] }).results[0]).file;
    await capture(file, "native-detail");
    const decoded = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 88, height: 68 });
    for (let x = 10; x < 30; x++)
      expect(Math.abs(decoded.data[(2 * 88 + x) * 3]! - (x % 2 ? 240 : 16))).toBeLessThanOrEqual(2);
    expect(fixture.generationCalls()).toBe(1);
    expect(fixture.upscaleCalls()).toBe(1);
  } finally {
    await fixture.close();
  }
});

async function capture(file: string, name: string) {
  const directory = process.env.PHOTOCTL_OUTPAINT_CAPTURE;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await copyFile(file, join(directory, `${name}.png`));
}
