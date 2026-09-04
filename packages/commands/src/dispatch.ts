import {
  PhotoctlError,
  type CommandRequest,
  type DoctorData,
  type Envelope,
  type InitData,
  type StderrEvent,
} from "@photoctl/protocol";
import {
  databaseDescription,
  DEFAULT_CACHE_MAX_BYTES,
  initializeLibrary,
  openLibrary,
  readLibraryDiagnostics,
  type LibraryHandle,
} from "@photoctl/library";
import { cacheRootForLibrary } from "@photoctl/importer";
import { resolveMacHelperPath } from "@photoctl/mac-helper";
import { inspectCirawHelper } from "@photoctl/render";
import { resolve } from "node:path";
import { parseArguments } from "./arguments.js";
import { cacheBase, libraryPath, parseLockBudget } from "./context.js";
import { exportCommand } from "./handlers/export.js";
import { decodeCommand } from "./handlers/decode.js";
import { importCommand } from "./handlers/import.js";
import { showCommand } from "./handlers/show.js";
import { tagCommand } from "./handlers/tag.js";
export interface DispatchContext {
  version: string;
  library?: LibraryHandle;
  emit?: (event: StderrEvent) => void;
}
export async function dispatch(
  request: CommandRequest,
  context: DispatchContext,
): Promise<Envelope> {
  try {
    if (request.verb === "version") {
      return { schema: 1, ok: true, data: { version: context.version }, warnings: [] };
    }
    if (request.verb === "import")
      return await importCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "show")
      return await showCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "export")
      return await exportCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "decode")
      return await decodeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "tag")
      return await tagCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "init") {
      const parsed = parseArguments(request.args, { options: ["--path", "--cache-max"] });
      if (parsed.positionals.length > 0) {
        throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
      }
      const { options } = parsed;
      const pathOption = options.get("--path");
      const path = pathOption
        ? resolve(request.cwd, pathOption)
        : libraryPath(request.env, request.cwd);
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
      const parsed = parseArguments(request.args, {});
      if (parsed.positionals.length > 0) {
        throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
      }
      const path = libraryPath(request.env, request.cwd);
      const ownsHandle = context.library === undefined;
      const handle =
        context.library ??
        (await openLibrary(path, {
          noDaemon: request.env.noDaemon,
          lockBudgetMs: parseLockBudget(request.env.lockBudgetMs),
        }));
      try {
        const diagnostics = await readLibraryDiagnostics(handle);
        const ciraw = await inspectCirawHelper(resolveMacHelperPath(request.env.macHelperPath));
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
              root: cacheRootForLibrary(diagnostics.libraryId, cacheBase(request.env, request.cwd)),
              max_bytes: diagnostics.cacheMaxBytes,
            },
            decoders: [
              {
                id: "ciraw",
                available: ciraw.available,
                version: ciraw.version,
                // G3 remains unknown until the SSH/headless probe can run on this host.
                requires_window_server: null,
              },
              {
                id: "libraw",
                available: false,
                version: null,
                requires_window_server: false,
              },
            ],
            lock_holder: null,
          } satisfies DoctorData,
          warnings: [],
        };
      } finally {
        if (ownsHandle) await handle.close();
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
