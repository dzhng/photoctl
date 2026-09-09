import { expect, test } from "vitest";
import { ZimSegmenter } from "./segmentation-runtime.js";
import type { SegmentationRuntime, SegmentationTensorInput } from "@photoctl/img";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";

test("signed points and an explicit box survive score-selected fractional decoding", async () => {
  const segmenter = new ZimSegmenter(async () => ({
    encoderInputNames: () => [],
    decoderInputNames: () => [],
    runEncoder: async () =>
      [
        [1, 256, 64, 64],
        [1, 64, 512, 512],
        [1, 128, 256, 256],
        [1, 256, 128, 128],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      })),
    runDecoder: async (inputs) => {
      const labels = inputs.find((input) => input.name === "point_labels")?.f32Data;
      const points = inputs.find((input) => input.name === "point_coords")?.f32Data;
      expect(Array.from(labels!)).toEqual([1, 0, 2, 3]);
      expect(Array.from(points!)).toEqual([128, 128, 896, 128, 0, 0, 1024, 512]);
      const masks = new Float32Array(4 * 512 * 512).fill(-20);
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 256; x++) masks[2 * 512 * 512 + y * 512 + x] = 20;
      return [
        { dimensions: [1, 4, 512, 512], data: masks },
        { dimensions: [1, 4], data: new Float32Array([0.3, 0.1, 0.9, 0.2]) },
      ];
    },
  }));
  const prepared = await segmenter.prepare({
    photoId: "signed",
    tier: "develop",
    image: { w: 4, h: 2, data: new Float32Array(24) },
  });
  const mask = await prepared.segment({
    points: [
      { at: [0.5, 0.5], label: 1 },
      { at: [3.5, 0.5], label: 0 },
    ],
    box: [0, 0, 4, 2],
  });
  [1, 1, 0, 0, 1, 1, 0, 0].forEach((value, index) =>
    expect(mask.data[index]).toBeCloseTo(value, 7),
  );
});

test("a live prepared handle releases source pixels before lazy inference", async () => {
  let source: WeakRef<Float32Array>;
  const segmenter = new ZimSegmenter(async () => ({
    encoderInputNames: () => [],
    decoderInputNames: () => [],
    runEncoder: async () => {
      expect(source.deref()).toBeUndefined();
      return [
        [1, 256, 64, 64],
        [1, 64, 512, 512],
        [1, 128, 256, 256],
        [1, 256, 128, 128],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      }));
    },
    runDecoder: async () => decoded(new Float32Array(512 * 512).fill(-1000)),
  }));
  const prepared = await (async () => {
    const image = { w: 4, h: 2, data: new Float32Array(24).fill(0.5) };
    source = new WeakRef(image.data);
    return await segmenter.prepare({ photoId: "ownership", tier: "develop", image });
  })();
  // GC belongs only to this ownership test, never the production memory path.
  setFlagsFromString("--expose-gc");
  const collect: () => void = runInNewContext("gc");
  await setImmediate();
  collect();
  expect(source!.deref()).toBeUndefined();
  expect([...(await prepared.segment({ points: [{ at: [1, 1], label: 1 }] })).data]).toEqual([
    0, 0, 0, 0, 0, 0, 0, 0,
  ]);
});

test("segmentation prepares lazily and coalesces concurrent prompts", async () => {
  let encodes = 0;
  const runtime: SegmentationRuntime = {
    encoderInputNames: () => ["image"],
    decoderInputNames: () => [],
    runEncoder: async () => {
      encodes += 1;
      return [
        [1, 256, 64, 64],
        [1, 64, 512, 512],
        [1, 128, 256, 256],
        [1, 256, 128, 128],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      }));
    },
    runDecoder: async (inputs: SegmentationTensorInput[]) => {
      const point = inputs.find(({ name }) => name === "point_coords")!.f32Data!;
      const labels = inputs.find(({ name }) => name === "point_labels")!.f32Data!;
      expect([...labels]).toEqual([1, -1]);
      const data = new Float32Array(512 * 512).fill(-1000);
      // Select the half-plane containing the click, with enough confidence to saturate alpha.
      for (let y = 0; y < 512; y++)
        for (let x = 0; x < 512; x++) if (x < 256 === point[0]! < 512) data[y * 512 + x] = 1000;
      return decoded(data);
    },
  };
  const segmenter = new ZimSegmenter(async () => runtime);
  const image = { w: 4, h: 2, data: new Float32Array(24).fill(0.5) };
  const request = { photoId: "photo", tier: "develop" as const, image };
  const [left, right] = await Promise.all([segmenter.prepare(request), segmenter.prepare(request)]);
  expect(encodes).toBe(0);
  const masks = await Promise.all([
    left.segment({ points: [{ at: [0.5, 0.5], label: 1 }] }),
    right.segment({ points: [{ at: [3.5, 0.5], label: 1 }] }),
  ]);
  expect(masks[0]!.data).toEqual(new Float32Array([1, 1, 0, 0, 1, 1, 0, 0]));
  expect(masks[1]!.data).toEqual(new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]));
  expect(encodes).toBe(1);
});

test("changed pixels invalidate encoder features and cache eviction bounds retained photos", async () => {
  let encodes = 0;
  const segmenter = new ZimSegmenter(
    async () => ({
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        encodes++;
        return [
          [1, 256, 64, 64],
          [1, 64, 512, 512],
          [1, 128, 256, 256],
          [1, 256, 128, 128],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => decoded(new Float32Array(512 * 512).fill(1000)),
    }),
    1,
  );
  const request = {
    photoId: "first",
    tier: "develop" as const,
    image: { w: 2, h: 2, data: new Float32Array(12) },
    points: [{ at: [1, 1] as [number, number], label: 1 as const }],
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
  const segmenter = new ZimSegmenter(async () => {
    if (++loads === 1) throw new Error("load failed");
    return {
      encoderInputNames: () => [],
      decoderInputNames: () => [],
      runEncoder: async () => {
        if (++encodes === 1) throw new Error("encode failed");
        return [
          [1, 256, 64, 64],
          [1, 64, 512, 512],
          [1, 128, 256, 256],
          [1, 256, 128, 128],
        ].map((dimensions) => ({
          dimensions,
          data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
        }));
      },
      runDecoder: async () => decoded(new Float32Array(512 * 512).fill(-1000)),
    };
  });
  const request = {
    photoId: "p",
    tier: "offline" as const,
    image: { w: 2, h: 2, data: new Float32Array(12) },
    points: [{ at: [1, 1] as [number, number], label: 1 as const }],
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

function decoded(first: Float32Array) {
  const data = new Float32Array(4 * 512 * 512);
  data.set(first);
  return [
    { dimensions: [1, 4, 512, 512], data },
    { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
  ];
}
