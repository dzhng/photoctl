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

interface NativeBinding {
  librawVersion(): string;
  probeLibraw(path: string): NativeProbe;
  decodeLibrawImage(path: string, scale: number): Promise<NativeLinearImage>;
}

export class NativeImageUnavailableError extends Error {}

export function inspectLibraw(): { available: boolean; version: string | null } {
  const binding = loadBinding();
  return binding
    ? { available: true, version: binding.librawVersion() }
    : { available: false, version: null };
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
  if (!binding) throw new NativeImageUnavailableError("LibRaw native package is not installed");
  return binding;
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
