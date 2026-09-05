import { expect, test } from "vitest";
import { containingFrame, developFrame, canvasGeometryPlan } from "./frame.js";
import { expandCanvasFrame } from "./canvas.js";

const limits = { maxOutputEdge: 16_384, maxOutputPixels: 64_000_000 };

test("integer viewport bounds retain true fractional exterior coordinates on negative edges", () => {
  const reference = developFrame({ w: 16, h: 12 }, { w: 16, h: 12 });
  const contained = containingFrame(reference, [
    { x: -0.125, y: -0.25 },
    { x: 16, y: -0.25 },
    { x: 16, y: 12 },
    { x: -0.125, y: 12 },
  ]);
  expect(contained.raster).toEqual({ w: 17, h: 13 });
  expect(contained.baseToRaster).toEqual([1, 0, 0, 1, 1, 1]);
});

test("canvas expansion keeps the authored frame on integer offsets and checks bounds before allocation", () => {
  const input = developFrame(
    { w: 16, h: 12 },
    { w: 16, h: 12 },
    {
      crop: { x: 4, y: 3, w: 6, h: 4 },
      rotate: 90,
    },
  );
  const expanded = expandCanvasFrame(input, { padding: 2 }, limits);
  expect(expanded.frame.raster).toEqual({ w: 8, h: 10 });
  expect(expanded.frame.baseToRaster).toEqual([0, 1, -1, 0, 9, -2]);
  expect(expanded.offset).toEqual({ x: 2, y: 2 });
  const aspect = expandCanvasFrame(input, { aspect: [1, 1] }, limits);
  expect(aspect.frame.raster).toEqual({ w: 6, h: 6 });
  expect(aspect.offset).toEqual({ x: 1, y: 0 });
  expect(expandCanvasFrame(input, { aspect: [2, 3] }, limits).changed).toBe(false);
  const odd = expandCanvasFrame(
    developFrame({ w: 5, h: 4 }, { w: 5, h: 4 }),
    { aspect: [1, 1] },
    limits,
  );
  expect(odd.offset).toEqual({ x: 0, y: 0 });
  expect(odd.frame.raster).toEqual({ w: 5, h: 5 });
  expect(() => expandCanvasFrame(input, { padding: Number.MAX_SAFE_INTEGER }, limits)).toThrow();
  expect(() =>
    expandCanvasFrame(input, { padding: 2 }, { ...limits, maxOutputPixels: 79 }),
  ).toThrow();
});

test("orientation replaces the tail against the stable authored outer frame without accumulated shrink", () => {
  const dimensions = { w: 1000, h: 800 };
  const authored = {
    crop: { x: 100, y: 200, w: 400, h: 200 },
    rotate: 90 as const,
    straighten_deg: 10,
  };
  const input = developFrame(dimensions, dimensions, authored);
  expect(input.raster).toEqual({ w: 135, h: 382 });
  const outer = expandCanvasFrame(input, { padding: 20 }, limits).frame;
  expect(outer.raster).toEqual({ w: 175, h: 422 });
  const tilted = canvasGeometryPlan(outer, authored, { rotate: 90, straighten_deg: 5 }).frame;
  expect(tilted.raster.w).toBeLessThan(outer.raster.w);
  expect(tilted.raster.h).toBeLessThan(outer.raster.h);
  expect(canvasGeometryPlan(outer, authored, authored).frame).toEqual(outer);
  expect(
    canvasGeometryPlan(outer, authored, { rotate: 180, straighten_deg: 10 }).frame.raster,
  ).toEqual({ w: 422, h: 175 });
  expect(canvasGeometryPlan(outer, authored, { rotate: 90, straighten_deg: 5 }).frame).toEqual(
    tilted,
  );
});
