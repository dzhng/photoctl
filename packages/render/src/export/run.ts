import { open, readFile, writeFile, type FileHandle } from "node:fs/promises";
import sharp from "sharp";
import type { ExifOrientation } from "../coordinates.js";
import { renderPhoto, type Image16 } from "../graph.js";

export interface EmbeddedJpegLocation {
  path: string;
  offset: number;
  length: number;
  w: number;
  h: number;
}

export interface EmbeddedJpegExport {
  id: string;
  orientation: ExifOrientation;
  outputPath: string;
  online?: EmbeddedJpegLocation;
  pinnedPath?: string;
}

export interface ExportWarning {
  code: "source_offline";
  id: string;
  message: string;
}

export interface EmbeddedJpegExportResult {
  file: string;
  w: number;
  h: number;
  bytes: number;
  warnings: ExportWarning[];
}

export class ExportSourceUnavailableError extends Error {
  readonly code = "file_offline";

  constructor(readonly photoId: string) {
    super(`No embedded JPEG source is available for ${photoId}`);
  }
}

/** Writes to `outputPath`; the caller owns its parent directory and collision policy. */
export async function exportEmbeddedJpeg(
  request: EmbeddedJpegExport,
): Promise<EmbeddedJpegExportResult> {
  const online = request.online;
  const onlineBytes = online ? await tryReadEmbeddedBytes(online) : undefined;
  if (online && onlineBytes) {
    if (request.orientation === 1) {
      await writeFile(request.outputPath, onlineBytes);
      return {
        file: request.outputPath,
        w: online.w,
        h: online.h,
        bytes: onlineBytes.length,
        warnings: [],
      };
    }
    return writeRendered(request, onlineBytes, []);
  }
  if (request.pinnedPath) {
    const pinnedBytes = await tryReadFile(request.pinnedPath);
    if (pinnedBytes) {
      return writeRendered(request, pinnedBytes, [
        {
          code: "source_offline",
          id: request.id,
          message: "Exported from the pinned embedded preview because the original is offline",
        },
      ]);
    }
  }
  throw new ExportSourceUnavailableError(request.id);
}

async function writeRendered(
  request: EmbeddedJpegExport,
  source: Uint8Array,
  warnings: ExportWarning[],
): Promise<EmbeddedJpegExportResult> {
  const image = await renderPhoto(
    { orientation: request.orientation },
    { source: "embedded", bytes: source },
  );
  const bytes = await encodeJpeg(image);
  await writeFile(request.outputPath, bytes);
  return {
    file: request.outputPath,
    w: image.w,
    h: image.h,
    bytes: bytes.length,
    warnings,
  };
}

async function encodeJpeg(image: Image16): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.w, height: image.h, channels: image.channels },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function tryReadEmbeddedBytes(location: EmbeddedJpegLocation): Promise<Buffer | undefined> {
  try {
    return await readEmbeddedBytes(location);
  } catch {
    return undefined;
  }
}

async function tryReadFile(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

async function readEmbeddedBytes(location: EmbeddedJpegLocation): Promise<Buffer> {
  const source = await open(location.path, "r");
  try {
    const bytes = Buffer.allocUnsafe(location.length);
    await readRemaining(source, bytes, location.offset, 0);
    return bytes;
  } finally {
    await source.close();
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
  if (chunk.bytesRead === 0) throw new Error("Embedded JPEG ended before its recorded length");
  await readRemaining(source, bytes, offset, read + chunk.bytesRead);
}
