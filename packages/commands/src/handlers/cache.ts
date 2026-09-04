import { CachePruneError, cacheRootForLibrary, pruneCache } from "@photoctl/importer";
import { CacheIndex, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type CachePruneData, type Envelope } from "@photoctl/protocol";
import { PreviewCoordinator } from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { parseByteSize } from "../byte-size.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";

export async function cacheCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedCoordinator?: PreviewCoordinator,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--max"] });
  if (parsed.positionals.length !== 1 || parsed.positionals[0] !== "prune") {
    throw new PhotoctlError("usage", "cache requires exactly: prune [--max <bytes>]");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const max = parsed.options.has("--max")
      ? parseByteSize(parsed.options.get("--max")!, true)
      : await configuredMaximum(handle);
    const libraryId = await readLibraryId(handle);
    const root = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    const index = new CacheIndex(handle, root);
    const coordinator = providedCoordinator ?? new PreviewCoordinator();
    let result;
    try {
      result = await pruneCache({
        root,
        maxBytes: max,
        index,
        coordinator,
      });
    } catch (error) {
      if (error instanceof CachePruneError) {
        throw new PhotoctlError("volume_readonly", error.message, { path: error.path });
      }
      throw error;
    }
    return {
      schema: 1,
      ok: true,
      data: {
        removed: result.removed,
        freed_bytes: result.freedBytes,
        remaining_bytes: result.remainingBytes,
        max_bytes: result.maxBytes,
      } satisfies CachePruneData,
      warnings: [],
    };
  } finally {
    await lease.release();
  }
}

async function configuredMaximum(handle: LibraryHandle): Promise<number> {
  const result = await handle.query<{ value: number }>(
    "SELECT value::text::bigint AS value FROM settings WHERE key = 'cache_max_bytes'",
  );
  const value = Number(result.rows[0]?.value);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Cache maximum is missing");
  return value;
}
