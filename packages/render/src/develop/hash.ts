import { createHash } from "node:crypto";
import type { DevelopDict } from "./dict.js";

export function canonicalDevelopJson(dict: DevelopDict): string {
  const settings = { ...dict };
  delete settings.preset;
  return JSON.stringify(sortValue(settings));
}

export function developHash(dict: DevelopDict): `h_${string}` {
  return `h_${createHash("sha256").update(canonicalDevelopJson(dict)).digest("hex")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
