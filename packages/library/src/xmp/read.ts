import { XMLParser } from "fast-xml-parser";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { readFileSnapshot, type SnapshotHooks } from "./snapshot.js";

export type CullLabel = "red" | "yellow" | "green" | "blue" | "purple";
export type CullFlag = "pick" | "reject" | "none";

export interface ParsedXmp {
  rating?: number;
  label?: CullLabel | null;
  flag?: CullFlag;
  tags: string[];
  labelUnknown?: string;
}

export interface ReadXmp extends ParsedXmp {
  path: string;
  mtime: Date;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: false,
  trimValues: true,
});

export function parseXmp(xml: string): ParsedXmp {
  const document = parser.parse(xml) as unknown;
  const ratingValue = firstValue(document, "xmp:Rating");
  const labelValue = firstValue(document, "xmp:Label");
  const ownsFlagNamespace = allValues(document, "xmlns:photoctl").includes(
    "http://photoctl.dev/xmp/1.0/",
  );
  const flagValue = ownsFlagNamespace
    ? firstValue(document, "photoctl:flag")?.toLowerCase()
    : undefined;
  const label = labelValue?.toLowerCase();
  const mappedLabel = isCullLabel(label) ? label : labelValue === undefined ? undefined : null;
  const subject = allValues(document, "dc:subject");
  const hierarchical = allValues(document, "lr:hierarchicalSubject").map(
    (value) => value.split("|").at(-1) ?? value,
  );
  const tags = [...new Set([...subject, ...hierarchical])];
  const rating = ratingValue === undefined ? undefined : Number(ratingValue);
  return {
    ...(rating !== undefined && Number.isInteger(rating) && rating >= 0 && rating <= 5
      ? { rating }
      : {}),
    ...(mappedLabel !== undefined ? { label: mappedLabel } : {}),
    ...(isCullFlag(flagValue) ? { flag: flagValue } : {}),
    tags,
    ...(labelValue !== undefined && mappedLabel === null ? { labelUnknown: labelValue } : {}),
  };
}

export async function readXmpSidecar(imagePath: string): Promise<ReadXmp | undefined> {
  return await readXmpPath(sidecarPathForImage(imagePath));
}

export async function readXmpPath(
  path: string,
  hooks: SnapshotHooks = {},
): Promise<ReadXmp | undefined> {
  const snapshot = await readFileSnapshot(path, hooks);
  if (!snapshot) return undefined;
  return { ...parseXmp(snapshot.text), path, mtime: snapshot.mtime };
}

export function sidecarPathForImage(imagePath: string): string {
  const extension = extname(imagePath);
  return `${imagePath.slice(0, imagePath.length - extension.length)}.xmp`;
}

export async function xmpStateIsStale(path: string, storedMtime: string | Date): Promise<boolean> {
  try {
    return (await stat(path)).mtime.getTime() !== new Date(storedMtime).getTime();
  } catch {
    return true;
  }
}

function firstValue(value: unknown, key: string): string | undefined {
  return allValues(value, key)[0];
}

function allValues(value: unknown, key: string): string[] {
  if (typeof value === "string" || typeof value === "number") return [];
  if (Array.isArray(value)) return value.flatMap((item) => allValues(item, key));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return Object.entries(record).flatMap(([name, child]) => {
    const nested = allValues(child, key);
    if (name.replace(/^@/, "") !== key) return nested;
    return [...textValues(child), ...nested];
  });
}

function textValues(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if ("#text" in record) return textValues(record["#text"]);
  const list = record["rdf:Bag"] ?? record["rdf:Seq"] ?? record["rdf:Alt"];
  if (list && typeof list === "object") {
    return textValues((list as Record<string, unknown>)["rdf:li"]);
  }
  return [];
}

function isCullLabel(value: string | undefined): value is CullLabel {
  return value !== undefined && ["red", "yellow", "green", "blue", "purple"].includes(value);
}

function isCullFlag(value: string | undefined): value is CullFlag {
  return value !== undefined && ["pick", "reject", "none"].includes(value);
}
