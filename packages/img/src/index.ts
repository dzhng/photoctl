import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface NativeProbe {
  supported: boolean;
  compression?: number;
  notes: string[];
}

export interface NativeLinearImage {
  width: number;
  height: number;
  space: "camera";
  data: Float32Array;
  whiteLevel: number;
  blackLevel: number;
  camXyz: number[];
  asShotWb: number[];
  wbPreApplied: boolean;
}

export interface DevelopedImage {
  data: Float32Array;
  space: "scene-linear-rec2020";
  whiteLevel: 1;
  blackLevel: 0;
  wbPreApplied: true;
}

interface NativeBinding {
  Sam2OnnxRuntime: new (encoder: Uint8Array, decoder: Uint8Array) => NativeSam2OnnxRuntime;
  sam2MaskFromLogits(
    logits: Float32Array,
    logitWidth: number,
    logitHeight: number,
    modelSize: number,
    resizedWidth: number,
    resizedHeight: number,
    offsetX: number,
    offsetY: number,
    baseWidth: number,
    baseHeight: number,
  ): Float32Array;
  atomicRenameNoReplace(source: string, destination: string): AtomicRenameOutcome;
  librawVersion(): string;
  probeLibraw(path: string): NativeProbe;
  decodeLibrawImage(path: string, scale: number): Promise<NativeLinearImage>;
  solidRgbPixels(
    width: number,
    height: number,
    red: number,
    green: number,
    blue: number,
  ): Promise<Float32Array>;
  healPixels(
    data: Float32Array,
    mask: Float32Array,
    width: number,
    height: number,
    neighborhoodRadius: number,
    refinementIterations: number,
    refinementPixelBudget: number,
  ): Promise<Float32Array>;
  drawMarkupPixels(
    data: Float32Array,
    width: number,
    height: number,
    documentJson: string,
  ): Promise<Float32Array>;
  drawMarkupOverlay(
    width: number,
    height: number,
    documentJson: string,
  ): Promise<{ color: Float32Array; mask: Float32Array }>;
  developCameraFront(
    data: Float32Array,
    whiteLevel: number,
    blackLevel: number,
    camXyz: number[],
    asShotWb: number[],
    wbPreApplied: boolean,
  ): Promise<DevelopedImage>;
  convertDisplaySrgbToLinearRec2020(data: Uint16Array): Promise<Float32Array>;
  convertLinearRec2020ToDisplaySrgb(data: Float32Array): Promise<Float32Array>;
  resampleDisplaySrgb(
    data: Uint16Array,
    sourceWidth: number,
    sourceHeight: number,
    outputWidth: number,
    outputHeight: number,
  ): Uint16Array;
  resampleDisplaySrgb8(
    data: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    outputWidth: number,
    outputHeight: number,
  ): Uint8Array;
  resampleDisplaySrgbRegion(
    data: Uint16Array,
    sourceWidth: number,
    sourceHeight: number,
    left: number,
    top: number,
    width: number,
    height: number,
    outputWidth: number,
    outputHeight: number,
  ): Uint16Array;
  resamplePixels(
    data: Float32Array,
    sourceWidth: number,
    sourceHeight: number,
    channels: number,
    outputWidth: number,
    outputHeight: number,
    filter: ResampleFilter,
  ): Promise<Float32Array>;
  transformPixels(
    data: Float32Array,
    sourceWidth: number,
    sourceHeight: number,
    channels: number,
    outputWidth: number,
    outputHeight: number,
    matrix: readonly number[],
    filter: ResampleFilter,
  ): Promise<Float32Array>;
  morphologyMask(
    data: Float32Array,
    width: number,
    height: number,
    radius: number,
    operation: "dilate" | "erode",
  ): Promise<Float32Array>;
  featherMask(
    data: Float32Array,
    width: number,
    height: number,
    radius: number,
  ): Promise<Float32Array>;
  transformMaskPixels(
    data: Float32Array,
    width: number,
    height: number,
    outputWidth: number,
    outputHeight: number,
    matrix: readonly number[],
  ): Promise<Float32Array>;
  liftMaskedPixels(
    content: Float32Array,
    mask: Float32Array,
    width: number,
    height: number,
  ): Promise<Float32Array>;
  overlayMaskedPixels(
    base: Float32Array,
    content: Float32Array,
    mask: Float32Array,
    width: number,
    height: number,
    opacity: number,
  ): Promise<Float32Array>;
  compositeMaskedPixels(
    base: Float32Array,
    content: Float32Array,
    mask: Float32Array,
    width: number,
    height: number,
    opacity: number,
  ): Promise<Float32Array>;
  transformArtifactPixels(
    data: Uint8Array,
    pixelOffset: number,
    pixelBytes: number,
    sourceWidth: number,
    sourceHeight: number,
    outputWidth: number,
    outputHeight: number,
    matrix: readonly number[],
    filter: ResampleFilter,
  ): Promise<Uint8Array>;
  applyDevelopPixels(
    data: Float32Array,
    width: number,
    height: number,
    parameters: NativeDevelopParameters,
  ): Promise<Float32Array>;
  applyDevelopArtifact(
    data: Uint8Array,
    pixelOffset: number,
    pixelBytes: number,
    width: number,
    height: number,
    parameters: NativeDevelopParameters,
  ): Promise<Uint8Array>;
  applyDeltaArtifact(
    data: Uint8Array,
    pixelOffset: number,
    pixelBytes: number,
    width: number,
    height: number,
    parameters: NativeDevelopParameters,
  ): Promise<Uint8Array>;
  validateLinearArtifactSamples(
    data: Uint8Array,
    pixelOffset: number,
    pixelBytes: number,
  ): Promise<void>;
}

