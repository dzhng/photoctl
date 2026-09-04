import { describe, expect, test } from "vitest";
import {
  fromBase,
  fromBaseBbox,
  orientedDimensions,
  toBase,
  toBaseBbox,
  type Bbox,
  type ExifOrientation,
  type Point,
} from "./index.js";

const source = { w: 3, h: 2 };

const cases: Array<{
  orientation: ExifOrientation;
  point: Point;
  bbox: Bbox;
  dimensions: { w: number; h: number };
}> = [
  { orientation: 1, point: [1, 0.5], bbox: [0.25, 0.25, 1, 0.5], dimensions: { w: 3, h: 2 } },
  { orientation: 2, point: [2, 0.5], bbox: [1.75, 0.25, 1, 0.5], dimensions: { w: 3, h: 2 } },
  { orientation: 3, point: [2, 1.5], bbox: [1.75, 1.25, 1, 0.5], dimensions: { w: 3, h: 2 } },
  { orientation: 4, point: [1, 1.5], bbox: [0.25, 1.25, 1, 0.5], dimensions: { w: 3, h: 2 } },
  { orientation: 5, point: [0.5, 1], bbox: [0.25, 0.25, 0.5, 1], dimensions: { w: 2, h: 3 } },
  { orientation: 6, point: [1.5, 1], bbox: [1.25, 0.25, 0.5, 1], dimensions: { w: 2, h: 3 } },
  { orientation: 7, point: [1.5, 2], bbox: [1.25, 1.75, 0.5, 1], dimensions: { w: 2, h: 3 } },
  { orientation: 8, point: [0.5, 2], bbox: [0.25, 1.75, 0.5, 1], dimensions: { w: 2, h: 3 } },
];

describe.each(cases)("EXIF orientation $orientation", (example) => {
  test("maps points and oriented dimensions into the base coordinate space", () => {
    expect(toBase([1, 0.5], source, example.orientation)).toEqual(example.point);
    expect(orientedDimensions(source, example.orientation)).toEqual(example.dimensions);
  });

  test("maps bounding boxes by their edges", () => {
    expect(toBaseBbox([0.25, 0.25, 1, 0.5], source, example.orientation)).toEqual(example.bbox);
  });

  test("round-trips points and bounding boxes", () => {
    expect(fromBase(example.point, source, example.orientation)).toEqual([1, 0.5]);
    expect(fromBaseBbox(example.bbox, source, example.orientation)).toEqual([0.25, 0.25, 1, 0.5]);
  });
});
