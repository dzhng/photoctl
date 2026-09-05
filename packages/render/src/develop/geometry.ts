import { transformArtifactPixels, transformPixels } from "@photoctl/img";
import type { SceneLinearImage } from "../decoder.js";
import { inspectArtifactLinearTiff } from "../linear-tiff.js";
import type { ViewSpec } from "../preview.js";
import {
  composeTransformMatrices,
  matrixForTransform,
  transformPoint,
  type TransformMatrix,
} from "../transforms.js";
import type { DevelopDict } from "./dict.js";

type Rect = { x: number; y: number; w: number; h: number };

export class DevelopRegionOutsideError extends Error {}

export function hasDevelopGeometry(parameters: DevelopDict): boolean {
  return Boolean(
    parameters.crop || parameters.aspect_ratio || parameters.rotate || parameters.straighten_deg,
  );
}

/** Applies base-space crop/aspect and quarter-turn first, then straightens the resulting frame. */
export async function applyDevelopGeometry(
  image: SceneLinearImage,
  parameters: DevelopDict,
): Promise<SceneLinearImage> {
  if (!hasDevelopGeometry(parameters)) return image;
  const plan = developGeometryPlan(image.w, image.h, parameters);
  let data = await transformPixels(
    image.data,
    image.w,
    image.h,
    3,
    plan.straightenSourceW,
    plan.straightenSourceH,
    plan.cropAndRotate,
    "lanczos3",
  );

  if (plan.straighten) {
    data = await transformPixels(
      data,
      plan.straightenSourceW,
      plan.straightenSourceH,
      3,
      plan.w,
      plan.h,
      plan.straighten,
      "lanczos3",
    );
  }

  return { ...image, w: plan.w, h: plan.h, data };
}

export async function applyDevelopArtifactGeometry(
  bytes: Buffer,
  dimensions: { w: number; h: number },
  parameters: DevelopDict,
): Promise<{ bytes: Buffer; w: number; h: number; pixelOffset: number }> {
  const plan = developGeometryPlan(dimensions.w, dimensions.h, parameters);
  let layout = await inspectArtifactLinearTiff(bytes);
  let transformed = await transformArtifactPixels(
    bytes,
    layout.pixelOffset,
    layout.pixelBytes,
    dimensions.w,
    dimensions.h,
    plan.straightenSourceW,
    plan.straightenSourceH,
    plan.cropAndRotate,
    "lanczos3",
  );
  if (plan.straighten) {
    layout = await inspectArtifactLinearTiff(Buffer.from(transformed));
    transformed = await transformArtifactPixels(
      transformed,
      layout.pixelOffset,
      layout.pixelBytes,
      plan.straightenSourceW,
      plan.straightenSourceH,
      plan.w,
      plan.h,
      plan.straighten,
      "lanczos3",
    );
  }
  const output = Buffer.from(transformed.buffer, transformed.byteOffset, transformed.byteLength);
  layout = await inspectArtifactLinearTiff(output);
  return { bytes: output, w: plan.w, h: plan.h, pixelOffset: layout.pixelOffset };
}

export function developGeometryMatrix(
  width: number,
  height: number,
  parameters: DevelopDict,
): { matrix: TransformMatrix; w: number; h: number } {
  const plan = developGeometryPlan(width, height, parameters);
  return {
    matrix: plan.straighten
      ? composeTransformMatrices(plan.straighten, plan.cropAndRotate)
      : plan.cropAndRotate,
    w: plan.w,
    h: plan.h,
  };
}

/** Scales base-space crop coordinates for a lower-resolution source of the same photo. */
export function scaleDevelopGeometry(
  parameters: DevelopDict,
  base: { w: number; h: number },
  source: { w: number; h: number },
): DevelopDict {
  if (!parameters.crop || (base.w === source.w && base.h === source.h)) return parameters;
  const scaleX = source.w / base.w;
  const scaleY = source.h / base.h;
  const x = parameters.crop.x * scaleX;
  const y = parameters.crop.y * scaleY;
  return {
    ...parameters,
    crop: {
      x,
      y,
      w: Math.min(source.w, (parameters.crop.x + parameters.crop.w) * scaleX) - x,
      h: Math.min(source.h, (parameters.crop.y + parameters.crop.h) * scaleY) - y,
    },
  };
}

