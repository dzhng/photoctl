import { open, type FileHandle } from "node:fs/promises";
import { readFileRange } from "./file-range.js";

export interface EmbeddedJpeg {
  width: number;
  height: number;
  offset: number;
  length: number;
}

interface TiffReader {
  file: FileHandle;
  size: number;
  littleEndian: boolean;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  value: number;
}

export async function indexEmbeddedJpegs(path: string): Promise<EmbeddedJpeg[]> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const header = await readFileRange(file, 0, 8, size);
    const byteOrder = header.toString("ascii", 0, 2);
    if (byteOrder !== "II" && byteOrder !== "MM") throw new Error("Not a TIFF file");
    const reader = { file, size, littleEndian: byteOrder === "II" };
    if (uint16(header, 2, reader.littleEndian) !== 42) throw new Error("Not a TIFF file");

    const previews: EmbeddedJpeg[] = [];
    await visitIfds(reader, [uint32(header, 4, reader.littleEndian)], new Set(), previews);
    return previews.toSorted(
      (left, right) =>
        left.width * left.height - right.width * right.height || left.offset - right.offset,
    );
  } finally {
    await file.close();
  }
}

async function visitIfds(
  reader: TiffReader,
  queue: number[],
  seen: Set<number>,
  previews: EmbeddedJpeg[],
): Promise<void> {
  const offset = queue.shift();
  if (offset === undefined) return;
  if (offset === 0 || seen.has(offset)) return visitIfds(reader, queue, seen, previews);
  seen.add(offset);

  const countBytes = await readFileRange(reader.file, offset, 2, reader.size);
  const count = uint16(countBytes, 0, reader.littleEndian);
  const table = await readFileRange(reader.file, offset + 2, count * 12 + 4, reader.size);
  const entries = Array.from({ length: count }, (_, index) =>
    readEntry(table, index * 12, reader.littleEndian),
  );

  const jpegOffset = singleLong(entries, 0x0201);
  const jpegLength = singleLong(entries, 0x0202);
  if (jpegOffset !== undefined && jpegLength !== undefined) {
    const dimensions = await jpegDimensions(reader, jpegOffset, jpegLength);
    if (
      !previews.some((preview) => preview.offset === jpegOffset && preview.length === jpegLength)
    ) {
      previews.push({ ...dimensions, offset: jpegOffset, length: jpegLength });
    }
  }

  const pointers = entries.filter((entry) => entry.tag === 0x014a || entry.tag === 0x8769);
  const nested = await Promise.all(pointers.map((entry) => longValues(reader, entry)));
  queue.push(...nested.flat());
  queue.push(uint32(table, count * 12, reader.littleEndian));
  await visitIfds(reader, queue, seen, previews);
}

function readEntry(buffer: Buffer, offset: number, littleEndian: boolean): IfdEntry {
  return {
    tag: uint16(buffer, offset, littleEndian),
    type: uint16(buffer, offset + 2, littleEndian),
    count: uint32(buffer, offset + 4, littleEndian),
    value: uint32(buffer, offset + 8, littleEndian),
  };
}

function singleLong(entries: IfdEntry[], tag: number): number | undefined {
  const entry = entries.find((candidate) => candidate.tag === tag);
  return entry?.type === 4 && entry.count === 1 ? entry.value : undefined;
}

async function longValues(reader: TiffReader, entry: IfdEntry): Promise<number[]> {
  if (entry.type !== 4 || entry.count === 0) return [];
  if (entry.count === 1) return [entry.value];
  const values = await readFileRange(reader.file, entry.value, entry.count * 4, reader.size);
  return Array.from({ length: entry.count }, (_, index) =>
    uint32(values, index * 4, reader.littleEndian),
  );
}

async function jpegDimensions(
  reader: TiffReader,
  offset: number,
  length: number,
): Promise<{ width: number; height: number }> {
  if (length < 4) throw new Error("Invalid embedded JPEG range");
  const signature = await readFileRange(reader.file, offset, 2, reader.size);
  const ending = await readFileRange(reader.file, offset + length - 2, 2, reader.size);
  if (signature[0] !== 0xff || signature[1] !== 0xd8 || ending[0] !== 0xff || ending[1] !== 0xd9) {
    throw new Error("Invalid embedded JPEG range");
  }
  return findJpegDimensions(reader, offset + 2, offset + length);
}

async function findJpegDimensions(
  reader: TiffReader,
  position: number,
  end: number,
): Promise<{ width: number; height: number }> {
  if (position + 2 > end) throw new Error("Embedded JPEG dimensions not found");
  const marker = await readFileRange(reader.file, position, 2, reader.size);
  if (marker[0] !== 0xff) throw new Error("Invalid embedded JPEG marker");
  if (marker[1] === 0xff) return findJpegDimensions(reader, position + 1, end);

  const code = marker[1];
  if (isStartOfFrame(code)) {
    const header = await readFileRange(reader.file, position + 2, 7, reader.size);
    const height = header.readUInt16BE(3);
    const width = header.readUInt16BE(5);
    if (width === 0 || height === 0) throw new Error("Invalid embedded JPEG dimensions");
    return { width, height };
  }
  if (code === 0xd9 || code === 0xda) throw new Error("Embedded JPEG dimensions not found");
  if (code === 0xd8 || code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
    return findJpegDimensions(reader, position + 2, end);
  }

  const lengthBytes = await readFileRange(reader.file, position + 2, 2, reader.size);
  const segmentLength = lengthBytes.readUInt16BE(0);
  if (segmentLength < 2 || position + 2 + segmentLength > end) {
    throw new Error("Invalid embedded JPEG segment");
  }
  return findJpegDimensions(reader, position + 2 + segmentLength, end);
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function uint16(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function uint32(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}
