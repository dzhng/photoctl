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
import {
  inspectCirawHelper,
  inspectLibrawDecoder,
  inspectNativeImageRuntime,
} from "@photoctl/render";
import type { PreviewCoordinator } from "@photoctl/render";
import { providerDiagnostics, readProviderSettings } from "@photoctl/providers";
import { resolve } from "node:path";
import { parseArguments } from "./arguments.js";
import { cacheBase, libraryPath, parseLockBudget } from "./context.js";
import { parseByteSize } from "./byte-size.js";
import { cacheCommand } from "./handlers/cache.js";
import { exportCommand } from "./handlers/export.js";
import { decodeCommand } from "./handlers/decode.js";
import { importCommand } from "./handlers/import.js";
import { showCommand } from "./handlers/show.js";
import { tagCommand } from "./handlers/tag.js";
import { backupCommand, migrateCommand, restoreCommand } from "./handlers/library-lifecycle.js";
import { graphCommand } from "./handlers/graph.js";
import {
  flagCommand,
  labelCommand,
  listCommand,
  nextCommand,
  removeCommand,
  rateCommand,
} from "./handlers/cull.js";
export interface DispatchContext {
  version: string;
  library?: LibraryHandle;
  emit?: (event: StderrEvent) => void | Promise<void>;
  stream?: (row: unknown) => void | Promise<void>;
  previewCoordinator?: PreviewCoordinator;
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
      return await importCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "show")
      return await showCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
      );
    if (request.verb === "cache")
      return await cacheCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.previewCoordinator,
      );
    if (request.verb === "export")
      return await exportCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "decode")
      return await decodeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "graph")
      return await graphCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "tag")
      return await tagCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "list")
      return await listCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.stream,
      );
    if (request.verb === "next")
      return await nextCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "remove")
      return await removeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "rate")
      return await rateCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "flag")
      return await flagCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "label")
      return await labelCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "backup")
      return await backupCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "restore")
      return await restoreCommand(request.args, request.env, request.cwd);
    if (request.verb === "migrate")
      return await migrateCommand(request.args, request.env, request.cwd, context.library);
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
        const libraw = inspectLibrawDecoder();
        const nativeImage = inspectNativeImageRuntime();
        const providers = providerDiagnostics(await readProviderSettings(handle), request.env);
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
            native_image: { ...nativeImage, required: true },
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
                available: libraw.available,
                version: libraw.version,
                requires_window_server: false,
              },
            ],
            providers,
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
