import { link, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import sharp, { type Sharp } from "sharp";
import { srgb2014ProfilePath } from "../color.js";
import type { Image16 } from "../source-render.js";
import { applyDeliveryMetadata, embedTiffMetadata, type DeliveryMetadata } from "./metadata.js";

export type ExportFormat = "jpeg" | "png" | "tiff";

export interface ImageExport {
  id: string;
  image: Image16;
  outputPath: string;
  format: ExportFormat;
  quality: number;
  resize?: number;
  metadata: DeliveryMetadata;
  replace?: boolean;
}

export interface ImageExportResult {
  file: string;
  w: number;
  h: number;
  bytes: number;
}

export class ExportRenderError extends Error {
  readonly code = "decoder_unavailable";
  constructor(
    readonly photoId: string,
    cause?: unknown,
  ) {
    super(`The image for ${photoId} could not be rendered`, { cause });
  }
}

export class ExportWriteError extends Error {
  readonly code = "volume_readonly";
  constructor(
    readonly photoId: string,
    readonly outputPath: string,
  ) {
    super(`Could not write the export for ${photoId}: ${outputPath}`);
  }
}

/** Encode and publish one evaluated image. Naming, source selection, and collision policy belong to the caller. */
export async function exportImage(request: ImageExport): Promise<ImageExportResult> {
  let encoded: Buffer;
  try {
    encoded = await encodeDelivery(request.image, request);
  } catch (error) {
    throw new ExportRenderError(request.id, error);
  }
  try {
    await writeDurable(request.outputPath, encoded, request.replace ?? false);
  } catch {
    throw new ExportWriteError(request.id, request.outputPath);
  }
  const dimensions = deliveryDimensions(request.image.w, request.image.h, request.resize);
  return {
    file: request.outputPath,
    w: dimensions.w,
    h: dimensions.h,
    bytes: encoded.length,
  };
}

async function encodeDelivery(image: Image16, request: ImageExport): Promise<Buffer> {
  let pipeline =
    request.format === "tiff"
      ? sharp16(image)
      : sharp(toEightBit(image), {
          raw: { width: image.w, height: image.h, channels: image.channels },
        });
  const dimensions = deliveryDimensions(image.w, image.h, request.resize);
  if (dimensions.w !== image.w || dimensions.h !== image.h) {
    pipeline = pipeline.resize(dimensions.w, dimensions.h, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    });
  }
  pipeline = applyDeliveryMetadata(
    request.format === "tiff"
      ? pipeline.withMetadata({ icc: srgb2014ProfilePath })
      : pipeline.withIccProfile(srgb2014ProfilePath),
    request.metadata,
  );
  if (request.format === "jpeg") {
    return await pipeline.jpeg({ quality: request.quality, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  if (request.format === "png") return await pipeline.png().toBuffer();
  const tiff = await pipeline
    .toColourspace("rgb16")
    .tiff({ compression: "lzw", predictor: "horizontal" })
    .toBuffer();
  return embedTiffMetadata(tiff, request.metadata);
}

function sharp16(image: Image16): Sharp {
  // Sharp 0.35 derives raw input depth from the typed-array constructor; a Buffer becomes uchar.
  const ushortPixels: Uint16Array = image.data;
  return sharp(ushortPixels, {
    raw: { width: image.w, height: image.h, channels: image.channels },
  });
}

function toEightBit(image: Image16): Buffer {
  const bytes = Buffer.allocUnsafe(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    bytes[index] = Math.round(image.data[index] / 257);
  }
  return bytes;
}

function deliveryDimensions(
  width: number,
  height: number,
  requested?: number,
): { w: number; h: number } {
  if (requested === undefined || requested >= Math.max(width, height))
    return { w: width, h: height };
  const scale = requested / Math.max(width, height);
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

async function writeDurable(path: string, bytes: Buffer, replace: boolean): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`;
  let published = false;
  try {
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (replace) {
      await rename(temporary, path);
    } else {
      try {
        await link(temporary, path);
      } catch (error) {
        if (!isUnsupportedLink(error)) throw error;
        await writeExclusive(path, bytes);
      }
    }
    published = true;
    if (!replace) await unlink(temporary).catch(() => undefined);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (!published) await unlink(temporary).catch(() => undefined);
  }
}

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
  let destination: Awaited<ReturnType<typeof open>> | undefined;
  try {
    destination = await open(path, "wx");
    await destination.writeFile(bytes);
    await destination.sync();
    await destination.close();
    destination = undefined;
  } catch (error) {
    if (destination) {
      await destination.close().catch(() => undefined);
      await unlink(path).catch(() => undefined);
    }
    throw error;
  }
}

function isUnsupportedLink(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EACCES", "ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM"].includes(String(error.code))
  );
}
