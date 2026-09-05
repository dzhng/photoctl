import { expect, test } from "vitest";
import { Sam2Segmenter } from "./sam2-runtime.js";
import type { Sam2OnnxRuntime, Sam2TensorInput } from "@photoctl/img";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";

test("a live prepared handle releases source pixels before lazy inference", async () => {
  let source: WeakRef<Float32Array>;
  const segmenter = new Sam2Segmenter(async () => ({
    encoderInputNames: () => [],
    decoderInputNames: () => [],
    runEncoder: async () => {
      expect(source.deref()).toBeUndefined();
      return [
        [1, 32, 256, 256],
        [1, 64, 128, 128],
        [1, 256, 64, 64],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      }));
    },
    runDecoder: async () => [
      { dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(-1) },
    ],
  }));
  const prepared = await (async () => {
    const image = { w: 4, h: 2, data: new Float32Array(24).fill(0.5) };
    source = new WeakRef(image.data);
    return await segmenter.prepare({ photoId: "ownership", tier: "develop", image });
  })();
  // GC belongs only to this ownership test, never the production memory path.
  const bun = Reflect.get(globalThis, "Bun") as { gc(force: boolean): void } | undefined;
  let collect: () => void;
  if (bun) collect = () => bun.gc(true);
  else {
    setFlagsFromString("--expose-gc");
    collect = runInNewContext("gc");
  }
  await setImmediate();
  collect();
  expect(source!.deref()).toBeUndefined();
  expect([...(await prepared.segment({ points: [[1, 1]] })).data]).toEqual([
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
});

test("SAM prepares lazily and coalesces concurrent prompts through the letterbox", async () => {
  let encodes = 0;
  const runtime: Sam2OnnxRuntime = {
    encoderInputNames: () => ["image"],
    decoderInputNames: () => [],
    runEncoder: async () => {
      encodes += 1;
      return [
        [1, 32, 256, 256],
        [1, 64, 128, 128],
        [1, 256, 64, 64],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      }));
    },
    runDecoder: async (inputs: Sam2TensorInput[]) => {
      const point = inputs.find(({ name }) => name === "point_coords")!.f32Data!;
      const labels = inputs.find(({ name }) => name === "point_labels")!.i32Data!;
      expect([...labels]).toEqual([1]);
      const data = new Float32Array(256 * 256).fill(-1);
      // Select the half-plane containing the click, including inverse-letterbox padding.
      for (let y = 0; y < 256; y++)
        for (let x = 0; x < 256; x++) if (x < 128 === point[0]! < 512) data[y * 256 + x] = 1;
      return [{ dimensions: [1, 1, 256, 256], data }];
    },
  };
  const segmenter = new Sam2Segmenter(async () => runtime);
  const image = { w: 4, h: 2, data: new Float32Array(24).fill(0.5) };
  const request = { photoId: "photo", tier: "develop" as const, image };
  const [left, right] = await Promise.all([segmenter.prepare(request), segmenter.prepare(request)]);
  expect(encodes).toBe(0);
  const masks = await Promise.all([
    left.segment({ points: [[0.5, 0.5]] }),
    right.segment({ points: [[3.5, 0.5]] }),
  ]);
  expect(masks[0]!.data).toEqual(new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]));
  expect(masks[1]!.data).toEqual(new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]));
  expect(encodes).toBe(1);
});

test("changed pixels invalidate encoder features and cache eviction bounds retained photos", async () => {
  let encodes = 0;
  const segmenter = new Sam2Segmenter(
    async () => ({
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        encodes++;
        return [
          [1, 32, 256, 256],
          [1, 64, 128, 128],
          [1, 256, 64, 64],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => [
        { dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(1) },
      ],
    }),
    1,
  );
  const request = {
    photoId: "first",
    tier: "develop" as const,
    image: { w: 2, h: 2, data: new Float32Array(12) },
    points: [[1, 1] as [number, number]],
  };
  const select = async (input = request) =>
    expect([...(await (await segmenter.prepare(input)).segment(input)).data]).toEqual([1, 1, 1, 1]);
  await select();
  await select();
  expect(encodes).toBe(1);
  request.image.data.fill(0.5);
  await select();
  expect(encodes).toBe(2);
  await select({ ...request, photoId: "second" });
  await select();
  expect(encodes).toBe(4);
  segmenter.clear();
  await select();
  expect(encodes).toBe(5);
});

test("runtime and encoder failures are retryable without retaining a rejected cache entry", async () => {
  let loads = 0,
    encodes = 0;
  const segmenter = new Sam2Segmenter(async () => {
    if (++loads === 1) throw new Error("load failed");
    return {
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        if (++encodes === 1) throw new Error("encode failed");
        return [
          [1, 32, 256, 256],
          [1, 64, 128, 128],
          [1, 256, 64, 64],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => [
        { dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(-1) },
      ],
    };
  });
  const request = {
    photoId: "p",
    tier: "offline" as const,
    image: { w: 2, h: 2, data: new Float32Array(12) },
    points: [[1, 1] as [number, number]],
  };
  await expect(segmenter.prepare(request)).rejects.toThrow("load failed");
  await expect((await segmenter.prepare(request)).segment(request)).rejects.toThrow(
    "encode failed",
  );
  expect([...(await (await segmenter.prepare(request)).segment(request)).data]).toEqual([
    0, 0, 0, 0,
  ]);
  expect([loads, encodes]).toEqual([2, 2]);
});
