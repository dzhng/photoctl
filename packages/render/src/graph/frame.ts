import type { DevelopDict } from "../develop/dict.js";
import { developDictSchema } from "../develop/dict.js";
import type { JsonValue } from "./types.js";
import { z } from "zod";
import {
  developGeometryMatrix,
  developPreviewProjection,
  scaleDevelopGeometry,
} from "../develop/geometry.js";
import {
  composeTransformMatrices,
  invertTransformMatrix,
  type TransformMatrix,
} from "../transforms.js";

type Dimensions = { w: number; h: number };
const dimensions = z.object({ w: z.number().int().positive(), h: z.number().int().positive() });
export const savedFrameSchema = z.object({
  catalog: dimensions,
  source: dimensions,
  raster: dimensions,
  sourceToRaster: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
});

export function parseRenderFrame(value: unknown): RenderFrame {
  const saved = savedFrameSchema.parse(value);
  return rasterFrame(saved.catalog, saved.source, saved.raster, saved.sourceToRaster);
}

export function savedRenderFrame(frame: RenderFrame) {
  return {
    catalog: frame.catalog,
    source: frame.source,
    raster: frame.raster,
    sourceToRaster: [...frame.sourceToRaster],
  };
}

export function frameForNode(
  kind: string,
  parameters: JsonValue,
  catalog: Dimensions,
  raster: Dimensions,
  input?: RenderFrame,
): RenderFrame {
  if (!input || ["source", "resample", "solid", "generate", "upscale"].includes(kind))
    return developFrame(catalog, raster);
  if (kind === "develop") {
    const stage = developFrame(catalog, input.raster, developDictSchema.parse(parameters));
    return rasterFrame(
      catalog,
      input.source,
      stage.raster,
      composeTransformMatrices(stage.sourceToRaster, input.sourceToRaster),
    );
  }
  return input;
}

/** A raster's boundary coordinates and the original source tier that produced it. */
export interface RenderFrame {
  catalog: Dimensions;
  source: Dimensions;
  raster: Dimensions;
  sourceToRaster: TransformMatrix;
  baseToRaster: TransformMatrix;
  rasterToBase: TransformMatrix;
  visibleBasePolygon: ReturnType<typeof developPreviewProjection>["visible_base_polygon"];
}

export function developFrame(
  catalog: Dimensions,
  source: Dimensions,
  develop: DevelopDict = {},
): RenderFrame {
  const geometry = developGeometryMatrix(
    source.w,
    source.h,
    scaleDevelopGeometry(develop, catalog, source),
  );
  return rasterFrame(catalog, source, geometry, geometry.matrix);
}

export function rasterFrame(
  catalog: Dimensions,
  source: Dimensions,
  raster: Dimensions,
  sourceToRaster: TransformMatrix,
): RenderFrame {
  const baseToRaster = composeTransformMatrices(sourceToRaster, [
    source.w / catalog.w,
    0,
    0,
    source.h / catalog.h,
    0,
    0,
  ]);
  return {
    catalog: { w: catalog.w, h: catalog.h },
    source: { w: source.w, h: source.h },
    raster: { w: raster.w, h: raster.h },
    sourceToRaster,
    baseToRaster,
    rasterToBase: invertTransformMatrix(baseToRaster),
    visibleBasePolygon: developPreviewProjection(
      [0, 0, raster.w, raster.h],
      raster.w,
      raster.h,
      baseToRaster,
    ).visible_base_polygon,
  };
}

/** A view is an integer extraction followed by delivery downscale, not another develop operation. */
export function viewFrame(
  frame: RenderFrame,
  region: [number, number, number, number],
  raster: Dimensions,
): RenderFrame {
  const [x, y, w, h] = region;
  return rasterFrame(
    frame.catalog,
    frame.source,
    raster,
    composeTransformMatrices(
      [raster.w / w, 0, 0, raster.h / h, (-x * raster.w) / w, (-y * raster.h) / h],
      frame.sourceToRaster,
    ),
  );
}
