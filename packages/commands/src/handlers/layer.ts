import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  clearLayers,
  duplicateLayer,
  ensurePhotoDocument,
  loadActiveDocument,
  orientedDimensions,
  readLayerSummary,
  removeLayer,
  reorderLayer,
  RevisionConflictError,
  setLayer,
  transformLayer,
  type Transform,
} from "@photoctl/render";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";
import { executeFillRefresh, executeFillTransform, type FillDependencies } from "./fill.js";

export async function layerCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedFill?: FillDependencies,
): Promise<Envelope> {
  const action = args[0];
  if (
    !action ||
    ![
      "list",
      "show",
      "transform",
      "reorder",
      "set",
      "duplicate",
      "remove",
      "clear",
      "refresh",
    ].includes(action)
  ) {
    throw new PhotoctlError(
      "usage",
      "layer requires list, show, transform, reorder, set, duplicate, remove, clear, or refresh",
    );
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const target = parseTarget(action, args.slice(1));
    if ((action === "list" || action === "show") && target.rest.length > 0) {
      unexpected(target.rest[0]);
    }
    const photoId = await resolvePhotoId(lease.handle, target.photo);
    const photo = await loadPhoto(lease.handle, photoId);
    try {
      if (action === "list") {
        await ensurePhotoDocument(lease.handle, { photoId, orientation: photo.orientation });
        const document = await loadActiveDocument(lease.handle, photoId);
        if (!document) throw new Error("The active photo document is missing");
        return ok({
          id: photoId,
          revision_id: document.revisionId,
          render_hash: document.renderHash,
          layers: document.layers.map(layerData),
        });
      }
      if (action === "show") {
        const shown = await readLayerSummary(lease.handle, {
          photoId,
          orientation: photo.orientation,
          layer: target.layer!,
        });
        return ok({
          id: photoId,
          revision_id: shown.document.revisionId,
          render_hash: shown.document.renderHash,
          layer: layerData(shown.layer),
          chain: {
            content: shown.chain.content.map(chainData),
            mask: shown.chain.mask.map(chainData),
          },
        });
      }
      if (action === "transform") {
        const parsed = parseArguments(target.rest, {
          flags: ["--relative", "--norm"],
          options: ["--dx", "--dy", "--scale", "--rotate", "--flip", "--anchor"],
        });
        if (parsed.positionals.length > 0) unexpected(parsed.positionals[0]);
        if (parsed.options.size === 0)
          throw new PhotoctlError("usage", "layer transform requires a transform option");
        const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
        const transform = parseTransform(parsed.options, parsed.flags.has("--norm"), dimensions);
        const transformed =
          (await executeFillTransform(
            lease.handle,
            photoId,
            target.layer!,
            transform,
            parsed.flags.has("--relative"),
            dimensions,
            providedFill,
          )) ??
          (await transformLayer(lease.handle, lease.handle.path, {
            photoId,
            orientation: photo.orientation,
            layer: target.layer!,
            transform,
            relative: parsed.flags.has("--relative"),
          }));
        const generated = "upscale" in transformed;
        return {
          schema: 1,
          ok: true,
          data: {
            id: photoId,
            layer_id: transformed.layer.id,
            revision_id: transformed.revisionId,
            render_hash: transformed.renderHash,
            matrix: transformed.matrix,
            layer: layerData(transformed.layer),
            upscale:
              generated && transformed.upscale
                ? {
                    enabled: transformed.upscale.enabled,
                    executed: transformed.upscale.executed,
                    node: transformed.upscale.nodeId,
                    adapter: transformed.upscale.adapter,
                    model: transformed.upscale.model,
                    input: transformed.upscale.input,
                    target: transformed.upscale.target,
                    generated: transformed.upscale.generated,
                    final: transformed.upscale.final,
                    density_satisfied: transformed.upscale.densitySatisfied,
                    warnings: transformed.upscale.warnings,
                  }
                : null,
          },
          warnings: generated ? transformed.warnings : [],
        };
      }
      if (action === "refresh") {
        const parsed = parseArguments(target.rest, { options: ["--from"] });
        if (parsed.positionals.length > 0) unexpected(parsed.positionals[0]);
        const refreshed = await executeFillRefresh(
          lease.handle,
          env,
          cwd,
          photoId,
          target.layer!,
          parsed.options.get("--from"),
          providedFill,
        );
        return {
          schema: 1,
          ok: true,
          data: {
            id: photoId,
            graph: {
              revision: refreshed.graph.revision,
              layer: refreshed.graph.layer,
              output_node: refreshed.graph.outputNode,
              render_hash: refreshed.graph.renderHash,
            },
            refreshed: {
              kind: refreshed.refreshed.kind,
              from_node: refreshed.refreshed.fromNode,
              node: refreshed.refreshed.node,
            },
            generation: {
              node: refreshed.generation.node,
              adapter: refreshed.generation.provider.adapter,
              model: refreshed.generation.provider.model,
              returned: refreshed.generation.returned,
            },
            source_context: {
              tier: refreshed.sourceContext.tier,
              pixel_scale: refreshed.sourceContext.pixelScale,
              resolution_limited: refreshed.sourceContext.resolutionLimited,
            },
            upscale: {
              enabled: refreshed.upscale.enabled,
              executed: refreshed.upscale.executed,
              node: refreshed.upscale.node,
              adapter: refreshed.upscale.provider?.adapter ?? null,
              model: refreshed.upscale.model,
              input: refreshed.upscale.input,
              target: refreshed.upscale.target,
              generated: refreshed.upscale.generated,
              final: refreshed.upscale.final,
              density_satisfied: refreshed.upscale.densitySatisfied,
              warnings: refreshed.upscale.warnings,
            },
            composite: { node: refreshed.compositeNode, unmasked_bit_exact: true as const },
            executions: refreshed.executions.map(({ kind, node, provider, reused }) => ({
              kind,
              node,
              adapter: provider.adapter,
              model: provider.model,
              duration_ms: provider.durationMs,
              cost_usd: provider.costUsd,
              reused,
            })),
          },
          warnings: refreshed.warnings,
        };
      }
      if (action === "reorder") {
        const parsed = parseArguments(target.rest, {
          flags: ["--up", "--down", "--front", "--back"],
          options: ["--to"],
        });
        if (parsed.positionals.length > 0) unexpected(parsed.positionals[0]);
        const choices = [...parsed.flags, ...(parsed.options.has("--to") ? ["--to"] : [])];
        if (choices.length !== 1)
          throw new PhotoctlError("usage", "layer reorder requires exactly one destination");
        const value =
          choices[0] === "--to"
            ? parseInteger(parsed.options.get("--to")!, "--to")
            : choices[0].slice(2);
        const reordered = await reorderLayer(lease.handle, {
          photoId,
          orientation: photo.orientation,
          layer: target.layer!,
          destination: value as "up" | "down" | "front" | "back" | number,
        });
        return mutationData(photoId, reordered, reordered.layerId);
      }
      if (action === "set") {
        const parsed = parseArguments(target.rest, {
          options: ["--name", "--opacity", "--blend"],
        });
        if (parsed.positionals.length > 0) unexpected(parsed.positionals[0]);
        if (parsed.options.size === 0)
          throw new PhotoctlError("usage", "layer set requires a value");
        const blend = parsed.options.get("--blend");
        if (blend !== undefined && blend !== "normal") {
          throw new PhotoctlError("usage", "--blend currently supports only normal");
        }
        const updated = await setLayer(lease.handle, {
          photoId,
          orientation: photo.orientation,
          layer: target.layer!,
          name: parsed.options.get("--name"),
          opacity: parsed.options.has("--opacity")
            ? parseNumber(parsed.options.get("--opacity")!, "--opacity")
            : undefined,
          blend,
        });
        return ok({
          id: photoId,
          layer_id: updated.layer.id,
          revision_id: updated.revisionId,
          render_hash: updated.renderHash,
          layer: layerData(updated.layer),
        });
      }
      if (target.rest.length > 0) unexpected(target.rest[0]);
      if (action === "duplicate") {
        const duplicated = await duplicateLayer(lease.handle, {
          photoId,
          orientation: photo.orientation,
          layer: target.layer!,
        });
        return ok({
          id: photoId,
          source_layer_id: duplicated.sourceLayerId,
          layer_id: duplicated.layer.id,
          revision_id: duplicated.revisionId,
          render_hash: duplicated.renderHash,
          layer: layerData(duplicated.layer),
        });
      }
      if (action === "remove") {
        const removed = await removeLayer(lease.handle, {
          photoId,
          orientation: photo.orientation,
          layer: target.layer!,
        });
        return ok({
          id: photoId,
          layer_id: removed.layerId,
          revision_id: removed.revisionId,
          render_hash: removed.renderHash,
        });
      }
      const cleared = await clearLayers(lease.handle, {
        photoId,
        orientation: photo.orientation,
      });
      return ok({
        id: photoId,
        removed: cleared.removed,
        revision_id: cleared.revisionId,
        render_hash: cleared.renderHash,
      });
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
        throw new PhotoctlError("not_found", message, { id: photoId, layer: target.layer });
      }
      if (
        message.startsWith("Layer position") ||
        message.startsWith("Layer name") ||
        message.startsWith("Layer opacity") ||
        message.startsWith("A vacancy layer") ||
        message.startsWith("Transform scale") ||
        message.startsWith("Transform values") ||
        message.startsWith("--from must name") ||
        message.startsWith("Ambiguous refresh node prefix") ||
        message === "Layer does not contain a refreshable fill branch"
      ) {
        throw new PhotoctlError("usage", message, { id: photoId, layer: target.layer });
      }
      throw new PhotoctlError("catalog_unreadable", "Could not read or commit layer state", {
        id: photoId,
        layer: target.layer,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

function parseTarget(action: string, args: string[]) {
  const requiresLayer = !["list", "clear"].includes(action);
  const count = requiresLayer ? 2 : 1;
  if (args.length < count) {
    throw new PhotoctlError(
      "usage",
      requiresLayer
        ? `layer ${action} requires a photo ID or prefix and layer ID or prefix`
        : `layer ${action} requires one photo ID or prefix`,
    );
  }
  return {
    photo: args[0],
    layer: requiresLayer ? args[1] : undefined,
    rest: args.slice(count),
  };
}

function parseTransform(
  options: Map<string, string>,
  normalized: boolean,
  dimensions: { w: number; h: number },
): Transform {
  const flip = options.get("--flip");
  if (flip !== undefined && !["h", "v", "both", "none"].includes(flip)) {
    throw new PhotoctlError("usage", "--flip must be h, v, both, or none");
  }
  const anchorValue = options.get("--anchor") ?? "centroid";
  let anchor: Transform["anchor"] = "centroid";
  if (anchorValue !== "centroid") {
    const values = anchorValue.split(",").map(Number);
    if (values.length !== 2 || values.some((value) => !Number.isFinite(value))) {
      throw new PhotoctlError("usage", "--anchor must be centroid or x,y");
    }
    if (normalized && values.some((value) => value < 0 || value > 1)) {
      throw new PhotoctlError("usage", "--norm anchor coordinates must be between 0 and 1");
    }
    anchor = {
      x: values[0] * (normalized ? dimensions.w : 1),
      y: values[1] * (normalized ? dimensions.h : 1),
    };
  }
  const dx = options.has("--dx") ? parseNumber(options.get("--dx")!, "--dx") : 0;
  const dy = options.has("--dy") ? parseNumber(options.get("--dy")!, "--dy") : 0;
  if (normalized && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
    throw new PhotoctlError("usage", "--norm displacements must be between -1 and 1");
  }
  const transform = {
    dx: dx * (normalized ? dimensions.w : 1),
    dy: dy * (normalized ? dimensions.h : 1),
    scale: options.has("--scale") ? parseNumber(options.get("--scale")!, "--scale") : 1,
    rotate: options.has("--rotate") ? parseNumber(options.get("--rotate")!, "--rotate") : 0,
    flip: flip === "none" || flip === undefined ? null : (flip as "h" | "v" | "both"),
    anchor,
  };
  if (transform.scale <= 0) throw new PhotoctlError("usage", "--scale must be positive");
  return transform;
}

function parseNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new PhotoctlError("usage", `${option} must be finite`);
  return parsed;
}

function parseInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new PhotoctlError("usage", `${option} must be an integer`);
  return parsed;
}

function layerData(layer: {
  id: string;
  role: string;
  ofLayer: string | null;
  name: string;
  z: number;
  contentNodeId: string;
  maskNodeId: string;
  opacity: number;
  blend: string;
  enabled: boolean;
}) {
  return {
    id: layer.id,
    role: layer.role,
    of_layer: layer.ofLayer,
    name: layer.name,
    z: layer.z,
    content_node_id: layer.contentNodeId,
    mask_node_id: layer.maskNodeId,
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  };
}

function chainData(node: {
  id: string;
  kind: string;
  recipeVersion: number;
  parameters: unknown;
  inputNodeIds: string[];
}) {
  return {
    id: node.id,
    kind: node.kind,
    recipe_version: node.recipeVersion,
    parameters: node.parameters,
    input_node_ids: node.inputNodeIds,
  };
}

function mutationData(
  photoId: string,
  mutation: {
    revisionId: string;
    renderHash: string;
    layers: Array<{ id: string; z: number }>;
  },
  layer: string,
) {
  return ok({
    id: photoId,
    layer_id: layer,
    revision_id: mutation.revisionId,
    render_hash: mutation.renderHash,
    z: mutation.layers.find(({ id }) => id === layer)?.z,
  });
}

function ok(data: unknown): Envelope {
  return { schema: 1, ok: true, data, warnings: [] };
}

function unexpected(value: string): never {
  throw new PhotoctlError("usage", `Unexpected argument: ${value}`);
}
