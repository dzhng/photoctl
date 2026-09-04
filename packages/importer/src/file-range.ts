import type { FileHandle } from "node:fs/promises";

export async function readFileRange(
  file: FileHandle,
  offset: number,
  length: number,
  fileSize: number,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > fileSize
  ) {
    throw new Error("File range is outside the file");
  }
  const buffer = Buffer.allocUnsafe(length);
  await fillBuffer(file, buffer, 0, offset);
  return buffer;
}

async function fillBuffer(
  file: FileHandle,
  buffer: Buffer,
  written: number,
  position: number,
): Promise<void> {
  if (written === buffer.length) return;
  const { bytesRead } = await file.read(buffer, written, buffer.length - written, position);
  if (bytesRead === 0) throw new Error("File data is truncated");
  await fillBuffer(file, buffer, written + bytesRead, position + bytesRead);
}
