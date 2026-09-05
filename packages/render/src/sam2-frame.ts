import { applyDevelop } from "./develop/pixels.js";
import { developGeometryMatrix, scaleDevelopGeometry } from "./develop/geometry.js";
import type { DevelopDict } from "./develop/dict.js";
import { linearRec2020ToDisplaySrgb } from "./color.js";
import type { SceneLinearImage } from "./decoder.js";
import { composeTransformMatrices, transformPoint } from "./transforms.js";

/** SAM sees current develop pixels; every returned mask is projected back to uncropped base space. */
export async function prepareSam2Frame(
  source: SceneLinearImage,
  develop: DevelopDict,
  base: { w: number; h: number },
) {
  const parameters = scaleDevelopGeometry(develop, base, source);
  const geometry = developGeometryMatrix(source.w, source.h, parameters);
  const matrix = composeTransformMatrices(geometry.matrix, [
    source.w / base.w,
    0,
    0,
    source.h / base.h,
    0,
    0,
  ]);
  const developed = await applyDevelop(source, parameters);
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
