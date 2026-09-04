import exifr from "exifr";

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

export async function readExif(path: string): Promise<ImportedExif> {
  const tags = (await exifr.parse(path, {
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
  if (!tags) throw new Error(`No EXIF metadata found: ${path}`);

  const width = numberTag(tags.ExifImageWidth) ?? numberTag(tags.ImageWidth);
  const height = numberTag(tags.ExifImageHeight) ?? numberTag(tags.ImageHeight);
  if (width === undefined || height === undefined) {
    throw new Error(`EXIF dimensions are missing: ${path}`);
  }
  const orientation = numberTag(tags.Orientation) ?? 1;
  const dateTimeOriginal = stringTag(tags.DateTimeOriginal);
  const offsetTimeOriginal = stringTag(tags.OffsetTimeOriginal);
  const shot =
    dateTimeOriginal && offsetTimeOriginal
      ? shotInstant(dateTimeOriginal, offsetTimeOriginal)
      : undefined;

  return {
    dimensions: { w: width, h: height },
    orientation,
    camera: {
      make: stringTag(tags.Make) ?? null,
      model: stringTag(tags.Model) ?? null,
      lens: stringTag(tags.LensModel) ?? null,
    },
    exposure: {
      shutter: formatShutter(numberTag(tags.ExposureTime)),
      f: numberTag(tags.FNumber) ?? null,
      iso: numberTag(tags.ISO) ?? null,
      focal_mm: numberTag(tags.FocalLength) ?? null,
      wb: tags.WhiteBalance === 0 ? "auto" : tags.WhiteBalance === 1 ? "manual" : null,
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
  if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) {
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