function developGeometryPlan(width: number, height: number, parameters: DevelopDict) {
  const crop = constrainAspect(
    parameters.crop ?? { x: 0, y: 0, w: width, h: height },
    parameters.aspect_ratio,
  );
  assertCrop(crop, { w: width, h: height });
  const croppedWidth = Math.max(1, Math.round(crop.w));
  const croppedHeight = Math.max(1, Math.round(crop.h));
  const cropMatrix: TransformMatrix = [
    croppedWidth / crop.w,
    0,
    0,
    croppedHeight / crop.h,
    (-crop.x * croppedWidth) / crop.w,
    (-crop.y * croppedHeight) / crop.h,
  ];
  const rotation = parameters.rotate ?? 0;
  const rotatedWidth = rotation === 90 || rotation === 270 ? croppedHeight : croppedWidth;
  const rotatedHeight = rotation === 90 || rotation === 270 ? croppedWidth : croppedHeight;
  const cropAndRotate = composeTransformMatrices(
    quarterTurnMatrix(rotation, croppedWidth, croppedHeight),
    cropMatrix,
  );
  const straighten = parameters.straighten_deg ?? 0;
  const straightened = inscribedDimensions(rotatedWidth, rotatedHeight, straighten);
  return {
    cropAndRotate,
    straighten:
      straighten === 0
        ? null
        : matrixForTransform({
            dx: (straightened.w - rotatedWidth) / 2,
            dy: (straightened.h - rotatedHeight) / 2,
            scale: 1,
            rotate: straighten,
            flip: null,
            anchor: { x: rotatedWidth / 2, y: rotatedHeight / 2 },
          }),
    w: straightened.w,
    h: straightened.h,
    straightenSourceW: rotatedWidth,
    straightenSourceH: rotatedHeight,
  };
}

function inscribedDimensions(width: number, height: number, degrees: number) {
  if (degrees === 0) return { w: width, h: height };
  const radians = (Math.abs(degrees) * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  let w: number;
  let h: number;
  if (short <= 2 * sine * cosine * long || Math.abs(cosine - sine) < 1e-12) {
    const side = 0.5 * short;
    const widthIfLong = side / sine;
    const heightIfShort = side / cosine;
    [w, h] = width >= height ? [widthIfLong, heightIfShort] : [heightIfShort, widthIfLong];
  } else {
    const cosineSquaredMinusSineSquared = cosine * cosine - sine * sine;
    w = (width * cosine - height * sine) / cosineSquaredMinusSineSquared;
    h = (height * cosine - width * sine) / cosineSquaredMinusSineSquared;
  }
  return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
}

export function invertDevelopGeometryMatrix(matrix: TransformMatrix): TransformMatrix {
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error("Develop geometry must have a finite inverse");
  }
  return [
    cleanFloat(matrix[3] / determinant),
    cleanFloat(-matrix[1] / determinant),
    cleanFloat(-matrix[2] / determinant),
    cleanFloat(matrix[0] / determinant),
    cleanFloat((matrix[2] * matrix[5] - matrix[3] * matrix[4]) / determinant),
    cleanFloat((matrix[1] * matrix[4] - matrix[0] * matrix[5]) / determinant),
  ];
}

export function projectDevelopView(
  view: ViewSpec,
  geometry: ReturnType<typeof developGeometryMatrix>,
): { view: ViewSpec } {
  if (!view.region) {
    return { view };
  }
  const outputPolygon = rectanglePoints(...view.region).map((point) =>
    transformPoint(geometry.matrix, point),
  );
  const clipped = clipPolygonToRectangle(outputPolygon, geometry.w, geometry.h);
  if (clipped.length === 0) {
    throw new DevelopRegionOutsideError("Region does not intersect developed pixels");
  }
  const outputRegion = bounds(clipped);
  if (outputRegion[2] === 0 || outputRegion[3] === 0) {
    throw new DevelopRegionOutsideError("Region does not intersect developed pixels");
  }
  return { view: { ...view, region: outputRegion } };
}