interface NativeSam2OnnxRuntime {
  encoderInputNames(): string[];
  decoderInputNames(): string[];
  runEncoder(inputs: Sam2TensorInput[], output: string): Promise<Sam2TensorOutput>;
  runDecoder(inputs: Sam2TensorInput[], output: string): Promise<Sam2TensorOutput>;
}

export type Sam2TensorInput = {
  name: string;
  dimensions: number[];
} & ({ f32Data: Float32Array; i32Data?: never } | { i32Data: Int32Array; f32Data?: never });
export interface Sam2TensorOutput {
  dimensions: number[];
  data: Float32Array;
}
export type Sam2OnnxRuntime = NativeSam2OnnxRuntime;

export type AtomicRenameOutcome = "installed" | "exists" | "unsupported";
export type ResampleFilter = "bilinear" | "lanczos3";

export interface NativeDevelopParameters {
  brilliance?: number;
  exposure?: number;
  highlights?: number;
  shadows?: number;
  brightness?: number;
  contrast?: number;
  blackPoint?: number;
  saturation?: number;
  vibrance?: number;
  temperatureOffsetK?: number;
  tint?: number;
  cast?: number;
  curves?: {
    rgb?: [number, number][];
    red?: [number, number][];
    green?: [number, number][];
    blue?: [number, number][];
  };
  levels?: { black: number; midpoint: number; white: number };
  definition?: number;
  sharpen?: number;
  noiseReductionLuminance?: number;
  noiseReductionColor?: number;
  selectiveColor?: Partial<
    Record<
      "red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "magenta",
      { hue?: number; saturation?: number; luminance?: number }
    >
  >;
  bwIntensity?: number;
  bwNeutrals?: number;
  bwTone?: number;
  bwGrain?: number;
  bwEnabled?: boolean;
  filterName?:
    | "vivid"
    | "vivid_warm"
    | "vivid_cool"
    | "dramatic"
    | "dramatic_warm"
    | "dramatic_cool"
    | "mono"
    | "silvertone"
    | "noir";
  filterStrength?: number;
  vignette?: number;
}

export class NativeImageUnavailableError extends Error {}

export function createSam2OnnxRuntime(encoder: Uint8Array, decoder: Uint8Array): Sam2OnnxRuntime {
  return new (requiredBinding().Sam2OnnxRuntime)(encoder, decoder);
}

