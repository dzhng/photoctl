import { expect, test } from "vitest";
import { prepareZimEncoderInput, restoreZimMask, zimMapping } from "./zim.js";

test("ZIM encodes rounded byte RGB at the top left and pads after normalization", () => {
  const image = { w: 4, h: 2, data: new Float32Array(4 * 2 * 3).fill(0.5) };
  const prepared = prepareZimEncoderInput(image.data, image);
  expect(prepared.mapping.resized).toEqual({ w: 1024, h: 512 });
  expect(prepared.mapping.toModel([2, 1])).toEqual([512, 256]);
  expect(prepared.mapping.toBase([512, 256])).toEqual([2, 1]);
  expect(prepared.data[0]).toBeCloseTo((128 - 123.675) / 58.395, 6);
  expect(prepared.data[1024 * 1024]).toBeCloseTo((128 - 116.28) / 57.12, 6);
  expect(prepared.data[2 * 1024 * 1024]).toBeCloseTo((128 - 103.53) / 57.375, 6);
  expect(prepared.data[512 * 1024]).toBe(0);
  expect(prepared.mapping.source).toEqual({ w: 4, h: 2 });
});

test("ZIM restores logits in two stages before sigmoid without thresholding", async () => {
  const mask = await restoreZimMask(
    new Float32Array([-8, 4, 2, -3]),
    { w: 2, h: 2 },
    zimMapping({ w: 2, h: 1 }),
  );
  // PyTorch interpolate to 1024, crop to 1024x512, interpolate to 2x1, sigmoid.
  expect(mask.data[0]).toBeCloseTo(0.00033896940294653177, 9);
  expect(mask.data[1]).toBeCloseTo(0.9818492531776428, 7);
});

test("restored fractional alpha projects through a rotated crop without selecting outside it", async () => {
  const mask = await restoreZimMask(
    new Float32Array([-8, 4, 2, -3]),
    { w: 2, h: 2 },
    zimMapping({ w: 2, h: 1 }),
    {
      dimensions: { w: 3, h: 4 },
      baseToImage: [0, -1, 1, 0, -1, 2],
    },
  );
  expect(mask.w).toBe(3);
  expect(mask.h).toBe(4);
  const expected = new Float32Array(12);
  expected[4] = 0.00033896940294653177;
  expected[7] = 0.9818492531776428;
  mask.data.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 7));
});
