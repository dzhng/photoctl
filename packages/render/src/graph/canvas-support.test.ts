import { describe, expect, it } from "vitest";
import { admissibleCanvasSupport, hasUncoveredCanvas } from "./canvas-support.js";
import { rasterFrame, type RenderFrame } from "./frame.js";
import { polygonArea, subtractConvexPolygon } from "../develop/geometry.js";
import {
  composeTransformMatrices,
  invertTransformMatrix,
  type TransformMatrix,
} from "../transforms.js";

function rectangle(x: number, y: number, w: number, h: number) {
  const dimensions = { w: 100, h: 100 };
  return rasterFrame(dimensions, dimensions, dimensions, [
    100 / w,
    0,
    0,
    100 / h,
    (-100 * x) / w,
    (-100 * y) / h,
  ]);
}

function transformed(frame: RenderFrame, matrix: TransformMatrix) {
  return rasterFrame(
    frame.catalog,
    frame.catalog,
    frame.raster,
    composeTransformMatrices(frame.baseToRaster, invertTransformMatrix(matrix)),
  );
}

describe("structural canvas coverage", () => {
  it("detects exposed canvas but ignores support outside the final viewport", () => {
    const original = rectangle(0, 0, 10, 10);
    expect(hasUncoveredCanvas(rectangle(-1, 0, 11, 10), [original], [])).toBe(true);
    expect(hasUncoveredCanvas(rectangle(2, 2, 5, 5), [original], [])).toBe(false);
  });

  it("fills a border ring without treating its input hole as support", () => {
    const viewport = rectangle(-2, -2, 14, 14);
    const original = rectangle(0, 0, 10, 10);
    const border = { outer: viewport, input: original, restrictions: [] };
    expect(hasUncoveredCanvas(viewport, [original], [border])).toBe(false);
    expect(hasUncoveredCanvas(viewport, [], [border])).toBe(true);
    expect(hasUncoveredCanvas(rectangle(-2, 0, 2, 10), [], [border])).toBe(false);
  });

  it("clips earlier source and border support to later authored input restrictions", () => {
    const outer = rectangle(-2, -2, 14, 14);
    const original = rectangle(0, 0, 10, 10);
    const restriction = rectangle(0, -2, 12, 14);
    const border = { outer, input: original, restrictions: [restriction] };
    expect(hasUncoveredCanvas(outer, [original, restriction], [border])).toBe(true);
    expect(hasUncoveredCanvas(restriction, [original, restriction], [border])).toBe(false);
    const pieces = admissibleCanvasSupport([original, restriction], [border]);
    expect(Math.min(...pieces.flat().map((point) => point.x))).toBe(0);
    expect(Math.max(...pieces.flat().map((point) => point.x))).toBe(12);
  });

  it("unions overlapping and duplicate borders without counting their overlap as coverage", () => {
    const viewport = rectangle(0, 0, 10, 10);
    const left = { outer: viewport, input: rectangle(6, 0, 4, 10), restrictions: [] };
    const right = { outer: viewport, input: rectangle(0, 0, 4, 10), restrictions: [] };
    expect(hasUncoveredCanvas(viewport, [], [left, left])).toBe(true);
    expect(hasUncoveredCanvas(viewport, [], [left, right, left])).toBe(false);
    expect(hasUncoveredCanvas(viewport, [], [right, left])).toBe(false);
  });

  it("does not restore uncovered area at a repeated clipping vertex", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const clippedWithRepeatedCorner = [square[0]!, ...square];
    const remainder = subtractConvexPolygon(square, clippedWithRepeatedCorner);
    expect(remainder.reduce((sum, piece) => sum + Math.abs(polygonArea(piece)), 0)).toBe(0);
  });

  it("moves a border's hole with its outer frame while inherited restrictions stay fixed", () => {
    const turn: TransformMatrix = [0, 1, -1, 0, 0, 0];
    const original = rectangle(0, 0, 4, 4);
    const outer = transformed(rectangle(-2, -2, 8, 8), turn);
    const input = transformed(original, turn);
    const border = { outer, input, restrictions: [rectangle(-6, -2, 4, 8)] };
    expect(hasUncoveredCanvas(rectangle(-4, 0, 2, 4), [original], [border])).toBe(true);
    expect(hasUncoveredCanvas(rectangle(-6, 0, 2, 4), [original], [border])).toBe(false);
    expect(hasUncoveredCanvas(rectangle(0, -2, 2, 2), [original], [border])).toBe(true);
  });

  it("keeps coverage invariant under fractional rotation, reflection, scale, and translation", () => {
    const angle = 0.37;
    const matrix: TransformMatrix = [
      -3 * Math.cos(angle),
      -3 * Math.sin(angle),
      -0.7 * Math.sin(angle),
      0.7 * Math.cos(angle),
      1200.25,
      -319.125,
    ];
    const viewport = transformed(rectangle(-2, -2, 14, 14), matrix);
    const original = transformed(rectangle(0, 0, 10, 10), matrix);
    const border = { outer: viewport, input: original, restrictions: [] };
    expect(hasUncoveredCanvas(viewport, [original], [border, border])).toBe(false);
    expect(hasUncoveredCanvas(viewport, [], [border, border])).toBe(true);
  });

  it("does not give a zero-area intersection an extent", () => {
    const original = rectangle(0, 0, 10, 10);
    const touching = rectangle(10, 0, 10, 10);
    expect(admissibleCanvasSupport([original, touching], [])).toEqual([]);
    expect(hasUncoveredCanvas(original, [original, touching], [])).toBe(true);
  });

  it("detects subpixel gaps independently of raster density and base scale", () => {
    for (const size of [0.0001, 1, 1000000]) {
      const viewport = rectangle(0, 0, size, size);
      const original = rectangle(0, 0, size / 2, size);
      const gap = size * 1e-10;
      const border = {
        outer: viewport,
        input: rectangle(0, 0, size / 2 + gap, size),
        restrictions: [],
      };
      expect(hasUncoveredCanvas(viewport, [original], [border])).toBe(true);
      expect(hasUncoveredCanvas(viewport, [original], [{ ...border, input: original }])).toBe(
        false,
      );
    }
  });

  it("does not discard a real gap merely because support partitions it into small fragments", () => {
    const viewport = rectangle(0, 0, 1, 1);
    const original = rectangle(0, 0, 0.5, 1);
    const right = { outer: viewport, input: rectangle(0, 0, 0.5 + 2e-13, 1), restrictions: [] };
    const bars = Array.from({ length: 16 }, (_, index) => ({
      outer: rectangle(0, index / 16, 1, 1 / 32),
      input: rectangle(2, 2, 1, 1),
      restrictions: [],
    }));
    expect(hasUncoveredCanvas(viewport, [original], [right, ...bars])).toBe(true);
  });

  it("clips slanted support itself rather than its axis-aligned bounds", () => {
    const square = rectangle(0, 0, 10, 10);
    const dimensions = { w: 100, h: 100 };
    // Vertices (0,5), (5,0), (10,5), (5,10): area 50, not its bounding square's 100.
    const diamond = rasterFrame(dimensions, dimensions, dimensions, [10, 10, -10, 10, 50, -50]);
    const support = admissibleCanvasSupport([square, diamond], []);
    expect(support.reduce((area, piece) => area + Math.abs(polygonArea(piece)), 0)).toBe(50);
    expect(hasUncoveredCanvas(square, [square, diamond], [])).toBe(true);
    expect(
      hasUncoveredCanvas(
        square,
        [square, diamond],
        [{ outer: square, input: diamond, restrictions: [] }],
      ),
    ).toBe(false);
  });
});
