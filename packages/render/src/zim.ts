import {
  clipMaskToFrame,
  resamplePixels,
  resampleRgb8Antialiased,
  transformPixels,
} from "@photoctl/img";
import type { Dimensions, Point } from "./coordinates.js";
import type { MaskImage } from "./mask-tiff.js";
import { invertTransformMatrix, type TransformMatrix } from "./transforms.js";
import { displaySrgbToBytes } from "./color.js";

const INPUT_SIZE = 1024;
const CHANNEL_MEAN = [123.675, 116.28, 103.53].map(Math.fround);
const CHANNEL_STD = [58.395, 57.12, 57.375].map(Math.fround);

export interface ZimMapping {
  source: Dimensions;
  resized: Dimensions;
  toModel(point: Point): Point;
  toBase(point: Point): Point;
}

export function zimMapping(source: Dimensions): ZimMapping {
  if (
    !Number.isSafeInteger(source.w) ||
    !Number.isSafeInteger(source.h) ||
    source.w < 1 ||
    source.h < 1
  ) {
    throw new Error("Segment source dimensions must be positive integers");
  }
  const scale = INPUT_SIZE / Math.max(source.w, source.h);
  const resized = {
    w: Math.max(1, Math.round(source.w * scale)),
    h: Math.max(1, Math.round(source.h * scale)),
  };
  const scaleX = resized.w / source.w;
  const scaleY = resized.h / source.h;
  return {
    source: { w: source.w, h: source.h },
    resized,
    toModel: ([x, y]) => [x * scaleX, y * scaleY],
    toBase: ([x, y]) => [x / scaleX, y / scaleY],
  };
}

export function prepareZimEncoderInput(
  data: Float32Array,
  source: Dimensions,
): { data: Float32Array; mapping: ZimMapping } {
  const mapping = zimMapping(source);
  if (data.length !== source.w * source.h * 3 || data.some((value) => !Number.isFinite(value))) {
    throw new Error("Segment encoder input must contain finite RGB samples");
  }
  const bytes = displaySrgbToBytes(data);
  const resized = resampleRgb8Antialiased(
    bytes,
    source.w,
    source.h,
    mapping.resized.w,
    mapping.resized.h,
  );
  const channelSize = INPUT_SIZE * INPUT_SIZE;
  const output = new Float32Array(channelSize * 3);
  for (let y = 0; y < mapping.resized.h; y += 1) {
    for (let x = 0; x < mapping.resized.w; x += 1) {
      const sourceOffset = (y * mapping.resized.w + x) * 3;
      const outputOffset = y * INPUT_SIZE + x;
      for (let channel = 0; channel < 3; channel += 1) {
        output[channel * channelSize + outputOffset] =
          Math.fround(resized[sourceOffset + channel]! - CHANNEL_MEAN[channel]!) /
          CHANNEL_STD[channel]!;
      }
    }
  }
  return { data: output, mapping };
}

export async function restoreZimMask(
  logits: Float32Array,
  dimensions: Dimensions,
  mapping: ZimMapping,
  projection?: { dimensions: Dimensions; baseToImage: TransformMatrix },
): Promise<MaskImage> {
  const full = await resamplePixels(
    logits,
    dimensions.w,
    dimensions.h,
    1,
    INPUT_SIZE,
    INPUT_SIZE,
    "bilinear",
  );
  const { resized, source } = mapping;
  const cropped = new Float32Array(resized.w * resized.h);
  for (let y = 0; y < resized.h; y += 1) {
    cropped.set(full.subarray(y * INPUT_SIZE, y * INPUT_SIZE + resized.w), y * resized.w);
  }
  const data = await resamplePixels(
    cropped,
    resized.w,
    resized.h,
    1,
    source.w,
    source.h,
    "bilinear",
  );
  for (let index = 0; index < data.length; index += 1)
    data[index] = 1 / (1 + Math.exp(-data[index]!));
  if (projection) {
    const { dimensions: base, baseToImage } = projection;
    const projected = await transformPixels(
      data,
      source.w,
      source.h,
      1,
      base.w,
      base.h,
      invertTransformMatrix(baseToImage),
      "bilinear",
    );
    return {
      ...base,
      data: clipMaskToFrame(projected, base.w, base.h, baseToImage, source.w, source.h),
    };
  }
  return { w: source.w, h: source.h, data };
}
