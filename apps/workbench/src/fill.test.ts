import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLibrary, openLibrary } from "@photoctl/library";
import {
  createManualLayer,
  evaluateGraphNode,
  fillLayerStrict,
  moveLayer,
  resolveUpscalePolicy,
} from "@photoctl/render";
import sharp from "sharp";
import { afterEach, expect, test, vi } from "vitest";
import { runWorkbench } from "./run.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { recursive: true })),
  );
});

test("fill renders one self-contained native crop from the immutable before, generated, and current artifacts", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-fill-"));
  temporaryDirectories.push(cwd);
  const libraryPath = join(cwd, "library");
  const library = (await initializeLibrary(libraryPath)).handle;
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c054";
  await library.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_7890abcdef123457', 1, 64, 48, 1)`,
    [photoId],
  );
  const layer = await createManualLayer(library, libraryPath, {
    photoId,
    orientation: 1,
    dimensions: { w: 64, h: 48 },
    shape: { kind: "box", bbox: [18, 12, 20, 16] },
  });
  const sourceData = new Float32Array(64 * 48 * 3);
  for (let pixel = 0; pixel < 64 * 48; pixel += 1) {
    sourceData[pixel * 3] = (pixel % 64) / 63;
    sourceData[pixel * 3 + 1] = Math.floor(pixel / 64) / 47;
    sourceData[pixel * 3 + 2] = 0.2;
  }
  const replacement = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#d34b8f" },
  })
    .png()
    .toBuffer();
  const upscaled = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#d34b8f" },
  })
    .png()
    .toBuffer();
  let providerCalls = 0;
  let upscaleCalls = 0;
  await fillLayerStrict(library, libraryPath, {
    photoId,
    layer: layer.layerId,
    prompt: "remove <script>alert('boundary')</script>",
    promptVersion: 1,
    operation: "remove",
    pad: 0,
    source: async () => ({
      image: {
        w: 64,
        h: 48,
        data: sourceData,
        orientationApplied: true,
        space: "scene-linear-rec2020",
        whiteLevel: 1,
        blackLevel: 0,
        wbPreApplied: true,
      },
      provenance: {
        locator: { kind: "online-file", volume_uuid: "fixture", rel_path: "image.png" },
        tier: "online-file",
        w: 64,
        h: 48,
        decoderId: "fixture",
        decoderVersion: "1",
      },
    }),
    dependencies: {
      adapter: {
        id: "fixture-image-edit",
        version: "1",
        buildEdit: () => new FormData(),
        normalize: async () => ({
          png: replacement,
          returnedDimensions: { w: 16, h: 16 },
          wholeFrame: false,
          warnings: [],
        }),
      },
      gateway: {
        imageEdits: async () => {
          providerCalls += 1;
          return { data: {}, requestId: "fixture-request", attempts: 1 };
        },
      },
      model: "fixture-model",
    },
    sourceContext: { tier: "online-file", pixelScale: 1, resolutionLimited: false },
    upscale: {
      policy: resolveUpscalePolicy({
        releaseDefaultModel: "fixture-upscale",
        availableAdapterIds: ["fixture-upscale"],
        flag: "upscale",
        settings: { providers: { upscale: { "fixture-upscale": { configured: true } } } },
        sourceContext: { tier: "online-file", pixelScale: 1, resolutionLimited: false },
      }),
      prompt: { id: "guard", version: 1, original: "remove", derived: "guarded" },
      adapter: {
        id: "fixture-upscale",
        version: "1",
        supportedScales: [2],
        limits: { maxInputPixels: 1_000_000, maxOutputPixels: 1_000_000, maxOutputEdge: 1_000 },
        execute: async () => {
          upscaleCalls += 1;
          return {
            ok: true,
            value: {
              artifact: { bytes: upscaled, dimensions: { w: 32, h: 32 } },
              dimensions: { w: 32, h: 32 },
              provenance: {
                adapter: "fixture-upscale",
                adapterVersion: "1",
                service: "fixture",
                model: "fixture-upscale",
                modelVersion: "1",
                requestId: "upscale-request",
                seed: null,
                durationMs: 1,
                costUsd: 0,
              },
            },
            samplingDimensions: { w: 32, h: 32 },
            densitySatisfied: true,
            warnings: [],
          };
        },
      },
    },
  });
  const sourceNode = (
    await library.query<{ id: string }>(
      "SELECT id FROM image_nodes WHERE photo_id = $1 AND kind = 'source'",
      [photoId],
    )
  ).rows[0]!;
  await evaluateGraphNode({
    database: library,
    libraryPath,
    photoId,
    nodeId: sourceNode.id,
    source: async () => ({
      image: {
        w: 64,
        h: 48,
        data: new Float32Array(64 * 48 * 3).fill(1),
        orientationApplied: true,
        space: "scene-linear-rec2020",
        whiteLevel: 1,
        blackLevel: 0,
        wbPreApplied: true,
      },
      provenance: {
        locator: { kind: "pinned-preview", cache_path: "/fixture/later.jpg" },
        tier: "pinned-preview",
        w: 64,
        h: 48,
        decoderId: "later-fixture",
        decoderVersion: "1",
      },
    }),
  });
  await library.close();

  vi.stubGlobal("fetch", () => {
    throw new Error("workbench must not make network requests");
  });
  const output = await runWorkbench(["fill", photoId, "--layer", layer.layerId], cwd, {
    PHOTOCTL_LIBRARY: libraryPath,
  });
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "fill.html"));
  expect(providerCalls).toBe(1);
  expect(upscaleCalls).toBe(1);
  expect(html).toContain("Native-detail fill boundary");
  expect(html).toContain("Before fill");
  expect(html).toContain("After fill · generated replacement");
  expect(html).toContain("Current layer result");
  expect(html).toContain("<span>Upscale</span><strong>fixture-upscale · fixture-upscale</strong>");
  expect(html).toMatch(/<span>Upscale node<\/span><strong>node_[0-9a-f]{64}<\/strong>/u);
  expect(html).toContain("16, 0 · 32 × 32 base px");
  expect(html.match(/src="data:image\/png;base64,/gu)).toHaveLength(4);
  expect(html).toContain("remove &lt;script&gt;alert(&#39;boundary&#39;)&lt;/script&gt;");
  expect(html).not.toContain("<script>alert");
  expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=/u);
  const images = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/gu)].map((match) =>
    Buffer.from(match[1]!, "base64"),
  );
  const decoded = await Promise.all(
    images.map(async (bytes) => await sharp(bytes).raw().toBuffer({ resolveWithObject: true })),
  );
  expect(decoded.map(({ info }) => [info.width, info.height])).toEqual([
    [32, 32],
    [32, 32],
    [32, 32],
    [32, 32],
  ]);
  expect(rgbAt(decoded[2]!.data, 32, 0, 0)).toEqual(rgbAt(decoded[0]!.data, 32, 0, 0));
  expect(rgbAt(decoded[0]!.data, 32, 0, 0)).not.toEqual([255, 255, 255]);
  expect(rgbAt(decoded[2]!.data, 32, 4, 14)).toEqual(rgbAt(decoded[1]!.data, 32, 4, 14));
  expect(rgbAt(decoded[3]!.data, 32, 2, 12)).toEqual([41, 229, 214]);

  const movedLibrary = await openLibrary(libraryPath);
  await moveLayer(movedLibrary, libraryPath, {
    photoId,
    orientation: 1,
    dimensions: { w: 64, h: 48 },
    layer: layer.layerId,
    destination: { mode: "by", x: 4, y: 0 },
  });
  await movedLibrary.close();
  await expect(
    runWorkbench(["fill", photoId, "--layer", layer.layerId], cwd, {
      PHOTOCTL_LIBRARY: libraryPath,
    }),
  ).rejects.toThrow("Fill report does not yet support transformed fill layers");
});

