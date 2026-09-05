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

  const resample = vi.fn(async () => new Float32Array(1024 * 512 * 3).fill(0.25));
  const prepared = await prepareSam2EncoderInput(
    new Float32Array(4 * 2 * 3),
    { w: 4, h: 2 },
    resample,
  );
  expect(resample).toHaveBeenCalledOnce();
  expect(resample).toHaveBeenCalledWith(expect.any(Float32Array), 4, 2, 3, 1024, 512, "bilinear");
  expect(prepared.mapping).toMatchObject({ resized: mapping.resized, offset: mapping.offset });
  expect(prepared.data[0]).toBe(0);
  expect(prepared.data[256 * 1024 * 3]).toBe(0.25);
  expect(prepared.data[(256 + 512) * 1024 * 3]).toBe(0);
});

test("SAM letterboxing rejects empty image dimensions", () => {
  expect(() => sam2Letterbox({ w: 0, h: 8 })).toThrow("positive integers");
});
