import {
  applyDeltaArtifact as applyDeltaArtifactNative,
  applyDevelopPixels,
  applyDevelopArtifact as applyDevelopArtifactNative,
  type NativeDevelopParameters,
} from "@photoctl/img";
import type { SceneLinearImage } from "../decoder.js";
import { inspectArtifactLinearTiff } from "../linear-tiff.js";
import { developDictSchema, type DevelopDict } from "./dict.js";
import { classifyDevelopChange } from "./tiers.js";
import {
  applyDevelopArtifactGeometry,
  applyDevelopGeometry,
  hasDevelopGeometry,
} from "./geometry.js";

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
  "bw",
  "filter",
  "vignette",
  "crop",
  "rotate",
  "straighten_deg",
  "aspect_ratio",
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

  const developed = hasPixelDevelop(parameters)
    ? {
        ...image,
        data: await applyDevelopPixels(image.data, image.w, image.h, nativeParameters(parameters)),
      }
    : image;
  return await applyDevelopGeometry(developed, parameters);
}

/** Validates and grades canonical TIFF samples in one asynchronous native worker allocation. */
export async function applyDevelopArtifact(
  bytes: Buffer,
  dimensions: { w: number; h: number },
  unparsed: DevelopDict,
  geometryBaseDimensions: { w: number; h: number } = dimensions,
): Promise<{ bytes: Buffer; w: number; h: number; pixelOffset: number }> {
  const parameters = scaleDevelopGeometry(
    developDictSchema.parse(unparsed),
    geometryBaseDimensions,
    dimensions,
  );
  const unsupported = Object.keys(parameters).find((key) => !IMPLEMENTED_KEYS.has(key));
  if (unsupported) throw new Error(`Develop operation is not implemented: ${unsupported}`);
  const layout = await inspectArtifactLinearTiff(bytes);
  if (layout.width !== dimensions.w || layout.height !== dimensions.h) {
    throw new Error("Develop artifact dimensions do not match graph metadata");
  }
  const developed = hasPixelDevelop(parameters)
    ? await applyDevelopArtifactNative(
        bytes,
        layout.pixelOffset,
        layout.pixelBytes,
        layout.width,
        layout.height,
        nativeParameters(parameters),
      )
    : bytes;
  if (hasDevelopGeometry(parameters)) {
    return await applyDevelopArtifactGeometry(
      Buffer.from(developed.buffer, developed.byteOffset, developed.byteLength),
      dimensions,
      parameters,
    );
  }
  return {
    bytes: Buffer.from(developed.buffer, developed.byteOffset, developed.byteLength),
    w: layout.width,
    h: layout.height,
    pixelOffset: layout.pixelOffset,
  };
}

/** Applies a compatible develop compensation to an existing scene-linear artifact. */
export async function applyDevelopDeltaArtifact(
  bytes: Buffer,
  dimensions: { w: number; h: number },
  unparsed: DevelopDict,
): Promise<{ bytes: Buffer; w: number; h: number; pixelOffset: number }> {
  const parameters = developDictSchema.parse(unparsed);
  if (classifyDevelopChange({}, parameters) !== 1) {
    throw new Error("Delta requires a non-empty Tier-1 develop dictionary");
  }
  const layout = await inspectArtifactLinearTiff(bytes);
  if (layout.width !== dimensions.w || layout.height !== dimensions.h) {
    throw new Error("Delta artifact dimensions do not match graph metadata");
  }
  const developed = await applyDeltaArtifactNative(
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

function hasPixelDevelop(parameters: DevelopDict): boolean {
  return Object.keys(parameters).some(
    (key) => !["preset", "crop", "rotate", "straighten_deg", "aspect_ratio"].includes(key),
  );
}

function scaleDevelopGeometry(
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
    bwEnabled: parameters.bw !== undefined,
    bwIntensity: parameters.bw?.intensity,
    bwNeutrals: parameters.bw?.neutrals,
    bwTone: parameters.bw?.tone,
    bwGrain: parameters.bw?.grain,
    filterName: parameters.filter?.name,
    filterStrength: parameters.filter?.strength,
    vignette: parameters.vignette,
  };
}