export function sam2MaskFromLogits(
  logits: Float32Array,
  logitWidth: number,
  logitHeight: number,
  mapping: {
    modelSize: number;
    resizedWidth: number;
    resizedHeight: number;
    offsetX: number;
    offsetY: number;
    baseWidth: number;
    baseHeight: number;
  },
): Float32Array {
  return asFloat32Array(
    requiredBinding().sam2MaskFromLogits(
      logits,
      logitWidth,
      logitHeight,
      mapping.modelSize,
      mapping.resizedWidth,
      mapping.resizedHeight,
      mapping.offsetX,
      mapping.offsetY,
      mapping.baseWidth,
      mapping.baseHeight,
    ),
  );
}

/** Atomically moves a sibling file into an unoccupied destination. */
export function atomicRenameNoReplace(source: string, destination: string): AtomicRenameOutcome {
  return requiredBinding().atomicRenameNoReplace(source, destination);
}

export function inspectLibraw(): { available: boolean; version: string | null } {
  const binding = loadBinding();
  return binding
    ? { available: true, version: binding.librawVersion() }
    : { available: false, version: null };
}

export function inspectNativeImageRuntime(): { available: boolean; package: string } {
  return { available: loadBinding() !== undefined, package: platformPackage() };
}

export function probeLibraw(path: string): NativeProbe {
  return requiredBinding().probeLibraw(path);
}

export async function decodeLibraw(path: string, scale: number): Promise<NativeLinearImage> {
  const image = await requiredBinding().decodeLibrawImage(path, scale);
  return {
    ...image,
    data:
      image.data instanceof Float32Array
        ? image.data
        : new Float32Array(image.data as unknown as ArrayLike<number>),
  };
}

export async function developCameraFront(image: NativeLinearImage): Promise<DevelopedImage> {
  const result = await requiredBinding().developCameraFront(
    image.data,
    image.whiteLevel,
    image.blackLevel,
    image.camXyz,
    image.asShotWb,
    image.wbPreApplied,
  );
  return { ...result, data: asFloat32Array(result.data) };
}

export async function displaySrgbToLinearRec2020(data: Uint16Array): Promise<Float32Array> {
  return asFloat32Array(await requiredBinding().convertDisplaySrgbToLinearRec2020(data));
}

export async function linearRec2020ToDisplaySrgb(data: Float32Array): Promise<Float32Array> {
  return asFloat32Array(await requiredBinding().convertLinearRec2020ToDisplaySrgb(data));
}

export function resampleDisplaySrgb(
  data: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): Uint16Array {
  return requiredBinding().resampleDisplaySrgb(
    data,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  );
}

export function resampleDisplaySrgb8(
  data: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): Uint8Array {
  const result = requiredBinding().resampleDisplaySrgb8(
    data,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
  );
  return result instanceof Uint8Array ? result : new Uint8Array(result);
}

export function resampleDisplaySrgbRegion(
  data: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): Uint16Array {
  return requiredBinding().resampleDisplaySrgbRegion(
    data,
    sourceWidth,
    sourceHeight,
    left,
    top,
    width,
    height,
    outputWidth,
    outputHeight,
  );
}

export async function resamplePixels(
  data: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
  outputWidth: number,
  outputHeight: number,
  filter: ResampleFilter,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().resamplePixels(
      data,
      sourceWidth,
      sourceHeight,
      channels,
      outputWidth,
      outputHeight,
      filter,
    ),
  );
}

export async function transformPixels(
  data: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  channels: number,
  outputWidth: number,
  outputHeight: number,
  matrix: readonly [number, number, number, number, number, number],
  filter: ResampleFilter,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().transformPixels(
      data,
      sourceWidth,
      sourceHeight,
      channels,
      outputWidth,
      outputHeight,
      matrix,
      filter,
    ),
  );
}

export async function morphologyMask(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
  operation: "dilate" | "erode",
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().morphologyMask(data, width, height, radius, operation),
  );
}

export async function featherMask(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Promise<Float32Array> {
  return asFloat32Array(await requiredBinding().featherMask(data, width, height, radius));
}

export async function transformMaskPixels(
  data: Float32Array,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
  matrix: readonly [number, number, number, number, number, number],
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().transformMaskPixels(
      data,
      width,
      height,
      outputWidth,
      outputHeight,
      matrix,
    ),
  );
}

export async function liftMaskedPixels(
  content: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
): Promise<Float32Array> {
  return asFloat32Array(await requiredBinding().liftMaskedPixels(content, mask, width, height));
}

