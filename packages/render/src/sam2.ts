import type { Dimensions, Point } from "./coordinates.js";

const SAM2_INPUT_SIZE = 1024;

export interface Sam2Letterbox {
  source: Dimensions;
  model: Dimensions;
  resized: Dimensions;
  scale: number;
  offset: { x: number; y: number };
  toModel(point: Point): Point;
  toBase(point: Point): Point;
}

export function sam2Letterbox(source: Dimensions): Sam2Letterbox {
  if (
    !Number.isSafeInteger(source.w) ||
    !Number.isSafeInteger(source.h) ||
    source.w <= 0 ||
    source.h <= 0
  ) {
    throw new Error("SAM source dimensions must be positive integers");
  }
  const scale = Math.min(SAM2_INPUT_SIZE / source.w, SAM2_INPUT_SIZE / source.h);
  const resized = {
    w: Math.max(1, Math.round(source.w * scale)),
    h: Math.max(1, Math.round(source.h * scale)),
  };
  const offset = {
    x: Math.floor((SAM2_INPUT_SIZE - resized.w) / 2),
    y: Math.floor((SAM2_INPUT_SIZE - resized.h) / 2),
  };
  return {
    source: { ...source },
    model: { w: SAM2_INPUT_SIZE, h: SAM2_INPUT_SIZE },
    resized,
    scale,
    offset,
    toModel: ([x, y]) => [x * scale + offset.x, y * scale + offset.y],
    toBase: ([x, y]) => [(x - offset.x) / scale, (y - offset.y) / scale],
  };
}

type Resample = (
  data: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
  outputWidth: number,
  outputHeight: number,
  filter: "bilinear",
) => Promise<Float32Array>;

export async function prepareSam2EncoderInput(
  data: Float32Array,
  source: Dimensions,
  resample: Resample,
): Promise<{ data: Float32Array; mapping: Sam2Letterbox }> {
  if (data.length !== source.w * source.h * 3) {
    throw new Error("SAM encoder input must contain three samples per source pixel");
  }
  const mapping = sam2Letterbox(source);
  const resized = await resample(
    data,
    source.w,
    source.h,
    3,
    mapping.resized.w,
    mapping.resized.h,
    "bilinear",
  );
  const output = new Float32Array(SAM2_INPUT_SIZE * SAM2_INPUT_SIZE * 3);
  for (let y = 0; y < mapping.resized.h; y += 1) {
    const sourceOffset = y * mapping.resized.w * 3;
    const outputOffset = ((y + mapping.offset.y) * SAM2_INPUT_SIZE + mapping.offset.x) * 3;
    output.set(resized.subarray(sourceOffset, sourceOffset + mapping.resized.w * 3), outputOffset);
  }
  return { data: output, mapping };
}
