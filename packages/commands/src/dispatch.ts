import {
  PhotoctlError,
  type CommandRequest,
  type DoctorData,
  type Envelope,
  type InitData,
} from "@photoctl/protocol";
import {
  databaseDescription,
  DEFAULT_CACHE_MAX_BYTES,
  initializeLibrary,
  openLibrary,
  readLibraryDiagnostics,
} from "@photoctl/library";
import { cacheRootForLibrary } from "@photoctl/importer";
import { homedir } from "node:os";
import { join } from "node:path";
export interface DispatchContext {
  version: string;
}
export async function dispatch(
  request: CommandRequest,
  context: DispatchContext,
): Promise<Envelope> {
  try {
    if (request.verb === "version") {
      return { schema: 1, ok: true, data: { version: context.version }, warnings: [] };
    }
    if (request.verb === "init") {
      const options = parseOptions(request.args, ["--path", "--cache-max"]);
      const path = options.get("--path") ?? join(homedir(), "Pictures", "photoctl");
      const cacheMax = options.get("--cache-max");
      const initialized = await initializeLibrary(
        path,
        cacheMax ? parseByteSize(cacheMax) : DEFAULT_CACHE_MAX_BYTES,
      );
      try {
        return {
          schema: 1,
          ok: true,
          data: {
            library: initialized.handle.path,
            db: await databaseDescription(initialized.handle),
            cache_max_bytes: initialized.cacheMaxBytes,
          } satisfies InitData,
          warnings: [],
        };
      } finally {
        await initialized.handle.close();
      }
    }
    if (request.verb === "doctor") {
      parseOptions(request.args, []);
      const path = request.env.libraryPath ?? join(homedir(), "Pictures", "photoctl");
      const handle = await openLibrary(path, {
        noDaemon: request.env.noDaemon,
        lockBudgetMs: parseLockBudget(request.env.lockBudgetMs),
      });
      try {
        const diagnostics = await readLibraryDiagnostics(handle);
        return {
          schema: 1,
          ok: true,
          data: {
            library: handle.path,
            library_id: diagnostics.libraryId,
            node: process.versions.node,
            db: await databaseDescription(handle),
            vector: { installed: true, version: diagnostics.vectorVersion },
            cache: {
              root: cacheRootForLibrary(diagnostics.libraryId, request.env.cacheRoot),
              max_bytes: diagnostics.cacheMaxBytes,
            },
            lock_holder: null,
          } satisfies DoctorData,
          warnings: [],
        };
      } finally {
        await handle.close();
      }
    }
    throw new PhotoctlError("usage", `Unknown command: ${request.verb}`);
  } catch (error) {
    if (error instanceof PhotoctlError)
      return {
        schema: 1,
        ok: false,
        code: error.code,
        data: error.data ?? { message: error.message },
      };
    throw error;
  }
}

function parseByteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB)$/i.exec(value);
  if (!match) throw new PhotoctlError("usage", `Invalid byte size: ${value}`);
  const units = { b: 1, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
  const bytes = Number(match[1]) * units[match[2].toLowerCase() as keyof typeof units];
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new PhotoctlError("usage", `Invalid byte size: ${value}`);
  }
  return bytes;
}

function parseLockBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new PhotoctlError("usage", "PHOTOCTL_LOCK_BUDGET_MS must be a non-negative integer");
  }
  return milliseconds;
}

function parseOptions(args: string[], names: string[]): Map<string, string> {
  const allowed = new Set(names);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    if (!name || !allowed.has(name)) {
      throw new PhotoctlError("usage", `Unexpected argument: ${name ?? ""}`);
    }
    if (options.has(name)) throw new PhotoctlError("usage", `Duplicate option: ${name}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new PhotoctlError("usage", `${name} requires a value`);
    }
    options.set(name, value);
  }
  return options;
}
