import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { developDictSchema, presetNameSchema, type DevelopDict } from "./dict.js";
import { canonicalDevelopJson, developHash } from "./hash.js";

export const PACKAGE_PRESETS = {
  neutral: {},
  people: {
    highlights: -20,
    shadows: 15,
    contrast: -8,
    vibrance: 10,
    saturation: -5,
    white_balance: { temp_offset_k: 150 },
    noise_reduction: { luminance: 15, color: 25 },
    sharpen: 20,
    definition: -5,
    vignette: -8,
  },
  "high-contrast": {
    contrast: 30,
    black_point: 12,
    highlights: -15,
    shadows: -10,
    definition: 20,
    saturation: 8,
    sharpen: 35,
  },
} as const satisfies Record<string, DevelopDict>;

export type PresetSource = "library" | "package";
export interface ResolvedPreset {
  name: string;
  source: PresetSource;
  develop: DevelopDict;
}

export async function loadPreset(name: string, libraryPath?: string): Promise<ResolvedPreset> {
  assertPresetName(name);
  if (libraryPath) {
    try {
      const parsed = developDictSchema.parse(
        JSON.parse(await readFile(join(presetDirectory(libraryPath), `${name}.json`), "utf8")),
      );
      return { name, source: "library", develop: parsed };
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  if (!Object.hasOwn(PACKAGE_PRESETS, name)) throw new Error(`Preset not found: ${name}`);
  const bundled = PACKAGE_PRESETS[name as keyof typeof PACKAGE_PRESETS];
  return { name, source: "package", develop: structuredClone(bundled) };
}

export async function listPresets(
  libraryPath?: string,
): Promise<Array<{ name: string; source: PresetSource }>> {
  let libraryNames: string[] = [];
  if (libraryPath) {
    try {
      libraryNames = (await readdir(presetDirectory(libraryPath), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -5))
        .filter((name) => presetNameSchema.safeParse(name).success);
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return [...new Set([...Object.keys(PACKAGE_PRESETS), ...libraryNames])]
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => ({ name, source: libraryNames.includes(name) ? "library" : "package" }));
}

export async function saveLibraryPreset(
  libraryPath: string,
  name: string,
  source: DevelopDict,
): Promise<ResolvedPreset & { develop_hash: `h_${string}` }> {
  assertPresetName(name);
  const develop = { ...source };
  delete develop.preset;
  const directory = presetDirectory(libraryPath);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${name}.json`);
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${canonicalDevelopJson(develop)}\n`, { mode: 0o600 });
    const file = await open(temporary, "r+");
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return { name, source: "library", develop, develop_hash: developHash(develop) };
}

export function presetDirectory(libraryPath: string): string {
  return join(libraryPath, "presets", "develop");
}

export function assertPresetName(name: string): void {
  if (!presetNameSchema.safeParse(name).success) throw new Error(`Invalid preset name: ${name}`);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
