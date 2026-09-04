import exifr from "exifr";
import { open, type FileHandle } from "node:fs/promises";

export interface ShotInstant {
  shotAt: Date;
  shotOffsetMin: number;
}

export interface ImportedExif {
  dimensions: { w: number; h: number };
  orientation: number;
  camera: { make: string | null; model: string | null; lens: string | null };
  exposure: {
    shutter: string | null;
    f: number | null;
    iso: number | null;
    focal_mm: number | null;
    wb: "auto" | "manual" | null;
  };
  shotAt: Date | null;
  shotOffsetMin: number | null;
}

export async function readExif(
  path: string,
  fallbackDimensions?: { w: number; h: number },
): Promise<ImportedExif> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = (await exifr.parse(path, {
      pick: [
        "Make",
        "Model",
        "Orientation",
        "ImageWidth",
        "ImageHeight",
        "ExifImageWidth",
        "ExifImageHeight",
        "DateTimeOriginal",
        "OffsetTimeOriginal",
        "ExposureTime",
        "FNumber",
        "ISO",
        "FocalLength",
        "LensModel",
        "WhiteBalance",
      ],
      reviveValues: false,
      translateValues: false,
    })) as Record<string, unknown> | undefined;
  } catch (error) {
    if (!fallbackDimensions) throw error;
  }
  const metadata = tags ?? {};

  const exifWidth = numberTag(metadata.ExifImageWidth) ?? numberTag(metadata.ImageWidth);
  const exifHeight = numberTag(metadata.ExifImageHeight) ?? numberTag(metadata.ImageHeight);
  const dimensions =
    exifWidth !== undefined && exifHeight !== undefined
      ? { w: exifWidth, h: exifHeight }
      : (fallbackDimensions ?? (await readImageDimensions(path)));
  const orientation = numberTag(metadata.Orientation) ?? 1;
  const dateTimeOriginal = stringTag(metadata.DateTimeOriginal);
  const offsetTimeOriginal = stringTag(metadata.OffsetTimeOriginal);
  const shot =
    dateTimeOriginal && offsetTimeOriginal
      ? shotInstant(dateTimeOriginal, offsetTimeOriginal)
      : undefined;

  return {
    dimensions,
    orientation,
    camera: {
      make: stringTag(metadata.Make) ?? null,
      model: stringTag(metadata.Model) ?? null,
      lens: stringTag(metadata.LensModel) ?? null,
    },
    exposure: {
      shutter: formatShutter(numberTag(metadata.ExposureTime)),
      f: numberTag(metadata.FNumber) ?? null,
      iso: numberTag(metadata.ISO) ?? null,
      focal_mm: numberTag(metadata.FocalLength) ?? null,
      wb: metadata.WhiteBalance === 0 ? "auto" : metadata.WhiteBalance === 1 ? "manual" : null,
    },
    shotAt: shot?.shotAt ?? null,
    shotOffsetMin: shot?.shotOffsetMin ?? null,
  };
}

export function shotInstant(dateTimeOriginal: string, offsetTimeOriginal: string): ShotInstant {
  const dateMatch = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(dateTimeOriginal);
  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(offsetTimeOriginal);
  if (!dateMatch || !offsetMatch) throw new Error("Invalid EXIF shot time");

  const [, year, month, day, hour, minute, second] = dateMatch.map(Number);
  const [, sign, offsetHour, offsetMinute] = offsetMatch;
  const localMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  const local = new Date(localMilliseconds);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    throw new Error("Invalid EXIF shot time");
  }

  const offsetMagnitude = Number(offsetHour) * 60 + Number(offsetMinute);
  if (
    Number(offsetHour) > 14 ||
    Number(offsetMinute) > 59 ||
    (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)
  ) {
    throw new Error("Invalid EXIF shot offset");
  }
  const shotOffsetMin = sign === "+" ? offsetMagnitude : -offsetMagnitude;
  return { shotAt: new Date(localMilliseconds - shotOffsetMin * 60_000), shotOffsetMin };
}

export function formatShotInstant(shotAt: Date, shotOffsetMin: number): string {
  const wallTime = new Date(shotAt.getTime() + shotOffsetMin * 60_000).toISOString().slice(0, 19);
  const sign = shotOffsetMin < 0 ? "-" : "+";
  const magnitude = Math.abs(shotOffsetMin);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, "0");
  const minutes = String(magnitude % 60).padStart(2, "0");
  return `${wallTime}${sign}${hours}:${minutes}`;
}

function formatShutter(seconds: number | undefined): string | null {
  if (seconds === undefined || seconds <= 0) return null;
  return seconds < 1 ? `1/${Math.round(1 / seconds)}` : `${seconds}s`;
}

function numberTag(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringTag(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function readImageDimensions(path: string): Promise<{ w: number; h: number }> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const header = await readRange(file, 0, Math.min(24, size), size);
    if (header.length >= 24 && header.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return positiveDimensions(header.readUInt32BE(16), header.readUInt32BE(20), path);
    }
    if (header.length >= 2 && header[0] === 0xff && header[1] === 0xd8) {
      return await readJpegDimensions(file, size, path, 2);
    }
    throw new Error(`Image dimensions are missing: ${path}`);
  } finally {
    await file.close();
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readJpegDimensions(
  file: FileHandle,
  size: number,
  path: string,
  position: number,
): Promise<{ w: number; h: number }> {
  if (position + 4 > size) throw new Error(`Image dimensions are missing: ${path}`);
  const marker = await readRange(file, position, 4, size);
  if (marker[0] !== 0xff) throw new Error(`Invalid JPEG marker: ${path}`);
  if (marker[1] === 0xff) return await readJpegDimensions(file, size, path, position + 1);
  if (isStartOfFrame(marker[1])) {
    const frame = await readRange(file, position + 4, 5, size);
    return positiveDimensions(frame.readUInt16BE(3), frame.readUInt16BE(1), path);
  }
  if (marker[1] === 0xd9 || marker[1] === 0xda) {
    throw new Error(`Image dimensions are missing: ${path}`);
  }
  if (marker[1] === 0xd8 || marker[1] === 0x01 || (marker[1] >= 0xd0 && marker[1] <= 0xd7)) {
    return await readJpegDimensions(file, size, path, position + 2);
  }
  const segmentLength = marker.readUInt16BE(2);
  if (segmentLength < 2) throw new Error(`Invalid JPEG segment: ${path}`);
  return await readJpegDimensions(file, size, path, position + 2 + segmentLength);
}

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function positiveDimensions(w: number, h: number, path: string): { w: number; h: number } {
  if (w <= 0 || h <= 0) throw new Error(`Invalid image dimensions: ${path}`);
  return { w, h };
}

async function readRange(
  file: FileHandle,
  offset: number,
  length: number,
  size: number,
): Promise<Buffer> {
  if (offset < 0 || length < 0 || offset + length > size) {
    throw new Error("Image header range is outside the file");
  }
  const buffer = Buffer.allocUnsafe(length);
  async function fill(read: number): Promise<void> {
    if (read === length) return;
    const chunk = await file.read(buffer, read, length - read, offset + read);
    if (chunk.bytesRead === 0) throw new Error("Image header ended unexpectedly");
    await fill(read + chunk.bytesRead);
  }
  await fill(0);
  return buffer;
}
