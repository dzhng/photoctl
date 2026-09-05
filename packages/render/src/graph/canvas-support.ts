import {
  intersectConvexPolygons,
  polygonArea,
  subtractConvexPolygon,
} from "../develop/geometry.js";
import { transformPoint, type TransformPoint } from "../transforms.js";
import type { RenderFrame } from "./frame.js";

export interface CanvasBorderSupport {
  outer: RenderFrame;
  input: RenderFrame;
  restrictions: readonly RenderFrame[];
}

function framePolygon(frame: RenderFrame): TransformPoint[] {
  return frame.visibleBasePolygon.map(([x, y]) => ({ x, y }));
}

/** Convex support pieces in shared base coordinates; pieces from different layers may overlap. */
export function admissibleCanvasSupport(
  originalSupport: readonly RenderFrame[],
  borders: readonly CanvasBorderSupport[],
): TransformPoint[][] {
  return supportPolygons(originalSupport, borders, framePolygon);
}

function supportPolygons(
  originalSupport: readonly RenderFrame[],
  borders: readonly CanvasBorderSupport[],
  polygon: (frame: RenderFrame) => TransformPoint[],
): TransformPoint[][] {
  const support: TransformPoint[][] = [];
  if (originalSupport.length) {
    let original = polygon(originalSupport[0]!);
    for (const restriction of originalSupport.slice(1)) {
      original = intersectConvexPolygons(original, polygon(restriction));
    }
    support.push(original);
  }
  for (const border of borders) {
    let outer = polygon(border.outer);
    for (const restriction of border.restrictions) {
      outer = intersectConvexPolygons(outer, polygon(restriction));
    }
    support.push(...subtractConvexPolygon(outer, polygon(border.input)));
  }
  return support.filter((piece) => polygonArea(piece) !== 0);
}

/** Structural support, independent of layer opacity or rendered pixel values. */
export function hasUncoveredCanvas(
  viewport: RenderFrame,
  originalSupport: readonly RenderFrame[],
  borders: readonly CanvasBorderSupport[],
): boolean {
  const normalizedPolygon = (frame: RenderFrame) =>
    framePolygon(frame).map((point) => {
      const raster = transformPoint(viewport.baseToRaster, point);
      return { x: raster.x / viewport.raster.w, y: raster.y / viewport.raster.h };
    });
  const normalizedViewport = normalizedPolygon(viewport);
  let uncovered = [normalizedViewport];
  for (const support of supportPolygons(originalSupport, borders, normalizedPolygon)) {
    if (!uncovered.length) break;
    const clipped = intersectConvexPolygons(support, normalizedViewport);
    uncovered = uncovered.flatMap((piece) => subtractConvexPolygon(piece, clipped));
  }
  // Ignore only roundoff-scale slivers in viewport-relative area, not pixel-sized gaps.
  return (
    uncovered.reduce((area, piece) => area + Math.abs(polygonArea(piece)), 0) > 64 * Number.EPSILON
  );
}
