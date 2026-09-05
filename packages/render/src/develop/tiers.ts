import { developDictSchema, type DevelopDict } from "./dict.js";
import { DEVELOP_OPERATORS, type DevelopKey, type DevelopTier } from "./keys.js";

export const DEVELOP_TIERS = Object.freeze(
  Object.fromEntries(
    (Object.entries(DEVELOP_OPERATORS) as Array<[DevelopKey, { tier: DevelopTier }]>).map(
      ([key, operator]) => [key, operator.tier],
    ),
  ) as Record<DevelopKey, DevelopTier>,
);

export const WHITE_BALANCE_TIER_ONE_MAX_DELTA_K = 300;

export type DevelopChangePlan =
  | { tier: 1; compensations: DevelopDict[] }
  | { tier: 2; compensations: null }
  | null;

export function classifyDevelopChange(before: DevelopDict, after: DevelopDict): DevelopTier | null {
  return planDevelopChange(before, after)?.tier ?? null;
}

export function applyDevelopCompensation(
  before: DevelopDict,
  compensation: DevelopDict,
): DevelopDict {
  const next = structuredClone(before) as Record<string, unknown>;
  for (const path of Object.keys(DEVELOP_OPERATORS) as DevelopKey[]) {
    const amount = readPath(compensation, path);
    if (amount === undefined) continue;
    const previous = Number(readPath(before, path) ?? 0);
    let value = previous + Number(amount);
    if (path === "saturation") {
      value = ((1 + previous / 100) * (1 + Number(amount) / 100) - 1) * 100;
    } else if (path === "black_point") {
      const previousPivot = previous * 0.002;
      value = (previousPivot + Number(amount) * 0.002 * (1 - previousPivot)) / 0.002;
    }
    setPath(next, path, value);
  }
  return developDictSchema.parse(next);
}

export function planDevelopChange(before: DevelopDict, after: DevelopDict): DevelopChangePlan {
  const changed = changedPaths(before, after);
  if (changed.length === 0) return null;
  if (changed.some((path) => DEVELOP_TIERS[path] === 2)) {
    return { tier: 2, compensations: null };
  }
  if (changed.some((path) => path.startsWith("white_balance."))) {
    const beforeTemp = before.white_balance?.temp_offset_k ?? 0;
    const afterTemp = after.white_balance?.temp_offset_k ?? 0;
    if (Math.abs(afterTemp - beforeTemp) > WHITE_BALANCE_TIER_ONE_MAX_DELTA_K) {
      return { tier: 2, compensations: null };
    }
  }
  const active = (Object.keys(DEVELOP_OPERATORS) as DevelopKey[]).filter(
    (path) => Number(readPath(before, path) ?? 0) !== 0 || Number(readPath(after, path) ?? 0) !== 0,
  );
  const startsAtIdentity = active.every((path) => Number(readPath(before, path) ?? 0) === 0);
  if (!startsAtIdentity && (active.length !== 1 || changed.length !== 1)) {
    return { tier: 2, compensations: null };
  }
  const differences = changed
    .map((path) => ({ path, value: compensationValue(path, before, after, startsAtIdentity) }))
    .filter(({ value }) => value !== 0);
  if (differences.some(({ value }) => value === null)) {
    return { tier: 2, compensations: null };
  }
  if (differences.length === 0) return null;
  const steps = Math.max(
    ...differences.map(({ path, value }) => {
      const range = DEVELOP_OPERATORS[path].range!;
      if (value === null) return 1;
      const limit = value > 0 ? range[1] : Math.abs(range[0]);
      return Math.ceil(Math.abs(value) / limit);
    }),
  );
  const compensations = Array.from({ length: steps }, () => {
    const compensation: Record<string, unknown> = {};
    for (const { path, value } of differences) {
      if (value !== null) setPath(compensation, path, splitCompensation(path, value, steps));
    }
    return developDictSchema.parse(compensation);
  });
  return { tier: 1, compensations };
}

function splitCompensation(path: DevelopKey, value: number, steps: number): number {
  if (path === "saturation") {
    return (Math.pow(1 + value / 100, 1 / steps) - 1) * 100;
  }
  if (path === "black_point") {
    return (1 - Math.pow(1 - value * 0.002, 1 / steps)) / 0.002;
  }
  return value / steps;
}

function compensationValue(
  path: DevelopKey,
  before: DevelopDict,
  after: DevelopDict,
  startsAtIdentity: boolean,
): number | null {
  const previous = Number(readPath(before, path) ?? 0);
  const next = Number(readPath(after, path) ?? 0);
  if (startsAtIdentity) return next;
  if (path === "saturation") {
    const previousFactor = 1 + previous / 100;
    return previousFactor === 0 ? null : ((1 + next / 100) / previousFactor - 1) * 100;
  }
  if (path === "black_point") {
    const previousPivot = previous * 0.002;
    return (next * 0.002 - previousPivot) / (1 - previousPivot) / 0.002;
  }
  if (path === "vibrance") return null;
  return next - previous;
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

function setPath(target: Record<string, unknown>, path: string, value: number): void {
  const [head, tail] = path.split(".", 2);
  if (!tail) {
    target[head] = value;
    return;
  }
  const parent = (target[head] ?? {}) as Record<string, unknown>;
  parent[tail] = value;
  target[head] = parent;
}
