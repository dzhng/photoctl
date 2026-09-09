import { expect, test } from "vitest";
import { prepareSegmentationFrame } from "./segmentation-frame.js";
import { ZimSegmenter } from "./segmentation-runtime.js";

test("cropped quarter-turn segmentation masks return to base space without selecting outside the crop", async () => {
  const source = {
    w: 6,
    h: 4,
    data: new Float32Array(72).fill(0.1),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
  const frame = await prepareSegmentationFrame(
    source,
    { crop: { x: 1, y: 1, w: 4, h: 2 }, rotate: 90 },
    source,
  );
  expect(frame.point([2, 1.5])).toEqual([1.5, 1]);
  const engine = new ZimSegmenter(async () => ({
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
    runDecoder: async () => [
      { dimensions: [1, 4, 512, 512], data: new Float32Array(4 * 512 * 512).fill(1000) },
      { dimensions: [1, 4], data: new Float32Array([1, 0, 0, 0]) },
    ],
  }));
  const prepared = await engine.prepare({
    photoId: "p",
    tier: "develop",
    image: frame.image,
  });
  const mask = await prepared.segment({
    points: [{ at: frame.point([2, 1.5]), label: 1 }],
    projection: { dimensions: source, baseToImage: frame.matrix },
  });
  expect([mask.w, mask.h]).toEqual([6, 4]);
  expect([...mask.data]).toEqual([
    0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
  ]);
});