function rgbAt(data: Buffer, width: number, x: number, y: number): number[] {
  return [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}

test.each([
  [[], "usage: wb"],
  [["fill", "photo", "--layer"], "usage: wb fill <photo-id> --layer <layer-id>"],
  [["fill", "photo", "layer"], "usage: wb fill <photo-id> --layer <layer-id>"],
  [["fill", "photo", "--layer", "layer", "extra"], "usage: wb fill <photo-id> --layer <layer-id>"],
])("fill rejects any shape other than the exact public grammar: %j", async (args, message) => {
  await expect(runWorkbench(args, process.cwd())).rejects.toThrow(message);
});

test("fill refuses an active mask layer that has no committed fill ancestry", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-unfilled-"));
  temporaryDirectories.push(cwd);
  const libraryPath = join(cwd, "library");
  const library = (await initializeLibrary(libraryPath)).handle;
  const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c055";
  await library.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_7890abcdef123458', 1, 32, 24, 1)`,
    [photoId],
  );
  const layer = await createManualLayer(library, libraryPath, {
    photoId,
    orientation: 1,
    dimensions: { w: 32, h: 24 },
    shape: { kind: "box", bbox: [8, 6, 8, 8] },
  });
  await library.close();

  await expect(
    runWorkbench(["fill", photoId, "--layer", layer.layerId], cwd, {
      PHOTOCTL_LIBRARY: libraryPath,
    }),
  ).rejects.toThrow("Layer does not contain a refreshable fill branch");
});
