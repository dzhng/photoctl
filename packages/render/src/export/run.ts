import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import type { ExifOrientation } from "../coordinates.js";
import { readImageSource, type ImageSource } from "../decoder.js";
import { renderPhoto, type Image16 } from "../graph.js";

export interface ImageExport {
  id: string;
  orientation: ExifOrientation;
  outputPath: string;
  sources: ImageSource[];
}

export interface ExportWarning {
  code: "source_offline";
  id: string;
  message: string;
}

export interface ImageExportResult {
  file: string;
  w: number;
  h: number;
  bytes: number;
  warnings: ExportWarning[];
}

export class ExportSourceUnavailableError extends Error {
  readonly code = "file_offline";

  constructor(readonly photoId: string) {
    super(`No usable image source is available for ${photoId}`);
  }
}

export class ExportRenderError extends Error {
  readonly code = "decoder_unavailable";

  constructor(readonly photoId: string) {
    super(`The embedded JPEG for ${photoId} could not be rendered`);
  }
}

export class ExportInputError extends Error {
  readonly code = "unsupported_file";

  constructor(readonly photoId: string) {
    super(`The source image for ${photoId} is invalid or unsupported`);
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

/** Writes to `outputPath`; the caller owns its parent directory and collision policy. */
export async function exportImageAsJpeg(request: ImageExport): Promise<ImageExportResult> {
  const online = request.sources.find((source) => source.kind !== "pinned-preview");
  const onlineBytes = online ? await tryReadSourceBytes(online) : undefined;
  if (online && onlineBytes) {
    if (
      request.orientation === 1 &&
      online.copyExact !== false &&
      (await exactCopyIsJpeg(request, onlineBytes))
    ) {
      await writeOutput(request, onlineBytes);
      return {
        file: request.outputPath,
        w: online.w,
        h: online.h,
        bytes: onlineBytes.length,
        warnings: [],
      };
    }
    return writeRendered(request, online, [], "online");
  }
  const pinned = request.sources.find((source) => source.kind === "pinned-preview");
  if (pinned) {
    const pinnedBytes = await tryReadSourceBytes(pinned);
    if (pinnedBytes) {
      return writeRendered(
        request,
        pinned,
        [
          {
            code: "source_offline",
            id: request.id,
            message: "Exported from the pinned preview because the original is offline",
          },
        ],
        "pinned",
      );
    }
  }
  throw new ExportSourceUnavailableError(request.id);
}

async function writeRendered(
  request: ImageExport,
  source: ImageSource,
  warnings: ExportWarning[],
  sourceKind: "online" | "pinned",
): Promise<ImageExportResult> {
  let image: Image16;
  try {
    image = await renderPhoto({ orientation: request.orientation }, source);
  } catch {
    if (sourceKind === "pinned") throw new ExportSourceUnavailableError(request.id);
    throw new ExportInputError(request.id);
  }
  let bytes: Buffer;
  try {
    bytes = await encodeJpeg(image);
  } catch {
    throw new ExportRenderError(request.id);
  }
  await writeOutput(request, bytes);
  return {
    file: request.outputPath,
    w: image.w,
    h: image.h,
    bytes: bytes.length,
    warnings,
  };
}

async function exactCopyIsJpeg(request: ImageExport, bytes: Uint8Array): Promise<boolean> {
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    await sharp(bytes, { failOn: "error" }).stats();
    return metadata.format === "jpeg";
  } catch {
    throw new ExportInputError(request.id);
  }
}

async function writeOutput(request: ImageExport, bytes: Uint8Array): Promise<void> {
  try {
    await writeFile(request.outputPath, bytes);
  } catch {
    throw new ExportWriteError(request.id, request.outputPath);
  }
}

async function encodeJpeg(image: Image16): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    bytes[index] = Math.round(image.data[index] / 257);
  }
  return sharp(bytes, {
    raw: { width: image.w, height: image.h, channels: image.channels },
  })
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function tryReadSourceBytes(source: ImageSource): Promise<Buffer | undefined> {
  try {
    return await readImageSource(source);
  } catch {
    return undefined;
  }
}
