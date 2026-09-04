import { execFile } from "node:child_process";
import { open, mkdtemp, readFile, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  NativeImageUnavailableError,
  decodeLibraw,
  inspectLibraw,
  inspectNativeImageRuntime,
  probeLibraw,
} from "@photoctl/img";
import sharp, { type Sharp } from "sharp";
import { displaySrgbToLinearRec2020 } from "./color.js";
import {
  orientationTransform,
  orientedDimensions,
  parseExifOrientation,
  type ExifOrientation,
} from "./coordinates.js";

const executeFile = promisify(execFile);

interface LocatedImageSource {
  path: string;
  mediaType: string;
  w: number;
  h: number;
  copyExact?: boolean;
  orientation?: ExifOrientation;
}

export type ImageSource =
  | (LocatedImageSource & { kind: "online-file" })
  | (LocatedImageSource & { kind: "online-jpeg-range"; offset: number; length: number })
  | {
      kind: "pinned-preview";
      path: string;
      mediaType: "image/jpeg";
      orientation: ExifOrientation;
    };

export type DecodeScale = 1 | 0.5 | 0.25;

export interface DecoderProbe {
  supported: boolean;
  compression?: number;
  decoderVersion?: string;
  notes: string[];
}

export interface LinearImage {
  w: number;
  h: number;
  orientationApplied: true;
  space: "camera" | "scene-linear-rec2020";
  data: Float32Array;
  whiteLevel: number;
  blackLevel: number;
  camXyz?: readonly number[];
  asShotWb?: readonly number[];
  wbPreApplied: boolean;
}

export type SceneLinearImage = Omit<LinearImage, "space"> & {
  space: "scene-linear-rec2020";
};

export interface Decoder {
  readonly id: "file" | "ciraw" | "libraw";
  probe(source: ImageSource): Promise<DecoderProbe>;
  decode(source: ImageSource, options: { scale: DecodeScale }): Promise<LinearImage>;
}

export interface DecoderImageProbe {
  readonly kind: "image" | "raw";
  readonly preview: { readonly kind: "decoded-file" | "embedded-jpeg" };
}

export interface DecoderSelection {
  decoder: Decoder;
  source: ImageSource;
  fellBack: boolean;
  probe?: DecoderProbe;
}

export class DecoderUnavailableError extends Error {}

export class FileImageDecoder implements Decoder {
  readonly id = "file" as const;

  async probe(source: ImageSource): Promise<DecoderProbe> {
    try {
      const bytes = await readImageSource(source);
      const image = sharp(bytes, { animated: true, failOn: "error" });
      const metadata = await image.metadata();
      if ((metadata.pages ?? 1) !== 1)
        return { supported: false, decoderVersion: sharp.versions.sharp, notes: ["multi-frame"] };
      await sharp(bytes, { failOn: "error" }).stats();
      return { supported: true, decoderVersion: sharp.versions.sharp, notes: [] };
    } catch {
      return { supported: false, decoderVersion: sharp.versions.sharp, notes: ["undecodable"] };
    }
  }

  async decode(source: ImageSource, options: { scale: DecodeScale }): Promise<LinearImage> {
    const display = await this.decodeDisplay(source, options);
    return {
      w: display.w,
      h: display.h,
      orientationApplied: true,
      space: "scene-linear-rec2020",
      data: await displaySrgbToLinearRec2020(display.data),
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    };
  }

  async decodeDisplay(
    source: ImageSource,
    options: { scale: DecodeScale; orientation?: ExifOrientation },
  ): Promise<{ w: number; h: number; data: Uint16Array }> {
    const bytes = await readImageSource(source);
    let image = sharp(bytes, { failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new DecoderUnavailableError("The file decoder could not determine image dimensions");
    }
    const orientation =
      options.orientation ??
      (source.kind === "online-file"
        ? parseExifOrientation(metadata.orientation ?? 1)
        : (source.orientation ?? 1));
    image = orient(image, orientation);
    if (options.scale !== 1) {
      const dimensions = orientedDimensions({ w: metadata.width, h: metadata.height }, orientation);
      image = image.resize({
        width: Math.floor(dimensions.w * options.scale),
        height: Math.floor(dimensions.h * options.scale),
        fit: "fill",
      });
    }
    const { data, info } = await image
      .withIccProfile("srgb")
      .toColourspace("rgb16")
      .removeAlpha()
      .raw({ depth: "ushort" })
      .toBuffer({ resolveWithObject: true });
    return {
      w: info.width,
      h: info.height,
      data: new Uint16Array(
        data.buffer,
        data.byteOffset,
        data.byteLength / Uint16Array.BYTES_PER_ELEMENT,
      ),
    };
  }
}

function orient(image: Sharp, orientation: ExifOrientation | undefined): Sharp {
  if (!orientation || orientation === 1) return image;
  const transform = orientationTransform(orientation);
  let oriented = image;
  if (transform.flip) oriented = oriented.flip();
  if (transform.flop) oriented = oriented.flop();
  return transform.rotation === 0 ? oriented : oriented.rotate(transform.rotation);
}

interface CirawProbeResult {
  supported: boolean;
  supportedDecoderVersions: string[];
  decoderVersion?: string;
  nativeWidth?: number;
  nativeHeight?: number;
}

interface CirawDecodeResult {
  width: number;
  height: number;
  channels: 3;
  space: "scene-linear-rec2020";
  orientationApplied: true;
  wireFormat: "rgb-f32le";
  decoderVersion: string;
}

export class CirawDecoder implements Decoder {
  readonly id = "ciraw" as const;

