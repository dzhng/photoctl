import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLibrary } from "@photoctl/library";
import { linearRec2020ToDisplaySrgb } from "@photoctl/img";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import { fillStrictDataSchema } from "@photoctl/protocol";
import {
  evaluateGraphNode,
  readArtifactLinear,
  readArtifactMask,
  loadActiveDocument,
} from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([
  { name: "nonorigin crop", geometry: { crop: { x: 8, y: 4, w: 48, h: 40 } }, reduced: false },
  { name: "quarter rotation", geometry: { rotate: 90 }, reduced: false },
  { name: "fractional straighten", geometry: { straighten_deg: 5 }, reduced: false },
  { name: "offline density", geometry: { crop: { x: 8, y: 4, w: 48, h: 40 } }, reduced: true },
  {
    name: "clipped coverage",
    geometry: { crop: { x: 24, y: 4, w: 32, h: 40 } },
    reduced: false,
    clipped: true,
  },
])("fill samples authored coordinates from $name and refreshes them", async (scenario) => {
  const { geometry, reduced } = scenario;
  const clipped = "clipped" in scenario;
  const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-input-frame-"));
  const handle = (await initializeLibrary(join(parent, "library"))).handle;
  const server = await startGatewayFixture();
  try {
    const sourcePath = join(parent, "source.png");
    await sharp({ create: { width: 64, height: 48, channels: 3, background: "#864" } })
      .png()
      .toFile(sourcePath);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Gateway unavailable");
    const gateway = new GatewayClient({
      apiKey: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    });
    const uploads: Array<{ image: Buffer; mask: Buffer; width: number; height: number }> = [];
    const warnings: string[] = [];
    const source = async () => {
      const w = reduced ? 32 : 64;
      const h = reduced ? 24 : 48;
      const pixels = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          pixels[(y * w + x) * 3] = x < w / 2 ? 0.15 : 0.4;
          pixels[(y * w + x) * 3 + 1] = y < h / 2 ? 0.2 : 0.35;
          pixels[(y * w + x) * 3 + 2] = 0.25;
        }
      return {
        image: {
          w,
          h,
          data: pixels,
          orientationApplied: true as const,
          space: "scene-linear-rec2020" as const,
          whiteLevel: 1,
          blackLevel: 0,
          wbPreApplied: true,
        },
        provenance: reduced
          ? {
              locator: { kind: "pinned-preview" as const, cache_path: "fixture.jpg" },
              tier: "pinned-preview" as const,
              w,
              h,
              decoderId: "fixture",
              decoderVersion: "1",
            }
          : {
              locator: {
                kind: "online-file" as const,
                volume_uuid: "fixture",
                rel_path: "source.png",
              },
              tier: "online-file" as const,
              w,
              h,
              decoderId: "fixture",
              decoderVersion: "1",
            },
      };
    };
    const context = {
      version: "test",
      library: handle,
      fill: {
        source,
        model: "fixture/native-image-v1",
        adapter: new GatewayImageModelAdapter({
          model: "fixture/native-image-v1",
          mask: "native",
          maskPolarity: "white-edits",
        }),
        gateway: {
          imageEdits: async (form: FormData) => {
            const uploaded = await sharp(
              Buffer.from(await (form.get("image") as File).arrayBuffer()),
            )
              .raw()
              .toBuffer({ resolveWithObject: true });
            const mask = await sharp(Buffer.from(await (form.get("mask") as File).arrayBuffer()))
              .extractChannel(0)
              .raw()
              .toBuffer();
            uploads.push({
              image: uploaded.data,
              mask,
              width: uploaded.info.width,
              height: uploaded.info.height,
            });
            return await gateway.imageEdits(form);
          },
        },
      },
    };
    const command = async (verb: string, args: string[]) => {
      const result = await dispatch(
        {
          verb,
          args,
          cwd: parent,
          env: {
            noDaemon: true,
            cacheRoot: join(parent, "cache"),
            volumeMap: `${parent}=fixture:online`,
          },
        },
        context,
      );
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("Expected success");
      if ("warnings" in result) warnings.push(...result.warnings.map(({ code }) => code));
      return "data" in result ? result.data : result;
    };
    const id = ((await command("import", [sourcePath, "--link"])) as { ids: string[] }).ids[0]!;
    await command("develop", [
      id,
      ...Object.entries(geometry).flatMap(([key, value]) => [
        "--set",
        `${key}=${JSON.stringify(value)}`,
      ]),
    ]);
    const layer = (
      (await command("segment", [id, "--box", clipped ? "4,16,28,8" : "24,16,8,8"])) as {
        layer_id: string;
      }
    ).layer_id;
    const fill = fillStrictDataSchema.parse(
      await command("fill", [id, "--layer", layer, "--remove", "--pad", "0", "--no-upscale"]),
    );
    expect(uploads).toHaveLength(1);
    expect([uploads[0]!.width, uploads[0]!.height]).toEqual([16, 16]);
    // The provider sees a base-coordinate crop, not a relabelled rotated/cropped frame.
    const sentWidth = uploads[0]!.width;
    expect(uploads[0]!.mask[4 * sentWidth + 12]).toBe(255);
    expect(uploads[0]!.mask[4 * sentWidth + 4]).toBe(0);
    const expectedDisplay = await linearRec2020ToDisplaySrgb(
      new Float32Array([0.15, 0.2, 0.25, 0.15, 0.35, 0.25]),
    );
    const expectedBytes = Buffer.from(expectedDisplay.map((value) => Math.round(value * 255)));
    const sampleX = clipped ? 12 : 4;
    expect(
      uploads[0]!.image.subarray((4 * sentWidth + sampleX) * 3, (4 * sentWidth + sampleX) * 3 + 3),
    ).toEqual(expectedBytes.subarray(0, 3));
    expect(
      uploads[0]!.image.subarray(
        (12 * sentWidth + sampleX) * 3,
        (12 * sentWidth + sampleX) * 3 + 3,
      ),
    ).toEqual(expectedBytes.subarray(3, 6));
    if (clipped)
      expect(
        uploads[0]!.image.subarray((4 * sentWidth + 4) * 3, (4 * sentWidth + 4) * 3 + 3),
      ).toEqual(Buffer.alloc(3));
    const document = (await loadActiveDocument(handle, id))!;
    const pixels = async (nodeId: string) =>
      await readArtifactLinear(
        (
          await evaluateGraphNode({
            database: handle,
            libraryPath: handle.path,
            photoId: id,
            nodeId,
            source,
          })
        ).artifact.path,
      );
    const base = await pixels(document.roots.base);
    const generation = (await command("graph", ["node", id, fill.generation.node])) as {
      parameters: { request: { sampling: unknown; source_context: unknown } };
    };
    expect(generation.parameters.request.sampling).toMatchObject({
      input_dimensions: [base.w, base.h],
      outside_visible: "black-protected",
    });
    expect(generation.parameters.request.source_context).toMatchObject({
      tier: reduced ? "pinned-preview" : "online-file",
      pixel_scale: reduced ? 0.5 : 1,
      resolution_limited: reduced,
    });
    const output = await pixels(fill.graph.output_node);
    expect([output.w, output.h]).toEqual([base.w, base.h]);
    expect(output.data.slice(0, 3)).toEqual(base.data.slice(0, 3));
    expect(output.data).not.toEqual(base.data);
    await command("layer", ["refresh", id, layer]);
    expect(uploads).toHaveLength(2);
    expect(uploads[1]).toEqual(uploads[0]);
    if (clipped) {
      expect(warnings.filter((code) => code === "mask_clipped")).toHaveLength(2);
      const hiddenLayer = (
        (await command("segment", [id, "--box", "0,0,4,4"])) as { layer_id: string }
      ).layer_id;
      const beforeHidden = (await loadActiveDocument(handle, id))!.revisionId;
      const hidden = await dispatch(
        {
          verb: "fill",
          args: [id, "--layer", hiddenLayer, "--remove", "--pad", "0", "--no-upscale"],
          cwd: parent,
          env: {
            noDaemon: true,
            cacheRoot: join(parent, "cache"),
            volumeMap: `${parent}=fixture:online`,
          },
        },
        context,
      );
      expect(hidden).toMatchObject({ ok: false, code: "usage" });
      expect((await loadActiveDocument(handle, id))!.revisionId).toBe(beforeHidden);
      expect(uploads).toHaveLength(2);
      await command("develop", [id, "--unset", "crop"]);
      const restored = (await loadActiveDocument(handle, id))!;
      const restoredLayer = restored.layers.find(({ id: layerId }) => layerId === layer)!;
      const maskEvaluation = await evaluateGraphNode({
        database: handle,
        libraryPath: handle.path,
        photoId: id,
        nodeId: restoredLayer.maskNodeId,
        source,
      });
      const authoredSupport = await readArtifactMask(maskEvaluation.artifact.path);
      expect(authoredSupport.data[20 * 64 + 6]).toBe(0);
      expect(authoredSupport.data[20 * 64 + 28]).toBe(1);
      const restoredBase = await pixels(restored.roots.base);
      const restoredOutput = await pixels(restored.roots.output!);
      for (let y = 16; y < 24; y++)
        for (let x = 4; x < 24; x++) {
          const offset = (y * 64 + x) * 3;
          expect(restoredOutput.data.slice(offset, offset + 3)).toEqual(
            restoredBase.data.slice(offset, offset + 3),
          );
        }
      const visible = (20 * 64 + 28) * 3;
      expect(restoredOutput.data.slice(visible, visible + 3)).not.toEqual(
        restoredBase.data.slice(visible, visible + 3),
      );
      expect(uploads).toHaveLength(2);
      // Regeneration is explicit: after uncrop, refresh reuses original selection intent, not the old clipped mask.
      await command("layer", ["refresh", id, layer]);
      const regenerated = (await loadActiveDocument(handle, id))!;
      const regeneratedOutput = await pixels(regenerated.roots.output!);
      const formerlyHidden = (20 * 64 + 6) * 3;
      expect(uploads[2]!.width).toBe(32);
      expect(regeneratedOutput.data.slice(formerlyHidden, formerlyHidden + 3)).toEqual(
        regeneratedOutput.data.slice(visible, visible + 3),
      );
      expect(regeneratedOutput.data.slice(formerlyHidden, formerlyHidden + 3)).not.toEqual(
        restoredBase.data.slice(formerlyHidden, formerlyHidden + 3),
      );
      expect(uploads).toHaveLength(3);
    }
  } finally {
    await handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(parent, { recursive: true });
  }
});
