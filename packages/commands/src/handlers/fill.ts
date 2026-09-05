/* eslint-disable no-await-in-loop -- Source fallbacks must stop before the paid provider call. */
import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { createVolumeResolver } from "@photoctl/library";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  fillLayerStrict,
  moveLayer,
  orientedDimensions,
  RevisionConflictError,
  SourceEvaluationError,
  type FillGenerationDependencies,
  type ImageSource,
} from "@photoctl/render";
import {
  GatewayClient,
  GatewayImageModelAdapter,
  REMOVE_PROMPT_VERSION,
  removePrompt,
  readProviderSettings,
  resolveModel,
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
    flags: ["--norm", "--remove"],
    options: ["--move", "--to", "--by", "--layer", "--prompt", "--pad", "--seed", "--model"],
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
    parsed.options.has("--model")
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
};

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
    const resolver = createVolumeResolver(env.volumeMap, lease.handle.path);
    const libraryId = await readLibraryId(lease.handle);
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
    if (candidates.length === 0 && !dependencies.source)
      throw new PhotoctlError("file_offline", "No usable image source is available", {
        id: photoId,
      });
    let result: Awaited<ReturnType<typeof fillLayerStrict>> | undefined;
    let lastSourceError: SourceEvaluationError | undefined;
    for (const source of dependencies.source
      ? [dependencies.source]
      : candidates.map(({ produce }) => produce)) {
      try {
        result = await fillLayerStrict(lease.handle, lease.handle.path, {
          photoId,
          layer,
          operation: remove ? "remove" : "prompt",
          prompt: remove ? removePrompt() : custom!,
          promptVersion: remove ? REMOVE_PROMPT_VERSION : 1,
          ...(pad === undefined ? {} : { pad }),
          ...(seed === undefined ? {} : { seed }),
          source,
          dependencies,
        });
        break;
      } catch (error) {
        if (!(error instanceof SourceEvaluationError)) throw error;
        lastSourceError = error;
      }
    }
    if (!result) {
      throw new PhotoctlError("file_offline", "No usable image source is available", {
        id: photoId,
        reason: lastSourceError?.message,
      });
    }
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
          resampled: result.resampled,
          returned: result.returnedDimensions,
        },
        composite: { node: result.compositeNodeId, unmasked_bit_exact: true as const },
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
