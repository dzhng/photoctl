import { expect, test } from "vitest";
import { projectSupportedRgbPixels, type PixelFrameTransform } from "./index.js";

test("supported RGB projection preserves the ordered crop and quarter-turn before expansion", async () => {
  const source = Float32Array.from({ length: 4 * 3 * 3 }, (_, index) => Math.floor(index / 3) + 1);
  const output = await projectSupportedRgbPixels(
    source,
    4,
    3,
    [
      { width: 2, height: 2, matrix: [1, 0, 0, 1, -1, -1] },
      { width: 4, height: 4, matrix: [0, 1, -1, 0, 3, 1] },
    ],
    [],
  );
  expect(output).toEqual(
    Float32Array.from(
      [0, 0, 0, 0, 0, 10, 6, 0, 0, 11, 7, 0, 0, 0, 0, 0].flatMap((value) => [value, value, value]),
    ),
  );
});

test("supported projection snapshots caller pixels and stage geometry at invocation", async () => {
  const input = new Float32Array([1, 2, 3, 4, 5, 6]);
  const matrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 1, 0];
  const stage: PixelFrameTransform = { width: 3, height: 1, matrix };
  const pending = projectSupportedRgbPixels(input, 2, 1, [stage], []);
  expect(input).toEqual(new Float32Array([1, 2, 3, 4, 5, 6]));
  input.fill(99);
  matrix.fill(0);
  stage.width = 1;
  expect(await pending).toEqual(new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]));
  expect(input).toEqual(new Float32Array(6).fill(99));
});

test("supported RGB projection retains zero-base composite signed-zero behavior", async () => {
  const input = new Float32Array([-0, 0, -1, 1, -0, 2]);
  const output = await projectSupportedRgbPixels(
    input,
    2,
    1,
    [],
    [{ width: 1, height: 1, matrix: [1, 0, 0, 1, 0, 0] }],
  );
  expect(new Uint32Array(output.buffer, output.byteOffset, output.length)).toEqual(
    new Uint32Array(new Float32Array([0, 0, -1, 0, 0, 0]).buffer),
  );
  expect(Object.is(input[0], -0)).toBe(true);
});

test("supported RGB projection intersects fractional and out-of-frame visible footprints", async () => {
  const source = Float32Array.from({ length: 4 * 3 * 3 }, (_, index) => Math.floor(index / 3) + 1);
  const output = await projectSupportedRgbPixels(
    source,
    4,
    3,
    [],
    [
      { width: 2, height: 2, matrix: [1, 0, 0, 1, -0.75, -0.25] },
      { width: 2, height: 3, matrix: [1, 0, 0, 1, 0, 0] },
    ],
  );
  expect(output).toEqual(
    Float32Array.from(
      [0, 2, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0].flatMap((value) => [value, value, value]),
    ),
  );
});
