import {
  drawMarkupPixels,
  drawMarkupOverlay,
  overlayMaskedPixels,
  transformMaskPixels,
  transformPixels,
} from "@photoctl/img";
import type { MarkupDocument } from "@photoctl/protocol";
import type { TransformMatrix } from "../transforms.js";

export async function drawMarkup(
  image: { w: number; h: number; data: Float32Array },
  document: MarkupDocument,
  projection: { baseW: number; baseH: number; matrix: TransformMatrix },
) {
  const identity =
    projection.baseW === image.w &&
    projection.baseH === image.h &&
    projection.matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index]);
  if (identity) {
    return {
      ...image,
      data: await drawMarkupPixels(image.data, image.w, image.h, JSON.stringify(document)),
    };
  }

  // Transform premultiplied color and coverage independently so antialiasing
  // remains correct through crop, quarter-turn, and straighten geometry.
  const overlay = await drawMarkupOverlay(
    projection.baseW,
    projection.baseH,
    JSON.stringify(document),
  );
  const [projectedPremultiplied, projectedAlpha] = await Promise.all([
    transformPixels(
      overlay.color,
      projection.baseW,
      projection.baseH,
      3,
      image.w,
      image.h,
      projection.matrix,
      "lanczos3",
    ),
    transformMaskPixels(
      overlay.mask,
      projection.baseW,
      projection.baseH,
      image.w,
      image.h,
      projection.matrix,
    ),
  ]);
  const color = new Float32Array(projectedPremultiplied.length);
  for (let pixel = 0; pixel < projectedAlpha.length; pixel += 1) {
    const coverage = projectedAlpha[pixel]!;
    if (coverage <= 1e-8) continue;
    const offset = pixel * 3;
    color[offset] = projectedPremultiplied[offset]! / coverage;
    color[offset + 1] = projectedPremultiplied[offset + 1]! / coverage;
    color[offset + 2] = projectedPremultiplied[offset + 2]! / coverage;
  }
  return {
    ...image,
    data: await overlayMaskedPixels(image.data, color, projectedAlpha, image.w, image.h, 1),
  };
}

/** Maps catalog/base-space markup onto the actual source tier being evaluated. */
export function scaleMarkupDocument(
  document: MarkupDocument,
  base: { w: number; h: number },
  source: { w: number; h: number },
): MarkupDocument {
  if (base.w === source.w && base.h === source.h) return document;
  const scaleX = source.w / base.w;
  const scaleY = source.h / base.h;
  // Source tiers preserve aspect ratio; the geometric mean keeps strokes isotropic
  // if integer rounding makes the two dimension ratios differ slightly.
  const scaleSize = Math.sqrt(scaleX * scaleY);
  const point = ([x, y]: [number, number]) => [x * scaleX, y * scaleY] as [number, number];
  const bbox = ([x, y, w, h]: [number, number, number, number]) =>
    [x * scaleX, y * scaleY, w * scaleX, h * scaleY] as [number, number, number, number];
  return document.map((item) => {
    switch (item.type) {
      case "text":
        return { ...item, at: point(item.at), size_px: item.size_px * scaleSize };
      case "arrow":
      case "line":
        return {
          ...item,
          from: point(item.from),
          to: point(item.to),
          width: item.width * scaleSize,
        };
      case "rect":
      case "ellipse":
        return { ...item, bbox: bbox(item.bbox), width: item.width * scaleSize };
      case "path":
        return {
          ...item,
          points: item.points.map(point),
          width: item.width * scaleSize,
        };
      case "highlight":
        return { ...item, bbox: bbox(item.bbox) };
    }
  });
}
