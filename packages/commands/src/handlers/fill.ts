/* eslint-disable no-await-in-loop -- Source fallbacks must stop before the paid provider call. */
import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { createVolumeResolver } from "@photoctl/library";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  fillLayerStrict,
  refreshFillLayer,
  resolveFillRefreshTarget,
  describeFillBranch,
  loadActiveDocument,
  resolveLayerId,
  moveLayer,
  orientedDimensions,
  resolveUpscalePolicy,
  RevisionConflictError,
  SourceEvaluationError,
  type FillGenerationDependencies,
  type ImageSource,
} from "@photoctl/render";
import {
  GatewayClient,
  GatewayImageModelAdapter,
  REMOVE_PROMPT_VERSION,
  buildGuardedUpscalePrompt,
  createUpscaleRegistry,
  removePrompt,
  readProviderSettings,
  resolveModel,
  type UpscaleRegistry,
} from "@photoctl/providers";
import { PhotoctlError, type Envelope, type FillStrictData } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { resolveGraphSources } from "../graph-source.js";
import { loadPhoto } from "../photo.js";

export async function fillCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: FillDependencies,
): Promise<Envelope> {
  const parsed = parseArguments(args, {
    flags: ["--norm", "--remove", "--upscale", "--no-upscale"],
    options: [
      "--move",
      "--to",
      "--by",
      "--layer",
      "--prompt",
      "--pad",
      "--seed",
      "--model",
      "--upscale-model",
    ],
  });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "fill requires exactly one photo ID or prefix");
  }
  const generatedLayer = parsed.options.get("--layer");
  if (generatedLayer) {
    if (
      parsed.flags.has("--norm") ||
      parsed.options.has("--move") ||
      parsed.options.has("--to") ||
      parsed.options.has("--by")
    ) {
      throw new PhotoctlError("usage", "fill generation cannot be combined with fill --move");
    }
    return await fillGenerationCommand(parsed, env, cwd, provided, providedDependencies);
  }
  if (
    parsed.flags.has("--remove") ||
    parsed.options.has("--prompt") ||
    parsed.options.has("--pad") ||
    parsed.options.has("--seed") ||
    parsed.options.has("--model") ||
    parsed.options.has("--upscale-model") ||
    parsed.flags.has("--upscale") ||
    parsed.flags.has("--no-upscale")
  ) {
    throw new PhotoctlError("usage", "fill generation requires --layer");
  }
  const layer = parsed.options.get("--move");
  const modes = ["--to", "--by"].filter((option) => parsed.options.has(option));
  if (!layer || modes.length !== 1) {
    throw new PhotoctlError("usage", "fill --move requires exactly one of --to x,y or --by dx,dy");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, parsed.positionals[0]);
    const photo = await loadPhoto(lease.handle, photoId);
    const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
    const mode = modes[0] === "--to" ? "to" : "by";
    const point = parsePoint(parsed.options.get(modes[0])!, modes[0]);
    if (parsed.flags.has("--norm")) {
      const valid =
        mode === "to"
          ? point.every((value) => value >= 0 && value <= 1)
          : point.every((value) => value >= -1 && value <= 1);
      if (!valid) {
        throw new PhotoctlError(
          "usage",
          mode === "to"
            ? "--norm target coordinates must be between 0 and 1"
            : "--norm displacements must be between -1 and 1",
        );
      }
      point[0] *= dimensions.w;
      point[1] *= dimensions.h;
    }
    try {
      const moved = await moveLayer(lease.handle, lease.handle.path, {
        photoId,
        orientation: photo.orientation,
        dimensions,
        layer,
        destination: { mode, x: point[0], y: point[1] },
      });
      return {
        schema: 1,
        ok: true,
        data: {
          id: photoId,
          layer_id: moved.layerId,
          vacancy_layer_id: moved.vacancyLayerId,
          revision_id: moved.revisionId,
          render_hash: moved.renderHash,
          matrix: moved.matrix,
        },
        warnings: [],
      };
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      if (error instanceof RevisionConflictError) {
        throw new PhotoctlError("library_locked", error.message, {
          id: photoId,
          reason: "revision_conflict",
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not present")) {
        throw new PhotoctlError("not_found", message, { id: photoId, layer });
      }
      if (message === "fill --move requires a subject layer") {
        throw new PhotoctlError("usage", message, { id: photoId, layer });
      }
      throw new PhotoctlError("catalog_unreadable", "Could not commit moved layer state", {
        id: photoId,
        layer,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

export type FillDependencies = FillGenerationDependencies & {
  source?: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
  upscaleRegistry?: UpscaleRegistry;
  upscaleSettings?: import("@photoctl/render").UpscalePolicySettings;
  sourceContext?: import("@photoctl/render").SourceContextDensity;
};

async function withFillSource<T>(
  handle: LibraryHandle,
  env: RequestEnv,
  cwd: string,
  photo: Awaited<ReturnType<typeof loadPhoto>>,
  dependencies: FillDependencies,
  run: (input: {
    source: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
    sourceContext: import("@photoctl/render").SourceContextDensity;
  }) => Promise<T>,
): Promise<T> {
  const photoId = photo.id;
  const resolver = createVolumeResolver(env.volumeMap, handle.path);
  const libraryId = await readLibraryId(handle);
  const pinned: ImageSource = {
    kind: "pinned-preview",
    path: pinnedEmbeddedJpegPath(cacheRootForLibrary(libraryId, cacheBase(env, cwd)), photoId),
    mediaType: "image/jpeg",
    orientation: 1,
  };
  const candidates = await resolveGraphSources({
    photo,
    resolver,
    pinned,
    pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${photoId}.jpg` },
    env,
  });
  if (candidates.length === 0 && !dependencies.source) {
    throw new PhotoctlError("file_offline", "No usable image source is available", { id: photoId });
  }
  const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
  let lastSourceError: SourceEvaluationError | undefined;
  for (const entry of dependencies.source ? [{ produce: dependencies.source }] : candidates) {
    try {
      let source: import("@photoctl/render").EvaluateGraphNodeRequest["source"] = entry.produce;
      let sourceContext = dependencies.sourceContext;
      if (!sourceContext) {
        if (typeof entry.produce !== "function") {
          throw new Error("Structured fill source dependencies require explicit sourceContext");
        }
        let produced: Awaited<ReturnType<typeof entry.produce>>;
        try {
          produced = await entry.produce();
        } catch (error) {
          throw new SourceEvaluationError(error);
        }
        source = async () => produced;
        const pixelScale = Math.min(
          1,
          produced.provenance.w / dimensions.w,
          produced.provenance.h / dimensions.h,
        );
        sourceContext = {
          tier: produced.provenance.tier,
          pixelScale,
          resolutionLimited: pixelScale + 1 / Math.max(dimensions.w, dimensions.h) < 1,
        };
      }
      return await run({ source, sourceContext });
    } catch (error) {
      if (!(error instanceof SourceEvaluationError)) throw error;
      lastSourceError = error;
    }
  }
  throw new PhotoctlError("file_offline", "No usable image source is available", {
    id: photoId,
    reason: lastSourceError?.message,
  });
}

export async function executeFillRefresh(
  handle: LibraryHandle,
  env: RequestEnv,
  cwd: string,
  photoId: string,
  layer: string,
  from: string | undefined,
  providedDependencies?: FillDependencies,
) {
  const photo = await loadPhoto(handle, photoId);
  const document = await loadActiveDocument(handle, photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(handle, photoId, layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  const branch = await describeFillBranch(handle, photoId, selected.contentNodeId);
  if (!branch) throw new Error("Layer does not contain a refreshable fill branch");
  const generationParameters = branch.generation.parameters as { model?: unknown } | null;
  if (typeof generationParameters?.model !== "string") {
    throw new Error("Fill generation recipe has no concrete model");
  }
  const settings = await readProviderSettings(handle);
  const dependencies =
    providedDependencies ??
    ({
      adapter: new GatewayImageModelAdapter({
        model: generationParameters.model,
        mask: "native",
        maskPolarity: "unverified",
      }),
      gateway: new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl }),
      model: generationParameters.model,
    } satisfies FillDependencies);
  const upscaleRegistry = providedDependencies?.upscaleRegistry ?? createUpscaleRegistry();
  const upscaleParameters = branch.upscale?.parameters as { model?: unknown } | null | undefined;
  const upscaleModel =
    typeof upscaleParameters?.model === "string" ? upscaleParameters.model : undefined;
  const upscaleSettings = providedDependencies?.upscaleSettings ?? settings;
  const upscaleConfigured =
    upscaleModel !== undefined &&
    upscaleSettings.providers?.upscale?.[upscaleModel]?.configured === true;
  const upscaleAdapter =
    upscaleModel && upscaleConfigured ? upscaleRegistry.get(upscaleModel) : undefined;
  const target = resolveFillRefreshTarget(branch, from);
  if (target.kind === "upscale" && !upscaleAdapter) {
    throw new PhotoctlError("provider_unconfigured", "The fill upscaler is not configured", {
      id: photoId,
      layer,
    });
  }
  const run = async (sourceInput: {
    source: import("@photoctl/render").EvaluateGraphNodeRequest["source"];
    sourceContext: import("@photoctl/render").SourceContextDensity;
  }) =>
    await refreshFillLayer(handle, handle.path, {
      photoId,
      layer,
      from: target.id,
      ...sourceInput,
      dependencies,
      upscaleModel: upscaleModel ?? upscaleRegistry.releaseDefault,
      ...(upscaleAdapter
        ? {
            upscaleAdapter: {
              id: upscaleAdapter.id,
              version: upscaleAdapter.version,
              supportedScales: upscaleAdapter.supportedScales,
              limits: upscaleAdapter.limits,
              execute: async (input) => await upscaleRegistry.execute(upscaleAdapter, input),
            },
          }
        : {}),
    });
  if (target.kind === "upscale") {
    const pinnedSource =
      dependencies.source ??
      (async () => {
        throw new Error("Pinned upscale refresh unexpectedly evaluated the current source");
      });
    return await run({ source: pinnedSource, sourceContext: branch.sourceContext });
  }
  return await withFillSource(handle, env, cwd, photo, dependencies, run);
}

async function fillGenerationCommand(
  parsed: ReturnType<typeof parseArguments>,
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: FillDependencies,
): Promise<Envelope> {
  const idInput = parsed.positionals[0]!;
  const layer = parsed.options.get("--layer")!;
  const remove = parsed.flags.has("--remove");
  const custom = parsed.options.get("--prompt");
  if (remove === Boolean(custom)) {
    throw new PhotoctlError("usage", "fill requires exactly one of --remove or --prompt");
  }
  if (parsed.flags.has("--upscale") && parsed.flags.has("--no-upscale")) {
    throw new PhotoctlError("usage", "fill accepts only one of --upscale or --no-upscale");
  }
  const pad = parseOptionalInteger(parsed.options.get("--pad"), "--pad", 0);
  const seed = parseOptionalInteger(
    parsed.options.get("--seed"),
    "--seed",
    Number.MIN_SAFE_INTEGER,
  );
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, idInput);
    const photo = await loadPhoto(lease.handle, photoId);
    const settings = await readProviderSettings(lease.handle);
    const model =
      providedDependencies?.model ??
      resolveModel("edit", settings.models, parsed.options.get("--model"));
    const dependencies =
      providedDependencies ??
      ({
        adapter: new GatewayImageModelAdapter({
          model,
          mask: "native",
          maskPolarity: "unverified",
        }),
        gateway: new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl }),
        model,
      } satisfies FillDependencies);
    const upscaleRegistry = providedDependencies?.upscaleRegistry ?? createUpscaleRegistry();
    const guardedPrompt = buildGuardedUpscalePrompt(remove ? removePrompt() : custom!);
    const result = await withFillSource(
      lease.handle,
      env,
      cwd,
      photo,
      dependencies,
      async ({ source, sourceContext }) => {
        const upscalePolicy = resolveUpscalePolicy({
          releaseDefaultModel: upscaleRegistry.releaseDefault,
          availableAdapterIds: upscaleRegistry.list().map(({ id }) => id),
          settings: providedDependencies?.upscaleSettings ?? settings,
          ...(parsed.flags.has("--no-upscale")
            ? { flag: "no-upscale" as const }
            : parsed.flags.has("--upscale")
              ? { flag: "upscale" as const }
              : {}),
          ...(parsed.options.has("--upscale-model")
            ? { modelOverride: parsed.options.get("--upscale-model")! }
            : {}),
          sourceContext,
        });
        const upscaleAdapter = upscaleRegistry.get(upscalePolicy.upscale.model);
        return await fillLayerStrict(lease.handle, lease.handle.path, {
          photoId,
          layer,
          operation: remove ? "remove" : "prompt",
          prompt: remove ? removePrompt() : custom!,
          promptVersion: remove ? REMOVE_PROMPT_VERSION : 1,
          ...(pad === undefined ? {} : { pad }),
          ...(seed === undefined ? {} : { seed }),
          source,
          dependencies,
          sourceContext,
          upscale: {
            policy: upscalePolicy,
            prompt: guardedPrompt,
            ...(upscaleAdapter
              ? {
                  adapter: {
                    id: upscaleAdapter.id,
                    version: upscaleAdapter.version,
                    supportedScales: upscaleAdapter.supportedScales,
                    limits: upscaleAdapter.limits,
                    execute: async (input) => await upscaleRegistry.execute(upscaleAdapter, input),
                  },
                }
              : {}),
          },
        });
      },
    );
    return {
      schema: 1,
      ok: true,
      data: {
        id: photoId,
        graph: {
          revision: result.revisionId,
          layer: result.layerId,
          output_node: result.outputNodeId,
          render_hash: result.renderHash,
        },
        generation: {
          node: result.generationNodeId,
          adapter: dependencies.adapter.id,
          model: dependencies.model,
          returned: result.returnedDimensions,
        },
        source_context: {
          tier: result.sourceContext.tier,
          pixel_scale: result.sourceContext.pixelScale,
          resolution_limited: result.sourceContext.resolutionLimited,
        },
        upscale: {
          enabled: result.upscale.enabled,
          executed: result.upscale.executed,
          node: result.upscale.nodeId,
          adapter: result.upscale.adapter,
          model: result.upscale.model,
          input: result.upscale.input,
          target: result.upscale.target,
          generated: result.upscale.generated,
          final: result.upscale.final,
          density_satisfied: result.upscale.densitySatisfied,
          warnings: result.upscale.warnings,
        },
        composite: { node: result.compositeNodeId, unmasked_bit_exact: true as const },
        executions: result.executions.map(({ kind, nodeId, provider, reused }) => ({
          kind,
          node: nodeId,
          adapter: provider.adapter,
          model: provider.model,
          duration_ms: provider.durationMs,
          cost_usd: provider.costUsd,
          reused,
        })),
      } satisfies FillStrictData,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (error instanceof RevisionConflictError) {
      throw new PhotoctlError("library_locked", error.message, {
        id: idInput,
        reason: "revision_conflict",
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PhotoctlError("catalog_unreadable", "Could not commit strict fill", {
      id: idInput,
      layer,
      reason: message,
    });
  } finally {
    await lease.release();
  }
}

function parseOptionalInteger(value: string | undefined, option: string, minimum: number) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new PhotoctlError("usage", `${option} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function parsePoint(value: string, option: string): [number, number] {
  const point = value.split(",").map(Number);
  if (point.length !== 2 || point.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new PhotoctlError("usage", `${option} must be two finite comma-separated numbers`);
  }
  return [point[0], point[1]];
}
