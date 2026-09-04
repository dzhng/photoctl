import { open, readFile, type FileHandle } from "node:fs/promises";
import type { ExifOrientation } from "./coordinates.js";

interface LocatedImageSource {
  path: string;
  mediaType: string;
  w: number;
  h: number;
  copyExact?: boolean;
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
