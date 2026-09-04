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
  librawVersion(): string;
  probeLibraw(path: string): NativeProbe;
  decodeLibrawImage(path: string, scale: number): Promise<NativeLinearImage>;
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
}

export class NativeImageUnavailableError extends Error {}

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
