import { applyDevelop } from "./develop/pixels.js";
import { scaleDevelopGeometry, withoutDevelopGeometry } from "./develop/geometry.js";
import { developFrame, parseRenderFrame, realizeCanvasFrame } from "./graph/frame.js";
import { projectSupportedRgbToRender } from "./graph/projection.js";
import type { readCanvasPlan } from "./graph/output.js";
import type { DevelopDict } from "./develop/dict.js";
import { linearRec2020ToDisplaySrgb } from "./color.js";
import type { SceneLinearImage } from "./decoder.js";
import { transformPoint } from "./transforms.js";
import { resampleDisplaySrgb8 } from "@photoctl/img";

/** Keep grounding delivery bounded without introducing a second pixel resampler. */
export function segmentationGroundingPixels(image: { w: number; h: number; data: Float32Array }) {
  const scale = Math.min(1, 1024 / Math.max(image.w, image.h));
  const w = Math.max(1, Math.round(image.w * scale));
  const h = Math.max(1, Math.round(image.h * scale));
  // The borrowed U8 boundary avoids resamplePixels' full-resolution native float snapshot.
  const pixels = Uint8Array.from(image.data, (value) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255),
  );
  return {
    w,
    h,
    data: scale === 1 ? pixels : resampleDisplaySrgb8(pixels, image.w, image.h, w, h),
  };
}

/** Segmentation sees current develop pixels; returned masks use uncropped base space. */
export async function prepareSegmentationFrame(
  source: SceneLinearImage,
  develop: DevelopDict,
  base: { w: number; h: number },
  canvas?: Awaited<ReturnType<typeof readCanvasPlan>>,
) {
  const sourceFrame = developFrame(base, source);
  const realize = (frame: ReturnType<typeof developFrame>) =>
    realizeCanvasFrame(frame, sourceFrame, []);
  const parameters = canvas
    ? withoutDevelopGeometry(develop)
    : scaleDevelopGeometry(develop, base, source);
  const graded = await applyDevelop(source, parameters);
  const developed = canvas
    ? await projectSupportedRgbToRender(
        graded,
        sourceFrame,
        [...canvas.base_stages, ...canvas.viewport_stages].map(parseRenderFrame),
        parseRenderFrame(canvas.frame),
        realize,
      )
    : graded;
  const matrix = (
    canvas ? realize(parseRenderFrame(canvas.frame)) : developFrame(base, source, develop)
  ).baseToRaster;
  const image = {
    w: developed.w,
    h: developed.h,
    data: await linearRec2020ToDisplaySrgb(developed.data),
  };
  const point = ([x, y]: [number, number]): [number, number] => {
    const mapped = transformPoint(matrix, { x, y });
    return [mapped.x, mapped.y];
  };
  return {
    image,
    matrix,
    point,
    box: ([x, y, w, h]: [number, number, number, number]): [number, number, number, number] => {
      const corners = [point([x, y]), point([x + w, y]), point([x, y + h]), point([x + w, y + h])];
      const left = Math.min(...corners.map(([px]) => px));
      const top = Math.min(...corners.map(([, py]) => py));
      return [
        left,
        top,
        Math.max(...corners.map(([px]) => px)) - left,
        Math.max(...corners.map(([, py]) => py)) - top,
      ];
    },
  };
}
