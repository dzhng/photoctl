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
  countStaleXmp,
  completeModelManifest,
  fetchPinnedModels,
  inspectModelRelease,
  parseModelReleaseManifest,
  PINNED_MODEL_RELEASE,
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
import { join, resolve } from "node:path";
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
import { xmpCommand } from "./handlers/xmp.js";
import { developCommand, type DevelopDependencies } from "./handlers/develop.js";
import { presetsCommand } from "./handlers/presets.js";
import { renderCommand } from "./handlers/render.js";
import { embedCommand } from "./handlers/embed.js";
import { searchCommand } from "./handlers/search.js";
import { segmentCommand, type SegmentationDependencies } from "./handlers/segment.js";
import { layerCommand } from "./handlers/layer.js";
import { fillCommand, type FillDependencies } from "./handlers/fill.js";
import { retouchCommand } from "./handlers/retouch.js";
import { reimagineCommand } from "./handlers/reimagine.js";
import { relightCommand } from "./handlers/relight.js";
import { generateCommand, type GenerateDependencies } from "./handlers/generate.js";
import { markupCommand } from "./handlers/markup.js";
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
  segmentation?: SegmentationDependencies;
  fill?: FillDependencies;
  develop?: DevelopDependencies;
  generate?: GenerateDependencies;
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
      return await exportCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "decode")
      return await decodeCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "graph")
      return await graphCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "xmp")
      return await xmpCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "develop")
      return await developCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.develop,
        context.previewCoordinator,
      );
    if (request.verb === "presets")
      return await presetsCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "render")
      return await renderCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "embed")
      return await embedCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.emit,
      );
    if (request.verb === "search")
      return await searchCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.stream,
        context.emit,
      );
    if (request.verb === "segment")
      return await segmentCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.segmentation,
      );
    if (request.verb === "layer")
      return await layerCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
      );
    if (request.verb === "fill")
      return await fillCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
      );
    if (request.verb === "retouch")
      return await retouchCommand(request.args, request.env, request.cwd, context.library);
    if (request.verb === "reimagine")
      return await reimagineCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      );
    if (request.verb === "relight")
      return await relightCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.fill,
        context.emit,
      );
    if (request.verb === "generate")
      return await generateCommand(
        request.args,
        request.env,
        request.cwd,
        context.library,
        context.generate,
        context.emit,
      );
    if (request.verb === "markup")
      return await markupCommand(request.args, request.env, request.cwd, context.library);
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
      const parsed = parseArguments(request.args, {
        options: ["--path", "--cache-max", "--embed"],
      });
      if (parsed.positionals.length > 0) {
        throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
      }
      const { options } = parsed;
      const pathOption = options.get("--path");
      const path = pathOption
        ? resolve(request.cwd, pathOption)
        : libraryPath(request.env, request.cwd);
      const cacheMax = options.get("--cache-max");
      const embed = options.get("--embed") ?? "manual";
      if (embed !== "auto" && embed !== "manual") {
        throw new PhotoctlError("usage", "--embed must be auto or manual");
      }
      const initialized = await initializeLibrary(
        path,
        cacheMax ? parseByteSize(cacheMax) : DEFAULT_CACHE_MAX_BYTES,
        embed,
      );
      try {
        return {
          schema: 1,
          ok: true,
          data: {
            library: initialized.handle.path,
            db: await databaseDescription(initialized.handle),
            cache_max_bytes: initialized.cacheMaxBytes,
            embed,
          } satisfies InitData,
          warnings: [],
        };
      } finally {
        await initialized.handle.close();
      }
    }
    if (request.verb === "doctor") {
      const parsed = parseArguments(request.args, { flags: ["--fetch-models"] });
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
        const xmpStale = await countStaleXmp(handle);
        const modelManifest = parseModelReleaseManifest(PINNED_MODEL_RELEASE);
        const modelSettings = await handle.query<{ value: unknown }>(
          "SELECT value FROM settings WHERE key = 'models_base_url'",
        );
        const storedModelBaseUrl = modelSettings.rows[0]?.value ?? null;
        const parsedModelBaseUrl =
          typeof storedModelBaseUrl === "string" && URL.canParse(storedModelBaseUrl)
            ? new URL(storedModelBaseUrl)
            : null;
        if (
          storedModelBaseUrl !== null &&
          (parsedModelBaseUrl === null ||
            (parsedModelBaseUrl.protocol !== "http:" && parsedModelBaseUrl.protocol !== "https:"))
        ) {
          throw new PhotoctlError("provider_unconfigured", "Invalid models_base_url setting", {
            reason: "models_base_url_invalid",
          });
        }
        const configuredModelBaseUrl = storedModelBaseUrl as string | null;
        const modelDirectory = join(handle.path, "models");
        const completeManifest = completeModelManifest(modelManifest);
        if (parsed.flags.has("--fetch-models")) {
          if (configuredModelBaseUrl === null) {
            throw new PhotoctlError("provider_unconfigured", "models_base_url is not configured", {
              reason: "models_base_url_missing",
            });
          }
          if (completeManifest === null) {
            throw new PhotoctlError(
              "provider_unconfigured",
              "Model export manifest is incomplete",
              {
                reason: "model_manifest_incomplete",
              },
            );
          }
          try {
            await fetchPinnedModels({
              manifest: completeManifest,
              baseUrl: configuredModelBaseUrl,
              directory: modelDirectory,
            });
          } catch (error) {
            throw new PhotoctlError("provider_unconfigured", "Pinned model fetch failed", {
              reason: "model_fetch_failed",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        const modelArtifacts = await inspectModelRelease(modelManifest, modelDirectory);
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
            xmp: { stale: xmpStale },
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
            models: {
              base_url: configuredModelBaseUrl,
              manifest_ready: completeManifest !== null,
              directory: modelDirectory,
              artifacts: modelArtifacts,
            },
            lock_holder: null,
          } satisfies DoctorData,
          warnings:
            xmpStale > 0
              ? [{ code: "xmp_stale", message: `${xmpStale} XMP sidecar(s) changed on disk` }]
              : [],
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