  constructor(private readonly helperPath = "photoctl-mac") {}

  async probe(source: ImageSource): Promise<DecoderProbe> {
    if (source.kind !== "online-file") {
      return { supported: false, notes: ["CIRAW requires an online whole-file source"] };
    }
    const result = parseCirawProbe(await this.run(["probe", source.path]));
    return {
      supported: result.supported,
      compression: undefined,
      decoderVersion: result.decoderVersion,
      notes: result.decoderVersion ? [`Core Image RAW decoder ${result.decoderVersion}`] : [],
    };
  }

  async decode(source: ImageSource, options: { scale: DecodeScale }): Promise<LinearImage> {
    if (source.kind !== "online-file") {
      throw new DecoderUnavailableError("CIRAW requires an online whole-file source");
    }
    const directory = await mkdtemp(join(tmpdir(), "photoctl-ciraw-"));
    const output = join(directory, "image.rgb-f32");
    try {
      const result = parseCirawDecode(
        await this.run([
          "decode",
          source.path,
          "--scale",
          String(options.scale),
          "--output",
          output,
        ]),
      );
      const bytes = await readFile(output);
      const expectedLength = result.width * result.height * 3 * Float32Array.BYTES_PER_ELEMENT;
      if (bytes.byteLength !== expectedLength) {
        throw new DecoderUnavailableError("CIRAW returned an incomplete pixel buffer");
      }
      const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return {
        w: result.width,
        h: result.height,
        orientationApplied: true,
        space: "scene-linear-rec2020",
        data: new Float32Array(copied),
        whiteLevel: 1,
        blackLevel: 0,
        wbPreApplied: true,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async run(arguments_: string[]): Promise<unknown> {
    try {
      const { stdout } = await executeFile(this.helperPath, arguments_, {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      return JSON.parse(stdout) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DecoderUnavailableError(`CIRAW helper unavailable: ${message}`);
    }
  }
}

export class LibrawDecoder implements Decoder {
  readonly id = "libraw" as const;

  async probe(source: ImageSource): Promise<DecoderProbe> {
    if (source.kind !== "online-file") {
      return { supported: false, notes: ["LibRaw requires an online whole-file source"] };
    }
    try {
      const result = probeLibraw(source.path);
      return { ...result, decoderVersion: inspectLibraw().version ?? undefined };
    } catch (error) {
      if (error instanceof NativeImageUnavailableError) {
        return { supported: false, notes: [error.message] };
      }
      throw error;
    }
  }

  async decode(source: ImageSource, options: { scale: DecodeScale }): Promise<LinearImage> {
    if (source.kind !== "online-file") {
      throw new DecoderUnavailableError("LibRaw requires an online whole-file source");
    }
    try {
      const image = await decodeLibraw(source.path, options.scale);
      if (
        !Number.isSafeInteger(image.width) ||
        image.width <= 0 ||
        !Number.isSafeInteger(image.height) ||
        image.height <= 0 ||
        image.space !== "camera" ||
        image.data.length !== image.width * image.height * 3 ||
        image.camXyz.length !== 9 ||
        image.asShotWb.length !== 3
      ) {
        throw new DecoderUnavailableError("LibRaw returned an incompatible image contract");
      }
      return {
        w: image.width,
        h: image.height,
        orientationApplied: true,
        space: "camera",
        data: image.data,
        whiteLevel: image.whiteLevel,
        blackLevel: image.blackLevel,
        camXyz: image.camXyz,
        asShotWb: image.asShotWb,
        wbPreApplied: image.wbPreApplied,
      };
    } catch (error) {
      if (error instanceof DecoderUnavailableError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new DecoderUnavailableError(`LibRaw decode failed: ${message}`);
    }
  }
}

function parseCirawProbe(value: unknown): CirawProbeResult {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as CirawProbeResult).supported !== "boolean" ||
    !Array.isArray((value as CirawProbeResult).supportedDecoderVersions)
  ) {
    throw new DecoderUnavailableError("CIRAW returned an incompatible probe contract");
  }
  return value as CirawProbeResult;
}

function parseCirawDecode(value: unknown): CirawDecodeResult {
  const result = value as CirawDecodeResult;
  if (
    !result ||
    typeof result !== "object" ||
    !Number.isSafeInteger(result.width) ||
    result.width <= 0 ||
    !Number.isSafeInteger(result.height) ||
    result.height <= 0 ||
    result.channels !== 3 ||
    result.space !== "scene-linear-rec2020" ||
    result.orientationApplied !== true ||
    result.wireFormat !== "rgb-f32le" ||
    typeof result.decoderVersion !== "string"
  ) {
    throw new DecoderUnavailableError("CIRAW returned an incompatible image contract");
  }
  return result;
}

export async function selectDecoder(options: {
  requested: "auto" | "file" | "ciraw" | "libraw";
  probe: DecoderImageProbe | undefined;
  original: Exclude<ImageSource, { kind: "pinned-preview" }> | undefined;
  fallback: ImageSource;
  decoders: { file: Decoder; ciraw?: Decoder; libraw?: Decoder };
}): Promise<DecoderSelection> {
  const file = options.decoders.file;
  if (options.requested === "file") {
    return { decoder: file, source: options.fallback, fellBack: false };
  }
  if (options.requested !== "auto") {
    const decoder = options.decoders[options.requested];
    if (!decoder) {
      throw new DecoderUnavailableError(`The ${options.requested} decoder is not installed`);
    }
    if (!options.original) {
      throw new DecoderUnavailableError(
        `${options.requested} requires an online whole-file source`,
      );
    }
    const probe = await decoder.probe(options.original);
    if (!probe.supported) {
      throw new DecoderUnavailableError(`${options.requested} cannot decode this image`);
    }
    return { decoder, source: options.original, fellBack: false, probe };
  }
  if (options.original && options.probe?.kind === "raw") {
    const selected = await firstSupportedDecoder(
      [options.decoders.libraw, options.decoders.ciraw].filter(
        (candidate): candidate is Decoder => candidate !== undefined,
      ),
      options.original,
    );
    if (selected) {
      return { ...selected, source: options.original, fellBack: false };
    }
    return { decoder: file, source: options.fallback, fellBack: true };
  }
  return { decoder: file, source: options.fallback, fellBack: false };
}

async function firstSupportedDecoder(
  [decoder, ...remaining]: Decoder[],
  source: ImageSource,
): Promise<{ decoder: Decoder; probe: DecoderProbe } | undefined> {
  if (!decoder) return undefined;
  try {
    const probe = await decoder.probe(source);
    if (probe.supported) return { decoder, probe };
  } catch (error) {
    if (!(error instanceof DecoderUnavailableError)) throw error;
  }
  return await firstSupportedDecoder(remaining, source);
}

export async function inspectCirawHelper(helperPath = "photoctl-mac"): Promise<{
  available: boolean;
  version: string | null;
}> {
  try {
    const { stdout } = await executeFile(helperPath, ["--version"], { encoding: "utf8" });
    return { available: true, version: stdout.trim().split(/\s+/).at(-1) ?? null };
  } catch {
    return { available: false, version: null };
  }
}

export function inspectLibrawDecoder(): { available: boolean; version: string | null } {
  return inspectLibraw();
}

export { inspectNativeImageRuntime };

export async function readImageSource(source: ImageSource): Promise<Buffer> {
  if (source.kind !== "online-jpeg-range") return await readFile(source.path);
  const file = await open(source.path, "r");
  try {
    const bytes = Buffer.allocUnsafe(source.length);
    await readRemaining(file, bytes, source.offset, 0);
    return bytes;
  } finally {
    await file.close();
  }
}

async function readRemaining(
  source: FileHandle,
  bytes: Buffer,
  offset: number,
  read: number,
): Promise<void> {
  if (read === bytes.length) return;
  const chunk = await source.read(bytes, read, bytes.length - read, offset + read);
  if (chunk.bytesRead === 0) throw new Error("Image source ended before its recorded length");
  await readRemaining(source, bytes, offset, read + chunk.bytesRead);
}