export async function overlayMaskedPixels(
  base: Float32Array,
  content: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  opacity: number,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().overlayMaskedPixels(base, content, mask, width, height, opacity),
  );
}

export async function compositeMaskedPixels(
  base: Float32Array,
  content: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  opacity: number,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().compositeMaskedPixels(base, content, mask, width, height, opacity),
  );
}

export async function solidRgbPixels(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().solidRgbPixels(width, height, rgb[0], rgb[1], rgb[2]),
  );
}

export async function healPixels(
  data: Float32Array,
  mask: Float32Array,
  width: number,
  height: number,
  neighborhoodRadius: number,
  refinementIterations: number,
  refinementPixelBudget: number,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().healPixels(
      data,
      mask,
      width,
      height,
      neighborhoodRadius,
      refinementIterations,
      refinementPixelBudget,
    ),
  );
}

export async function drawMarkupPixels(
  data: Float32Array,
  width: number,
  height: number,
  documentJson: string,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().drawMarkupPixels(data, width, height, documentJson),
  );
}

export async function drawMarkupOverlay(
  width: number,
  height: number,
  documentJson: string,
): Promise<{ color: Float32Array; mask: Float32Array }> {
  const overlay = await requiredBinding().drawMarkupOverlay(width, height, documentJson);
  return { color: asFloat32Array(overlay.color), mask: asFloat32Array(overlay.mask) };
}

export async function transformArtifactPixels(
  data: Uint8Array,
  pixelOffset: number,
  pixelBytes: number,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
  matrix: readonly [number, number, number, number, number, number],
  filter: ResampleFilter,
): Promise<Uint8Array> {
  return await requiredBinding().transformArtifactPixels(
    data,
    pixelOffset,
    pixelBytes,
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    matrix,
    filter,
  );
}

export async function applyDevelopPixels(
  data: Float32Array,
  width: number,
  height: number,
  parameters: NativeDevelopParameters,
): Promise<Float32Array> {
  return asFloat32Array(
    await requiredBinding().applyDevelopPixels(data, width, height, parameters),
  );
}

export async function applyDevelopArtifact(
  data: Uint8Array,
  pixelOffset: number,
  pixelBytes: number,
  width: number,
  height: number,
  parameters: NativeDevelopParameters,
): Promise<Uint8Array> {
  return await requiredBinding().applyDevelopArtifact(
    data,
    pixelOffset,
    pixelBytes,
    width,
    height,
    parameters,
  );
}

export async function applyDeltaArtifact(
  data: Uint8Array,
  pixelOffset: number,
  pixelBytes: number,
  width: number,
  height: number,
  parameters: NativeDevelopParameters,
): Promise<Uint8Array> {
  return await requiredBinding().applyDeltaArtifact(
    data,
    pixelOffset,
    pixelBytes,
    width,
    height,
    parameters,
  );
}

export async function validateLinearArtifactSamples(
  data: Uint8Array,
  pixelOffset: number,
  pixelBytes: number,
): Promise<void> {
  await requiredBinding().validateLinearArtifactSamples(data, pixelOffset, pixelBytes);
}

let loaded: NativeBinding | null | undefined;

function loadBinding(): NativeBinding | undefined {
  if (loaded !== undefined) return loaded ?? undefined;
  try {
    loaded = require(platformPackage()) as NativeBinding;
  } catch {
    loaded = null;
  }
  return loaded ?? undefined;
}

function requiredBinding(): NativeBinding {
  const binding = loadBinding();
  if (!binding) throw new NativeImageUnavailableError("The native image package is not installed");
  return binding;
}

function asFloat32Array(data: Float32Array | ArrayLike<number>): Float32Array {
  return data instanceof Float32Array ? data : new Float32Array(data);
}

function platformPackage(): string {
  const suffix = `${process.platform}-${process.arch}`;
  const packages: Record<string, string> = {
    "darwin-arm64": "@photoctl/img-darwin-arm64",
    "darwin-x64": "@photoctl/img-darwin-x64",
    "linux-arm64": "@photoctl/img-linux-arm64-gnu",
    "linux-x64": "@photoctl/img-linux-x64-gnu",
  };
  return packages[suffix] ?? `@photoctl/img-${suffix}`;
}
