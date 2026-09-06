import { basename, dirname, extname, join } from "node:path";
import { probeImage, type ImageProbe } from "./formats.js";
import { consumeBoundedOrdered } from "./pipeline.js";

export type CompanionMode = "paired" | "raw" | "jpeg" | "both";
export interface ImportSource {
  path: string;
  probe: ImageProbe | undefined;
}
export interface ImportUnit {
  sources: ImportSource[];
  conflict?: string;
}

/** Pair membership comes from the requested directory roster, never the catalog or another folder. */
export async function planImportSources(
  paths: string[],
  mode: CompanionMode,
  inspected?: (done: number) => void | Promise<void>,
): Promise<ImportUnit[]> {
  const sources: ImportSource[] = [];
  await consumeBoundedOrdered(
    paths,
    4,
    async (path) => ({ path, probe: await probeImage(path) }),
    async (source) => {
      sources.push(source);
      await inspected?.(sources.length);
    },
  );
  if (mode === "both") return sources.map((source) => ({ sources: [source] }));
  const stems = new Map<string, ImportSource[]>();
  for (const source of sources) {
    const key = join(
      dirname(source.path),
      basename(source.path, extname(source.path)).toLowerCase(),
    );
    const group = stems.get(key) ?? [];
    group.push(source);
    stems.set(key, group);
  }
  const grouped = new Map<ImportSource, ImportUnit>();
  for (const group of stems.values()) {
    const raws = group.filter((source) => source.probe?.kind === "raw");
    const jpegs = group.filter((source) => source.probe?.mediaType === "image/jpeg");
    if (raws.length === 0 || jpegs.length === 0) continue;
    const members = [...raws, ...jpegs];
    const selected = mode === "paired" ? members : mode === "raw" ? raws : jpegs;
    const ambiguous =
      mode === "paired" ? raws.length !== 1 || jpegs.length !== 1 : selected.length !== 1;
    const unit: ImportUnit = ambiguous
      ? { sources: members, conflict: "RAW/JPEG companions are ambiguous" }
      : { sources: selected };
    for (const source of members) grouped.set(source, unit);
  }
  const consumed = new Set<ImportUnit>();
  const units: ImportUnit[] = [];
  for (const source of sources) {
    const unit = grouped.get(source) ?? { sources: [source] };
    if (consumed.has(unit)) continue;
    consumed.add(unit);
    units.push(unit);
  }
  return units;
}
