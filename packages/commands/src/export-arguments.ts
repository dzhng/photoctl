import { PhotoctlError } from "@photoctl/protocol";
import type {
  DeliveryMetadata,
  ExportCollisionPolicy,
  ExportFormat,
  ExportPreset,
} from "@photoctl/render";

export interface ExportOverrides extends ExportPreset {
  preset?: string;
}

export function parseExportArguments(args: string[]): {
  inputs: string[];
  overrides: ExportOverrides;
} {
  const inputs: string[] = [];
  const overrides: ExportOverrides = {};
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      inputs.push(argument);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new PhotoctlError("usage", `${argument} requires a value`);
    if (argument !== "--iptc" && seen.has(argument))
      throw new PhotoctlError("usage", `Duplicate option: ${argument}`);
    seen.add(argument);
    index += 1;
    if (argument === "--to") overrides.to = value;
    else if (argument === "--format") overrides.format = parseFormat(value);
    else if (argument === "--quality") overrides.quality = parseQuality(value);
    else if (argument === "--resize") overrides.resize = parseResize(value);
    else if (argument === "--template") overrides.template = value;
    else if (argument === "--on-collision") overrides.onCollision = parseCollision(value);
    else if (argument === "--preset") overrides.preset = value;
    else if (argument === "--iptc") overrides.metadata = parseMetadata(value, overrides.metadata);
    else throw new PhotoctlError("usage", `Unexpected argument: ${argument}`);
  }
  return { inputs, overrides };
}

function parseFormat(value: string): ExportFormat {
  if (value === "jpeg" || value === "png" || value === "tiff") return value;
  throw new PhotoctlError("usage", "--format must be jpeg, png, or tiff");
}

function parseCollision(value: string): ExportCollisionPolicy {
  if (value === "skip" || value === "overwrite" || value === "rename") return value;
  throw new PhotoctlError("usage", "--on-collision must be skip, overwrite, or rename");
}

function parseQuality(value: string): number {
  const quality = Number(value);
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 100) {
    throw new PhotoctlError("usage", "--quality must be an integer from 1 through 100");
  }
  return quality;
}

function parseResize(value: string): number {
  const resize = Number(value);
  if (!Number.isSafeInteger(resize) || resize < 1)
    throw new PhotoctlError("usage", "--resize must be a positive integer");
  return resize;
}

function parseMetadata(value: string, current?: DeliveryMetadata): DeliveryMetadata {
  const [field, ...rest] = value.split("=");
  const fieldValue = rest.join("=");
  if ((field !== "creator" && field !== "copyright") || fieldValue.length === 0) {
    throw new PhotoctlError("usage", "--iptc must be creator=… or copyright=…");
  }
  return { ...current, [field]: fieldValue };
}
