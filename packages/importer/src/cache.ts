import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function cacheRootForLibrary(libraryId: string, baseOverride?: string): string {
  const base = baseOverride
    ? resolve(baseOverride)
    : join(homedir(), "Library", "Caches", "photoctl");
  return join(base, libraryId);
}
