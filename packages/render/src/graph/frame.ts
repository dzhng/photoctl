import type { DevelopDict } from "../develop/dict.js";
import { developDictSchema } from "../develop/dict.js";
import type { JsonValue } from "./types.js";
import { z } from "zod";
import { PhotoctlError } from "@photoctl/protocol";
import {
  developGeometryMatrix,
  developGeometryPlan,
  developPreviewProjection,
  scaleDevelopGeometry,
} from "../develop/geometry.js";
import {
  composeTransformMatrices,
  invertTransformMatrix,
  transformPoint,
  type TransformPoint,
  type TransformMatrix,
} from "../transforms.js";

type Dimensions = { w: number; h: number };
/** New raster growth is bounded independently of provider limits; source-sized edits remain valid. */
export function assertNewRasterSize(raster: Dimensions, catalog: Dimensions): void {
  const edge = Math.max(16_384, catalog.w, catalog.h);
  const pixels = Math.max(64_000_000, catalog.w * catalog.h);
  if (
    ![raster.w, raster.h].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= edge,
    ) ||
    raster.w > Math.floor(pixels / raster.h)
  ) {
    throw new PhotoctlError("usage", "Requested raster exceeds render growth limits");
  }
}
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

export function savedRenderFrame(frame: RenderFrame): z.infer<typeof savedFrameSchema> {
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
  if (
    (kind === "composite" || kind === "transform") &&
    parameters &&
    typeof parameters === "object" &&
    !Array.isArray(parameters) &&
    "frame" in parameters
  ) {
    const authored = parseRenderFrame(parameters.frame);
    if (
      kind === "transform" &&
      input &&
      (input.raster.w !== authored.raster.w || input.raster.h !== authored.raster.h)
    ) {
      throw new Error("Placement frame must preserve its input intrinsic raster dimensions");
    }
    const source = input?.source ?? authored.source;
    return rasterFrame(
      catalog,
      source,
      authored.raster,
      composeTransformMatrices(authored.baseToRaster, [
        catalog.w / source.w,
        0,
        0,
        catalog.h / source.h,
        0,
        0,
      ]),
    );
  }
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

/** Move an intrinsic raster in original coordinates without clipping or resampling its pixels. */
export function placedFrame(frame: RenderFrame, matrix: TransformMatrix): RenderFrame {
  return rasterFrame(
    frame.catalog,
    frame.catalog,
    frame.raster,
    composeTransformMatrices(frame.baseToRaster, invertTransformMatrix(matrix)),
  );
}

/** Integer containing viewport in the authored raster axes, with outward boundary rounding. */
export function containingFrame(
  reference: RenderFrame,
  points: readonly TransformPoint[],
): RenderFrame {
  const raster = points.map((point) => transformPoint(reference.baseToRaster, point));
  const snap = (value: number) => {
    const nearest = Math.round(value);
    return Math.abs(value - nearest) <=
      32 * Number.EPSILON * Math.max(reference.raster.w, reference.raster.h, Math.abs(value))
      ? nearest
      : value;
  };
  const x = Math.floor(snap(Math.min(...raster.map((point) => point.x))));
  const y = Math.floor(snap(Math.min(...raster.map((point) => point.y))));
  const right = Math.ceil(snap(Math.max(...raster.map((point) => point.x))));
  const bottom = Math.ceil(snap(Math.max(...raster.map((point) => point.y))));
  assertNewRasterSize({ w: right - x, h: bottom - y }, reference.catalog);
  return rasterFrame(
    reference.catalog,
    reference.source,
    { w: right - x, h: bottom - y },
    composeTransformMatrices([1, 0, 0, 1, -x, -y], reference.sourceToRaster),
  );
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

/** The same ordered crop/quarter-turn and straighten stages used by the pixel operator. */
export function developFrames(
  catalog: Dimensions,
  source: Dimensions,
  develop: DevelopDict,
): RenderFrame[] {
  const plan = developGeometryPlan(
    source.w,
    source.h,
    scaleDevelopGeometry(develop, catalog, source),
  );
  const stages = [
    rasterFrame(
      catalog,
      source,
      { w: plan.straightenSourceW, h: plan.straightenSourceH },
      plan.cropAndRotate,
    ),
  ];
  if (plan.straighten)
    stages.push(
      rasterFrame(
        catalog,
        source,
        plan,
        composeTransformMatrices(plan.straighten, plan.cropAndRotate),
      ),
    );
  return stages;
}

/** Replace the tail from the stable authored frame; never rerun its consumed source crop/straighten. */
export function canvasGeometryPlan(
  authoredFrame: RenderFrame,
  authored: Pick<DevelopDict, "rotate" | "straighten_deg">,
  current: Pick<DevelopDict, "rotate" | "straighten_deg">,
  aspectRatio?: DevelopDict["aspect_ratio"],
) {
  const degrees =
    (current.rotate ?? 0) +
    (current.straighten_deg ?? 0) -
    (authored.rotate ?? 0) -
    (authored.straighten_deg ?? 0);
  const turns = Math.round(degrees / 90);
  const rotate = ((((turns % 4) + 4) % 4) * 90) as 0 | 90 | 180 | 270;
  const geometry = developGeometryPlan(authoredFrame.raster.w, authoredFrame.raster.h, {
    aspect_ratio:
      aspectRatio && (authored.rotate === 90 || authored.rotate === 270)
        ? aspectRatio.split(":").toReversed().join(":")
        : aspectRatio,
    rotate,
    straighten_deg: degrees - turns * 90,
  });
  const stages = [
    rasterFrame(
      authoredFrame.catalog,
      authoredFrame.source,
      { w: geometry.straightenSourceW, h: geometry.straightenSourceH },
      composeTransformMatrices(geometry.cropAndRotate, authoredFrame.sourceToRaster),
    ),
  ];
  if (geometry.straighten)
    stages.push(
      rasterFrame(
        authoredFrame.catalog,
        authoredFrame.source,
        geometry,
        composeTransformMatrices(geometry.straighten, stages[0]!.sourceToRaster),
      ),
    );
  return { frame: stages.at(-1)!, stages };
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
