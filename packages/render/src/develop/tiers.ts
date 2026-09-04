import type { DevelopDict } from "./dict.js";
import { DEVELOP_OPERATORS, type DevelopKey, type DevelopTier } from "./keys.js";

export const DEVELOP_TIERS = Object.freeze(
  Object.fromEntries(
    (Object.entries(DEVELOP_OPERATORS) as Array<[DevelopKey, { tier: DevelopTier }]>).map(
      ([key, operator]) => [key, operator.tier],
    ),
  ) as Record<DevelopKey, DevelopTier>,
);

export const WHITE_BALANCE_TIER_ONE_MAX_DELTA_K = 300;

export function classifyDevelopChange(before: DevelopDict, after: DevelopDict): DevelopTier | null {
  const changed = changedPaths(before, after);
  if (changed.length === 0) return null;
  if (changed.some((path) => DEVELOP_TIERS[path] === 2)) return 2;
  if (changed.some((path) => path.startsWith("white_balance."))) {
    const beforeTemp = before.white_balance?.temp_offset_k ?? 0;
    const afterTemp = after.white_balance?.temp_offset_k ?? 0;
    if (Math.abs(afterTemp - beforeTemp) > WHITE_BALANCE_TIER_ONE_MAX_DELTA_K) return 2;
  }
  return 1;
}

function changedPaths(before: DevelopDict, after: DevelopDict): DevelopKey[] {
  return (Object.keys(DEVELOP_OPERATORS) as DevelopKey[]).filter(
    (path) => JSON.stringify(readPath(before, path)) !== JSON.stringify(readPath(after, path)),
  );
}

function readPath(value: DevelopDict, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, part) =>
        current !== null && typeof current === "object"
          ? (current as Record<string, unknown>)[part]
          : undefined,
      value,
    );
}
