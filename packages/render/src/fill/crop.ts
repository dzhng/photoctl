import type { MaskImage } from "../mask-tiff.js";

export interface FillCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Plans the provider frame in oriented base pixels; rounding never leaves the source frame. */
export function planFillCrop(mask: MaskImage, pad = 64): FillCrop {
  if (!Number.isSafeInteger(pad) || pad < 0)
    throw new Error("Fill pad must be a non-negative integer");
  let xmin = mask.w;
  let ymin = mask.h;
  let xmax = -1;
  let ymax = -1;
  for (let index = 0; index < mask.data.length; index += 1) {
    if (mask.data[index]! <= 0) continue;
    const x = index % mask.w;
    const y = Math.floor(index / mask.w);
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }
  if (xmax < xmin || ymax < ymin) throw new Error("Fill mask is empty");
  const x = Math.max(0, Math.floor((xmin - pad) / 16) * 16);
  const y = Math.max(0, Math.floor((ymin - pad) / 16) * 16);
  const right = Math.min(mask.w, Math.ceil((xmax + 1 + pad) / 16) * 16);
  const bottom = Math.min(mask.h, Math.ceil((ymax + 1 + pad) / 16) * 16);
  return { x, y, w: right - x, h: bottom - y };
}
