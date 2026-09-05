import {
  applyDevelopPixels,
  applyDevelopArtifact as applyDevelopArtifactNative,
  type NativeDevelopParameters,
} from "@photoctl/img";
import type { SceneLinearImage } from "../decoder.js";
import { inspectArtifactLinearTiff } from "../linear-tiff.js";
import { developDictSchema, type DevelopDict } from "./dict.js";

const IMPLEMENTED_KEYS = new Set([
  "preset",
  "brilliance",
  "exposure",
  "highlights",
  "shadows",
  "brightness",
  "contrast",
  "black_point",
  "saturation",
  "vibrance",
  "white_balance",
  "cast",
  "curves",
  "levels",
  "definition",
  "sharpen",
  "noise_reduction",
]);

/** Runs deterministic develop in Rust; TypeScript owns only color-space transport. */
export async function applyDevelop(
  image: SceneLinearImage,
  unparsed: DevelopDict,
): Promise<SceneLinearImage> {
  if (image.space !== "scene-linear-rec2020") {
    throw new Error("Develop requires oriented scene-linear Rec.2020 pixels");
  }
  const parameters = developDictSchema.parse(unparsed);
  const unsupported = Object.keys(parameters).find((key) => !IMPLEMENTED_KEYS.has(key));
  if (unsupported) throw new Error(`Develop operation is not implemented: ${unsupported}`);

  if (Object.keys(parameters).every((key) => key === "preset")) {
    return image;
  }
  const data = await applyDevelopPixels(image.data, image.w, image.h, nativeParameters(parameters));
  return {
    ...image,
    data,
  };
}

/** Validates and grades canonical TIFF samples in one asynchronous native worker allocation. */
export async function applyDevelopArtifact(
  bytes: Buffer,
  dimensions: { w: number; h: number },
  unparsed: DevelopDict,
): Promise<{ bytes: Buffer; w: number; h: number; pixelOffset: number }> {
  const parameters = developDictSchema.parse(unparsed);
  const unsupported = Object.keys(parameters).find((key) => !IMPLEMENTED_KEYS.has(key));
  if (unsupported) throw new Error(`Develop operation is not implemented: ${unsupported}`);
  const layout = await inspectArtifactLinearTiff(bytes);
  if (layout.width !== dimensions.w || layout.height !== dimensions.h) {
    throw new Error("Develop artifact dimensions do not match graph metadata");
  }
  const developed = await applyDevelopArtifactNative(
    bytes,
    layout.pixelOffset,
    layout.pixelBytes,
    layout.width,
    layout.height,
    nativeParameters(parameters),
  );
  return {
    bytes: Buffer.from(developed.buffer, developed.byteOffset, developed.byteLength),
    w: layout.width,
    h: layout.height,
    pixelOffset: layout.pixelOffset,
  };
}

function nativeParameters(parameters: DevelopDict): NativeDevelopParameters {
  return {
    brilliance: parameters.brilliance,
    exposure: parameters.exposure,
    highlights: parameters.highlights,
    shadows: parameters.shadows,
    brightness: parameters.brightness,
    contrast: parameters.contrast,
    blackPoint: parameters.black_point,
    saturation: parameters.saturation,
    vibrance: parameters.vibrance,
    temperatureOffsetK: parameters.white_balance?.temp_offset_k,
    tint: parameters.white_balance?.tint,
    cast: parameters.cast,
    curves: parameters.curves,
    levels: parameters.levels,
    definition: parameters.definition,
    sharpen: parameters.sharpen,
    noiseReductionLuminance: parameters.noise_reduction?.luminance,
    noiseReductionColor: parameters.noise_reduction?.color,
  };
}
