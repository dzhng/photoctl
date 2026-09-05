import {
  compositeMaskedPixels,
  featherMask,
  liftMaskedPixels,
  morphologyMask,
  transformMaskPixels,
  transformPixels,
} from "@photoctl/img";
import { expect, test } from "vitest";

test("native mask morphology and feather operate on asymmetric single-channel coverage", async () => {
  const mask = new Float32Array([0, 0, 0, 0, 1, 0]);

  expect(await morphologyMask(mask, 3, 2, 1, "dilate")).toEqual(new Float32Array(6).fill(1));
  expect(await morphologyMask(new Float32Array(6).fill(1), 3, 2, 1, "erode")).toEqual(
    new Float32Array(6),
  );
  const feathered = await featherMask(mask, 3, 2, 1);
  expect(feathered[4]).toBeGreaterThan(feathered[0]);
  expect(feathered.every((sample) => sample >= 0 && sample <= 1)).toBe(true);
});

test("native lift and composite preserve exterior values exactly", async () => {
  const base = new Float32Array([
    -0.25, 0.5, 2, 10, 20, 30, 100, 200, 300, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  const content = new Float32Array(base.map((sample) => sample + 20));
  const mask = new Float32Array([0, 0.5, 0, 1, 0, 0]);

  const lifted = await liftMaskedPixels(content, mask, 3, 2);
  expect(Array.from(lifted.slice(0, 3))).toEqual([0, 0, 0]);
  expect(lifted.slice(3, 6)).toEqual(content.slice(3, 6));

  const composite = await compositeMaskedPixels(base, content, mask, 3, 2, 0.5);
  for (const pixel of [0, 2, 4, 5]) {
    expect(composite.slice(pixel * 3, pixel * 3 + 3)).toEqual(base.slice(pixel * 3, pixel * 3 + 3));
  }
  expect(composite.slice(3, 6)).toEqual(new Float32Array([15, 25, 35]));
});

test("native mask transform uses the shared pixel-center matrix convention", async () => {
  const mask = new Float32Array([1, 0, 0, 0, 0, 0]);
  const transformed = await transformMaskPixels(mask, 3, 2, 3, 2, [-1, 0, 0, 1, 3, 0]);

  expect(transformed).toEqual(new Float32Array([0, 0, 1, 0, 0, 0]));
});

test("one move matrix keeps lifted content and its active mask aligned", async () => {
  const mask = new Float32Array([0, 1, 0, 0, 0, 0]);
  const content = new Float32Array([0, 0, 0, 10, 20, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const matrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 1, 0];

  const movedMask = await transformMaskPixels(mask, 3, 2, 3, 2, matrix);
  const movedContent = await transformPixels(content, 3, 2, 3, 3, 2, matrix, "lanczos3");

  expect(movedMask).toEqual(new Float32Array([0, 0, 1, 0, 0, 0]));
  expect(movedContent.slice(6, 9)).toEqual(new Float32Array([10, 20, 30]));
  expect(mask).toEqual(new Float32Array([0, 1, 0, 0, 0, 0]));
});