export function developPreviewProjection(
  region: [number, number, number, number],
  width: number,
  height: number,
  baseToOutput: TransformMatrix,
) {
  const [x, y, w, h] = region;
  const outputToView: TransformMatrix = [
    width / w,
    0,
    0,
    height / h,
    (-x * width) / w,
    (-y * height) / h,
  ];
  const baseToView = composeTransformMatrices(outputToView, baseToOutput);
  const viewToBase = invertDevelopGeometryMatrix(baseToView);
  const outputToBase = invertDevelopGeometryMatrix(baseToOutput);
  const polygon = rectanglePoints(x, y, w, h).map((point) => transformPoint(outputToBase, point));
  return {
    base_to_view: affineObject(baseToView),
    view_to_base: affineObject(viewToBase),
    visible_base_polygon: polygon.map(({ x: pointX, y: pointY }) => [pointX, pointY]) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ],
  };
}

export function developBaseRegion(
  outputRegion: [number, number, number, number],
  baseToOutput: TransformMatrix,
): [number, number, number, number] {
  const outputToBase = invertDevelopGeometryMatrix(baseToOutput);
  return bounds(
    rectanglePoints(...outputRegion).map((point) => transformPoint(outputToBase, point)),
  );
}

function rectanglePoints(x: number, y: number, w: number, h: number) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function bounds(points: { x: number; y: number }[]): [number, number, number, number] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}

function clipPolygonToRectangle(points: { x: number; y: number }[], width: number, height: number) {
  let clipped = points;
  clipped = clipEdge(
    clipped,
    (point) => point.x >= 0,
    (a, b) => intersectX(a, b, 0),
  );
  clipped = clipEdge(
    clipped,
    (point) => point.x <= width,
    (a, b) => intersectX(a, b, width),
  );
  clipped = clipEdge(
    clipped,
    (point) => point.y >= 0,
    (a, b) => intersectY(a, b, 0),
  );
  return clipEdge(
    clipped,
    (point) => point.y <= height,
    (a, b) => intersectY(a, b, height),
  );
}

function clipEdge(
  points: { x: number; y: number }[],
  inside: (point: { x: number; y: number }) => boolean,
  intersection: (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ) => {
    x: number;
    y: number;
  },
) {
  const output: { x: number; y: number }[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const previous = points[(index + points.length - 1) % points.length]!;
    if (inside(current)) {
      if (!inside(previous)) output.push(intersection(previous, current));
      output.push(current);
    } else if (inside(previous)) {
      output.push(intersection(previous, current));
    }
  }
  return output;
}

function intersectX(a: { x: number; y: number }, b: { x: number; y: number }, x: number) {
  const ratio = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + (b.y - a.y) * ratio };
}

function intersectY(a: { x: number; y: number }, b: { x: number; y: number }, y: number) {
  const ratio = (y - a.y) / (b.y - a.y);
  return { x: a.x + (b.x - a.x) * ratio, y };
}

function affineObject(matrix: TransformMatrix) {
  return { a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] };
}

function cleanFloat(value: number): number {
  const integer = Math.round(value);
  return Math.abs(value - integer) < 1e-12 ? integer : value;
}

function constrainAspect(rect: Rect, aspect: string | undefined): Rect {
  if (!aspect) return rect;
  const [wide, high] = aspect.split(":").map(Number) as [number, number];
  const target = wide / high;
  if (rect.w / rect.h > target) {
    const w = rect.h * target;
    return { ...rect, x: rect.x + (rect.w - w) / 2, w };
  }
  const h = rect.w / target;
  return { ...rect, y: rect.y + (rect.h - h) / 2, h };
}

function assertCrop(rect: Rect, image: { w: number; h: number }): void {
  if (
    ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w <= 0 ||
    rect.h <= 0 ||
    rect.x + rect.w > image.w ||
    rect.y + rect.h > image.h
  ) {
    throw new Error("Develop crop must be inside the oriented base image");
  }
}

function quarterTurnMatrix(
  rotation: 0 | 90 | 180 | 270,
  width: number,
  height: number,
): TransformMatrix {
  switch (rotation) {
    case 0:
      return [1, 0, 0, 1, 0, 0];
    case 90:
      return [0, 1, -1, 0, height, 0];
    case 180:
      return [-1, 0, 0, -1, width, height];
    case 270:
      return [0, -1, 1, 0, 0, width];
  }
}
