import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

export async function scanCandidates(path: string, recursive = false): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) return extname(path).toLowerCase() === ".xmp" ? [] : [path];
  if (!metadata.isDirectory()) return [];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !entry.isSymbolicLink())
      .map(async (entry) => {
        if (entry.isDirectory() && !recursive) return [];
        return await scanCandidates(join(path, entry.name), recursive);
      }),
  );
  return nested.flat().toSorted();
}
