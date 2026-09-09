import { cacheRootForLibrary } from "@photoctl/importer";
import {
  countStaleXmp,
  databaseDescription,
  fetchPinnedModels,
  inspectPinnedModels,
  modelSourceBaseUrl,
  PINNED_MODEL_RELEASE,
  readLibraryDiagnostics,
  type LibraryHandle,
} from "@photoctl/library";
import { resolveMacHelperPath } from "@photoctl/mac-helper";
import {
  PhotoctlError,
  userSettingsSchema,
  type DoctorData,
  type Envelope,
} from "@photoctl/protocol";
import { providerDiagnostics, readProviderSettings } from "@photoctl/providers";
import {
  inspectCirawHelper,
  inspectLibrawDecoder,
  inspectNativeImageRuntime,
} from "@photoctl/render";
import { join } from "node:path";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, type RequestEnv } from "../context.js";
import { errorMessage } from "../errors.js";

export async function doctorCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--fetch-models"] });
  if (parsed.positionals.length > 0) {
    throw new PhotoctlError("usage", `Unexpected argument: ${parsed.positionals[0]}`);
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const diagnostics = await readLibraryDiagnostics(handle);
    const ciraw = await inspectCirawHelper(resolveMacHelperPath(env.macHelperPath));
    const libraw = inspectLibrawDecoder();
    const nativeImage = inspectNativeImageRuntime();
    const providers = providerDiagnostics(await readProviderSettings(handle), env);
    const xmpStale = await countStaleXmp(handle);
    const modelSettings = await handle.query<{ value: unknown }>(
      "SELECT value FROM settings WHERE key = 'models_base_url'",
    );
    const parsedModelBaseUrl = userSettingsSchema.shape.models_base_url.safeParse(
      modelSettings.rows[0]?.value ?? null,
    );
    if (!parsedModelBaseUrl.success) {
      throw new PhotoctlError("provider_unconfigured", "Invalid models_base_url setting", {
        reason: "models_base_url_invalid",
      });
    }
    const modelBaseUrl = parsedModelBaseUrl.data ?? modelSourceBaseUrl(PINNED_MODEL_RELEASE);
    const modelDirectory = join(handle.path, "models");
    if (parsed.flags.has("--fetch-models")) {
      try {
        await fetchPinnedModels({
          manifest: PINNED_MODEL_RELEASE,
          baseUrl: modelBaseUrl,
          directory: modelDirectory,
        });
      } catch (error) {
        throw new PhotoctlError("provider_unconfigured", "Pinned model fetch failed", {
          reason: "model_fetch_failed",
          message: errorMessage(error),
        });
      }
    }
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
          root: cacheRootForLibrary(diagnostics.libraryId, cacheBase(env, cwd)),
          max_bytes: diagnostics.cacheMaxBytes,
        },
        xmp: { stale: xmpStale },
        native_image: { ...nativeImage, required: true },
        decoders: [
          { id: "ciraw", available: ciraw.available, version: ciraw.version },
          { id: "libraw", available: libraw.available, version: libraw.version },
        ],
        providers,
        models: {
          base_url: modelBaseUrl,
          // Pinned releases always ship complete hashes; the field survives for envelope stability.
          manifest_ready: true,
          directory: modelDirectory,
          artifacts: await inspectPinnedModels(PINNED_MODEL_RELEASE, modelDirectory),
        },
        lock_holder: null,
      } satisfies DoctorData,
      warnings:
        xmpStale > 0
          ? [{ code: "xmp_stale", message: `${xmpStale} XMP sidecar(s) changed on disk` }]
          : [],
    };
  } finally {
    await lease.release();
  }
}
