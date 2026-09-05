import { z } from "zod";
import { DEVELOP_FILTER_NAMES, DEVELOP_OPERATORS, type DevelopKey } from "./keys.js";

const numeric = (path: DevelopKey) => {
  const range = DEVELOP_OPERATORS[path].range;
  if (!range) throw new Error(`Develop operator has no numeric range: ${path}`);
  return z.number().min(range[0]).max(range[1]);
};
const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const channelCurve = z
  .array(point)
  .min(2)
  .refine(
    (points) => points.every((current, index) => index === 0 || current[0] > points[index - 1][0]),
    "curve input coordinates must be strictly increasing",
  )
  .refine(
    (points) => points.every((current, index) => index === 0 || current[1] >= points[index - 1][1]),
    "curve output coordinates must be non-decreasing",
  );

export const presetNameSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u);
const selectiveAdjustment = z
  .object({
    hue: numeric("selective_color").optional(),
    saturation: numeric("selective_color").optional(),
    luminance: numeric("selective_color").optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "selective color band must contain an adjustment",
  );

export const developDictSchema = z
  .object({
    preset: presetNameSchema.optional(),
    brilliance: numeric("brilliance").optional(),
    exposure: numeric("exposure").optional(),
    highlights: numeric("highlights").optional(),
    shadows: numeric("shadows").optional(),
    brightness: numeric("brightness").optional(),
    contrast: numeric("contrast").optional(),
    black_point: numeric("black_point").optional(),
    saturation: numeric("saturation").optional(),
    vibrance: numeric("vibrance").optional(),
    cast: numeric("cast").optional(),
    white_balance: z
      .object({
        temp_offset_k: numeric("white_balance.temp_offset_k").optional(),
        tint: numeric("white_balance.tint").optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "white_balance must contain an adjustment")
      .optional(),
    curves: z
      .object({
        rgb: channelCurve.optional(),
        red: channelCurve.optional(),
        green: channelCurve.optional(),
        blue: channelCurve.optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "curves must contain a channel")
      .optional(),
    levels: z
      .object({
        black: z.number().min(0).max(1),
        midpoint: z.number().positive().max(10),
        white: z.number().min(0).max(1),
      })
      .strict()
      .refine(({ black, white }) => black < white, "levels.black must be below levels.white")
      .optional(),
    definition: numeric("definition").optional(),
    selective_color: z
      .partialRecord(
        z.enum(["red", "orange", "yellow", "green", "cyan", "blue", "magenta"]),
        selectiveAdjustment,
      )
      .refine(
        (value) => Object.keys(value).length > 0,
        "selective_color must contain an adjustment",
      )
      .optional(),
    noise_reduction: z
      .object({
        luminance: numeric("noise_reduction.luminance").optional(),
        color: numeric("noise_reduction.color").optional(),
      })
      .strict()
      .refine(
        (value) => Object.keys(value).length > 0,
        "noise_reduction must contain an adjustment",
      )
      .optional(),
    sharpen: numeric("sharpen").optional(),
    vignette: numeric("vignette").optional(),
    bw: z
      .object({
        intensity: numeric("bw.intensity").optional(),
        neutrals: numeric("bw.neutrals").optional(),
        tone: numeric("bw.tone").optional(),
        grain: numeric("bw.grain").optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "bw must contain an adjustment")
      .optional(),
    crop: z
      .object({
        x: z.number().min(0),
        y: z.number().min(0),
        w: z.number().positive(),
        h: z.number().positive(),
      })
      .strict()
      .optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    straighten_deg: numeric("straighten_deg").optional(),
    aspect_ratio: z
      .string()
      .regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/)
      .refine(
        (ratio) => ratio.split(":").every((component) => Number(component) > 0),
        "aspect_ratio components must be positive",
      )
      .optional(),
    filter: z
      .object({
        name: z.enum(DEVELOP_FILTER_NAMES),
        strength: numeric("filter.strength"),
      })
      .strict()
      .optional(),
  })
  .strict();

export type DevelopDict = z.infer<typeof developDictSchema>;

export interface DevelopMutation {
  preset?: { name: string; develop: DevelopDict };
  set?: string[];
  unset?: string[];
  reset?: boolean;
}

export function applyDevelopMutation(current: DevelopDict, mutation: DevelopMutation): DevelopDict {
  let next: Record<string, unknown> = mutation.reset ? {} : structuredClone(current);
  if (mutation.preset) {
    next = overlayRecords(next, mutation.preset.develop);
    next.preset = mutation.preset.name;
  }
  for (const assignment of mutation.set ?? []) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid develop assignment: ${assignment}`);
    const path = assignment.slice(0, separator) as DevelopKey;
    assertKey(path);
    setPath(next, path, parseValue(assignment.slice(separator + 1)));
  }
  for (const path of mutation.unset ?? []) {
    assertKey(path as DevelopKey);
    unsetPath(next, path);
  }
  return developDictSchema.parse(pruneEmpty(next));
}

function overlayRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged = structuredClone(base);
  for (const [key, value] of Object.entries(overlay)) {
    merged[key] =
      isRecord(value) && isRecord(merged[key])
        ? overlayRecords(merged[key], value)
        : structuredClone(value);
  }
  return merged;
}

function assertKey(path: DevelopKey): void {
  if (!Object.hasOwn(DEVELOP_OPERATORS, path)) throw new Error(`Unknown develop key: ${path}`);
}

function parseValue(source: string): unknown {
  if (source === "") throw new Error("Develop values must not be empty");
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const [head, tail] = path.split(".", 2);
  if (!tail) {
    target[head] = value;
    return;
  }
  const parent = isRecord(target[head]) ? structuredClone(target[head]) : {};
  parent[tail] = value;
  target[head] = parent;
}

function unsetPath(target: Record<string, unknown>, path: string): void {
  const [head, tail] = path.split(".", 2);
  if (!tail) {
    delete target[head];
    return;
  }
  if (!isRecord(target[head])) return;
  const parent = structuredClone(target[head]);
  delete parent[tail];
  if (Object.keys(parent).length === 0) delete target[head];
  else target[head] = parent;
}

function pruneEmpty(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (!isRecord(item)) return [[key, item]];
      const pruned = pruneEmpty(item);
      return Object.keys(pruned).length === 0 ? [] : [[key, pruned]];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
