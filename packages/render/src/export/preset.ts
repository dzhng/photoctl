import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryMetadata } from "./metadata.js";
import type { ExportCollisionPolicy } from "./collision.js";
import type { ExportFormat } from "./run.js";

export interface ExportPreset {
  to?: string;
  format?: ExportFormat;
  quality?: number;
  resize?: number;
  template?: string;
  onCollision?: ExportCollisionPolicy;
  metadata?: DeliveryMetadata;
}

export class ExportPresetError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export async function loadExportPreset(name: string, libraryPath: string): Promise<ExportPreset> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name)) {
    throw new ExportPresetError(
      "invalid",
      "Export preset names may contain letters, numbers, _ and -",
    );
  }
  const library = await readPreset(join(libraryPath, "presets", "export", `${name}.json`), name);
  if (library) return library;
  const packaged = await readPreset(
    fileURLToPath(new URL(`../../data/export/${name}.json`, import.meta.url)),
    name,
  );
  if (packaged) return packaged;
  throw new ExportPresetError("not_found", `Export preset not found: ${name}`);
}

async function readPreset(path: string, name: string): Promise<ExportPreset | undefined> {
  try {
    return validatePreset(JSON.parse(await readFile(path, "utf8")) as unknown, name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof ExportPresetError) throw error;
    throw new ExportPresetError("invalid", `Invalid export preset ${name}: ${String(error)}`);
  }
}

function validatePreset(value: unknown, name: string): ExportPreset {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExportPresetError("invalid", `Export preset ${name} must be a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([
    "to",
    "format",
    "quality",
    "resize",
    "template",
    "on-collision",
    "iptc",
  ]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown)
    throw new ExportPresetError("invalid", `Export preset ${name} has unknown option: ${unknown}`);
  return {
    ...(record.to === undefined ? {} : { to: text(record.to, "to") }),
    ...(record.format === undefined ? {} : { format: format(record.format) }),
    ...(record.quality === undefined ? {} : { quality: quality(record.quality) }),
    ...(record.resize === undefined ? {} : { resize: resize(record.resize) }),
    ...(record.template === undefined ? {} : { template: text(record.template, "template") }),
    ...(record["on-collision"] === undefined
      ? {}
      : { onCollision: collision(record["on-collision"]) }),
    ...(record.iptc === undefined ? {} : { metadata: metadata(record.iptc) }),
  };
}

function format(value: unknown): ExportFormat {
  if (value === "jpeg" || value === "png" || value === "tiff") return value;
  throw new ExportPresetError("invalid", "Export preset format must be jpeg, png, or tiff");
}

function collision(value: unknown): ExportCollisionPolicy {
  if (value === "skip" || value === "overwrite" || value === "rename") return value;
  throw new ExportPresetError(
    "invalid",
    "Export preset on-collision must be skip, overwrite, or rename",
  );
}

function quality(value: unknown): number {
  if (Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 100)
    return Number(value);
  throw new ExportPresetError(
    "invalid",
    "Export preset quality must be an integer from 1 through 100",
  );
}

function resize(value: unknown): number {
  if (Number.isSafeInteger(value) && Number(value) >= 1) return Number(value);
  throw new ExportPresetError("invalid", "Export preset resize must be a positive integer");
}

function text(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new ExportPresetError("invalid", `Export preset ${field} must be a non-empty string`);
}

function metadata(value: unknown): DeliveryMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExportPresetError("invalid", "Export preset iptc must be an object");
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find((key) => key !== "creator" && key !== "copyright");
  if (unknown)
    throw new ExportPresetError("invalid", `Export preset iptc has unknown field: ${unknown}`);
  return {
    ...(record.creator === undefined ? {} : { creator: text(record.creator, "iptc.creator") }),
    ...(record.copyright === undefined
      ? {}
      : { copyright: text(record.copyright, "iptc.copyright") }),
  };
}
