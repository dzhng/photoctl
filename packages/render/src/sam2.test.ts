import { expect, test, vi } from "vitest";
import { sam2Letterbox, prepareSam2EncoderInput } from "./sam2.js";

test("SAM coordinates share the centered 1024 letterbox used for encoder pixels", async () => {
  const mapping = sam2Letterbox({ w: 4, h: 2 });
  expect(mapping).toMatchObject({
    source: { w: 4, h: 2 },
    model: { w: 1024, h: 1024 },
    resized: { w: 1024, h: 512 },
    scale: 256,
    offset: { x: 0, y: 256 },
  });
  expect(mapping.toModel([1, 0.5])).toEqual([256, 384]);
  expect(mapping.toBase([256, 384])).toEqual([1, 0.5]);

  const resampled = new Float32Array(1024 * 512 * 3);
  resampled.set([1, 0, 0]);
  const resample = vi.fn(async () => resampled);
  const prepared = await prepareSam2EncoderInput(
    new Float32Array(4 * 2 * 3),
    { w: 4, h: 2 },
    resample,
  );
  expect(resample).toHaveBeenCalledOnce();
  expect(resample).toHaveBeenCalledWith(expect.any(Float32Array), 4, 2, 3, 1024, 512, "bilinear");
  expect(prepared.mapping).toMatchObject({ resized: mapping.resized, offset: mapping.offset });
  const paddedPixel = 256 * 1024;
  const channelSize = 1024 * 1024;
  expect(prepared.data[paddedPixel]).toBeCloseTo((1 - 0.485) / 0.229, 5);
  expect(prepared.data[channelSize + paddedPixel]).toBeCloseTo((0 - 0.456) / 0.224, 5);
  expect(prepared.data[channelSize * 2 + paddedPixel]).toBeCloseTo((0 - 0.406) / 0.225, 5);
  expect(prepared.data[paddedPixel - 1]).toBe(0);
});

test("SAM prompt coordinates use the exact rounded resize on each axis", () => {
  const mapping = sam2Letterbox({ w: 3, h: 2 });
  expect(mapping.resized).toEqual({ w: 1024, h: 683 });
  expect(mapping.toModel([3, 2])).toEqual([1024, 853]);
  expect(mapping.toBase(mapping.toModel([1.25, 0.75]))).toEqual([1.25, 0.75]);
});

test("SAM letterboxing rejects empty image dimensions", () => {
  expect(() => sam2Letterbox({ w: 0, h: 8 })).toThrow("positive integers");
});
