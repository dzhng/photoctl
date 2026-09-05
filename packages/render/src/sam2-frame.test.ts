import { expect, test } from "vitest";
import { prepareSam2Frame } from "./sam2-frame.js";
import { Sam2Segmenter } from "./sam2-runtime.js";

test("cropped quarter-turn SAM masks return to base space without selecting outside the crop", async () => {
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
  const frame = await prepareSam2Frame(
    source,
    { crop: { x: 1, y: 1, w: 4, h: 2 }, rotate: 90 },
    source,
  );
  expect(frame.point([2, 1.5])).toEqual([1.5, 1]);
  const engine = new Sam2Segmenter(async () => ({
    encoderInputNames: () => [],
    decoderInputNames: () => [],
    runEncoder: async () =>
      [
        [1, 32, 256, 256],
        [1, 64, 128, 128],
        [1, 256, 64, 64],
      ].map((dimensions) => ({
        dimensions,
        data: new Float32Array(dimensions.reduce((a, b) => a * b, 1)),
      })),
    runDecoder: async () => [
      { dimensions: [1, 1, 256, 256], data: new Float32Array(256 * 256).fill(1) },
    ],
  }));
  const prepared = await engine.prepare({
    photoId: "p",
    tier: "develop",
    image: frame.image,
  });
  const mask = await prepared.segment({
    points: [frame.point([2, 1.5])],
    projection: { dimensions: source, baseToImage: frame.matrix },
  });
  expect([mask.w, mask.h]).toEqual([6, 4]);
  expect([...mask.data]).toEqual([
    0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
  ]);
});
