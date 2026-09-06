import { expect, test } from "vitest";
import { compositeMaskedPixels } from "@photoctl/img";
import { rasterFrame } from "./frame.js";
import {
  clipCoverageToFrames,
  projectRgbToRender,
  projectSupportedRgbToRender,
} from "./projection.js";

test("supported projection retains fractional sequential sampling and authored exclusions", async () => {
  const dimensions = { w: 4, h: 3 };
  const source = {
    ...dimensions,
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    data: Float32Array.from({ length: 36 }, (_, index) => Math.sin(index) * 0.3),
  };
  const from = rasterFrame(dimensions, dimensions, dimensions, [1, 0, 0, 1, 0, 0]);
  const crop = rasterFrame(dimensions, dimensions, { w: 3, h: 2 }, [1, 0, 0, 1, -0.35, -0.4]);
  const output = rasterFrame(
    dimensions,
    dimensions,
    { w: 6, h: 5 },
    [0.95, 0.3, -0.3, 0.95, 1.1, 0.25],
  );
  const cropped = await projectRgbToRender(source, from, crop, crop.raster);
  const sampled = await projectRgbToRender(cropped, crop, output, output.raster);
  const support = clipCoverageToFrames(
    { ...output.raster, data: new Float32Array(30).fill(1) },
    output,
    [from, crop],
  );
  const expected = await compositeMaskedPixels(
    new Float32Array(90),
    sampled.data,
    support.data,
    6,
    5,
    1,
  );
  const actual = await projectSupportedRgbToRender(source, from, [crop], output, (frame) => frame);
  expect([actual.w, actual.h]).toEqual([6, 5]);
  expect(actual.data).toEqual(expected);
  expect(actual.data.some((value) => value !== 0)).toBe(true);
  expect(actual.data.some((value) => value === 0)).toBe(true);
});
