import type { RevisionLayer } from "../layers/model.js";
import type { CommitRevisionRequest, GraphTransaction, NodeReference } from "./store.js";
import { z } from "zod";
import { PhotoctlError } from "@photoctl/protocol";
import {
  savedFrameSchema,
  parseRenderFrame,
  savedRenderFrame,
  developFrame,
  developFrames,
  containingFrame,
  placedFrame,
  assertNewRasterSize,
} from "./frame.js";
import { loadGeometryAncestry } from "./geometry-intent.js";
import type { DevelopDict } from "../develop/dict.js";
import { isDeepStrictEqual } from "node:util";
import { reorientCanvas } from "./canvas.js";
import { readBaseDevelopInput } from "./base-input.js";
import { loadLogicalFrame } from "./projection.js";
import { composeTransformMatrices } from "../transforms.js";
import { admissibleCanvasSupport, hasUncoveredCanvas } from "./canvas-support.js";
import { markupFreeOutputNode } from "../markup/graph.js";
import { intersectConvexPolygons, polygonArea } from "../develop/geometry.js";

export const canvasCompositeSchema = z
  .object({
    frame: savedFrameSchema,
    uncovered: z.boolean(),
    base_stages: z.array(savedFrameSchema),
    layers: z.array(
      z
        .object({
          opacity: z.number().min(0).max(1),
          blend: z.literal("normal"),
          frame: savedFrameSchema.nullable(),
          stages: z.array(savedFrameSchema),
        })
        .strict(),
    ),
  })
  .strict();

/** Read the snapped photographic plan before preview/export caches can bypass evaluation. */
export async function readCanvasStatus(
  database: GraphTransaction,
  photoId: string,
  outputNodeId: string,
) {
  const photographic = await markupFreeOutputNode(database, photoId, outputNodeId);
  const node = (
    await database.query<{ kind: string; recipe_version: number; parameters: unknown }>(
      "SELECT kind, recipe_version, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2",
      [photoId, photographic],
    )
  ).rows[0];
  if (!node) throw new Error("Canvas status requires the snapped output node");
  return {
    uncovered:
      node.kind === "composite" && node.recipe_version === 3
        ? canvasCompositeSchema.parse(node.parameters).uncovered
        : false,
  };
}

export async function planDevelopIntent(
  transaction: GraphTransaction,
  current: { photoId: string; outputNodeId: string; geometryNodeId?: string; develop: DevelopDict },
  develop: DevelopDict,
  touched: readonly ("crop" | "aspect_ratio")[],
): Promise<{
  changed: boolean;
  nodes: CommitRevisionRequest["nodes"];
  rootUpdates: Array<{ root: "geometry"; node: NodeReference }>;
}> {
  const changed = !isDeepStrictEqual(current.develop, develop);
  if (touched.includes("crop") && develop.crop) {
    const visible = await loadLogicalFrame(transaction, current.photoId, current.outputNodeId);
    const requested = developFrame(visible.catalog, visible.catalog, {
      crop: develop.crop,
      aspect_ratio: develop.aspect_ratio,
    });
    assertNewRasterSize(requested.raster, visible.catalog);
    const polygon = (frame: typeof visible) => frame.visibleBasePolygon.map(([x, y]) => ({ x, y }));
    if (polygonArea(intersectConvexPolygons(polygon(visible), polygon(requested))) === 0) {
      throw new PhotoctlError("usage", "A new crop must intersect the current visible canvas");
    }
  }
  if (!current.geometryNodeId) return { changed, nodes: [], rootUpdates: [] };
  const ancestry = await loadGeometryAncestry(transaction, current.photoId, current.geometryNodeId);
  if (ancestry.parameters.type !== "intent") throw new Error("Expected current geometry intent");
  const parameters = {
    ...ancestry.parameters,
    ...(touched.includes("crop") ? { crop_activation: ancestry.parameters.sequence } : {}),
    ...(touched.includes("aspect_ratio")
      ? { aspect_activation: ancestry.parameters.sequence }
      : {}),
  };
  if (isDeepStrictEqual(parameters, ancestry.parameters))
    return { changed, nodes: [], rootUpdates: [] };
  return {
    changed: true,
    nodes: [
      {
        localKey: "develop-intent",
        kind: "geometry",
        recipeVersion: 1,
        parameters,
        inputs: ancestry.inputs.map((nodeId) => ({ nodeId })),
      },
    ],
    rootUpdates: [{ root: "geometry", node: { localKey: "develop-intent" } }],
  };
}

/** Photographic output only; the revision owner applies final vector markup atomically. */
export async function planPhotographicOutput(
  transaction: GraphTransaction,
  request: {
    photoId: string;
    baseNodeId: string;
    geometryNodeId?: string;
    layers: readonly RevisionLayer[];
  },
): Promise<Pick<CommitRevisionRequest, "nodes" | "rootUpdates">> {
  const base = { nodeId: request.baseNodeId };
  const layers = request.layers.map((layer) => ({
    ...layer,
    contentNode: { nodeId: layer.contentNodeId },
    maskNode: { nodeId: layer.maskNodeId },
  }));
  const borders = request.layers.filter((layer) => layer.enabled && layer.role === "border");
  const enabled = request.layers.filter((layer) => layer.enabled);
  const source = await readBaseDevelopInput(transaction, request.photoId, request.baseNodeId);
  const controls = source.develop;
  let canvas: z.infer<typeof canvasCompositeSchema> | undefined;
  if (borders.length && request.geometryNodeId) {
    const ancestry = await loadGeometryAncestry(
      transaction,
      request.photoId,
      request.geometryNodeId,
    );
    const checkpoints = new Map<
      string,
      Extract<typeof ancestry.parameters, { type: "checkpoint" }>
    >();
    const retainSupport = (id: string) => {
      if (checkpoints.has(id)) return;
      const node = ancestry.nodes.get(id)!;
      if (node.parameters.type !== "checkpoint")
        throw new Error("A border requires its authored checkpoint");
      checkpoints.set(id, node.parameters);
      node.inputs.slice(0, node.parameters.support_input_count).forEach(retainSupport);
    };
    borders.forEach((layer) => retainSupport(layer.authoredCheckpointNodeId!));
    const ordered = [...checkpoints.entries()].sort((a, b) => a[1].sequence - b[1].sequence);
    const latest = borders
      .map((layer) => checkpoints.get(layer.authoredCheckpointNodeId!)!)
      .sort((a, b) => a.sequence - b.sequence)
      .at(-1)!;
    let outer = parseRenderFrame(latest.outer_frame);
    const stagesAfter = (sequence: number) =>
      ordered
        .filter(([, checkpoint]) => checkpoint.sequence > sequence)
        .flatMap(([id, checkpoint]) => {
          const input = parseRenderFrame(checkpoint.input_frame);
          const parent = ancestry.nodes
            .get(id)!
            .inputs.slice(0, checkpoint.support_input_count)
            .map((nodeId) => checkpoints.get(nodeId)!)
            .sort((a, b) => a.sequence - b.sequence)
            .at(-1);
          const activeRestriction =
            !parent ||
            (checkpoint.geometry.crop && checkpoint.crop_activation > parent.crop_activation) ||
            (checkpoint.geometry.aspect_ratio &&
              checkpoint.aspect_activation > parent.aspect_activation);
          const stages = activeRestriction
            ? developFrames(input.catalog, input.catalog, checkpoint.geometry)
            : reorientCanvas(
                parseRenderFrame(parent.outer_frame),
                parent.geometry,
                checkpoint.geometry,
              ).stages;
          return [...stages.map(savedRenderFrame), checkpoint.input_frame];
        });
    const borderFrames = new Map(
      await Promise.all(
        borders.map(async (layer) => {
          const checkpoint = checkpoints.get(layer.authoredCheckpointNodeId!)!;
          const authored = parseRenderFrame(checkpoint.outer_frame);
          const outer = await loadLogicalFrame(transaction, request.photoId, layer.contentNodeId);
          const matrix = composeTransformMatrices(outer.rasterToBase, authored.baseToRaster);
          return [
            layer.id,
            {
              outer,
              input: placedFrame(parseRenderFrame(checkpoint.input_frame), matrix),
              restrictions: stagesAfter(checkpoint.sequence).map(parseRenderFrame),
            },
          ] as const;
        }),
      ),
    );
    outer = containingFrame(outer, [
      ...parseRenderFrame(latest.input_frame).visibleBasePolygon.map(([x, y]) => ({ x, y })),
      ...admissibleCanvasSupport([], [...borderFrames.values()]).flat(),
    ]);
    const tail: ReturnType<typeof savedRenderFrame>[] = [];
    if (
      (controls.crop && ancestry.parameters.crop_activation > latest.crop_activation) ||
      (controls.aspect_ratio && ancestry.parameters.aspect_activation > latest.aspect_activation)
    ) {
      tail.push(...developFrames(outer.catalog, outer.catalog, controls).map(savedRenderFrame));
      outer = parseRenderFrame(tail.at(-1)!);
    } else {
      const orientation = reorientCanvas(outer, latest.geometry, controls);
      tail.push(...orientation.stages.map(savedRenderFrame));
      outer = orientation.frame;
    }
    canvas = {
      frame: savedRenderFrame(outer),
      uncovered: hasUncoveredCanvas(
        outer,
        [developFrame(outer.catalog, outer.catalog), ...stagesAfter(0).map(parseRenderFrame)],
        [...borderFrames.values()],
      ),
      base_stages: [...stagesAfter(0), ...tail],
      layers: enabled.map((layer) => {
        const checkpoint = layer.authoredCheckpointNodeId
          ? ancestry.nodes.get(layer.authoredCheckpointNodeId)?.parameters
          : undefined;
        return {
          opacity: layer.opacity,
          blend: layer.blend,
          frame:
            layer.role === "border" ? savedRenderFrame(borderFrames.get(layer.id)!.outer) : null,
          stages: [...stagesAfter(checkpoint?.sequence ?? 0), ...tail],
        };
      }),
    };
  } else if (controls.crop) {
    const input = await loadLogicalFrame(transaction, request.photoId, source.developInputNodeId);
    const stages = developFrames(input.catalog, input.catalog, controls);
    const outer = stages.at(-1)!;
    if (hasUncoveredCanvas(outer, [input], [])) {
      canvas = {
        frame: savedRenderFrame(outer),
        uncovered: true,
        base_stages: stages.map(savedRenderFrame),
        layers: enabled.map((layer) => ({
          opacity: layer.opacity,
          blend: layer.blend,
          frame: null,
          stages: stages.map(savedRenderFrame),
        })),
      };
    }
  }
  if (canvas) {
    const adjustments = { ...controls };
    delete adjustments.crop;
    delete adjustments.aspect_ratio;
    delete adjustments.rotate;
    delete adjustments.straighten_deg;
    return {
      nodes: [
        {
          localKey: "canvas-base",
          kind: "develop",
          recipeVersion: 1,
          parameters: adjustments,
          inputs: [{ nodeId: source.developInputNodeId }],
        },
        {
          localKey: "photographic-output",
          kind: "composite",
          recipeVersion: 3,
          parameters: canvas,
          inputs: [
            { localKey: "canvas-base" },
            ...enabled.flatMap((layer) => [
              { nodeId: layer.contentNodeId },
              { nodeId: layer.maskNodeId },
            ]),
          ],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "photographic-output" } }],
    };
  }
  // An empty stack preserves base identity; a disabled stack still has a composite recipe.
  if (layers.length === 0) {
    return { nodes: [], rootUpdates: [{ root: "output", node: base }] };
  }
  return {
    nodes: [
      {
        localKey: "photographic-output",
        kind: "composite",
        recipeVersion: 2,
        ...compositeV2Projection(base, layers),
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "photographic-output" } }],
  };
}

export function compositeV2Projection<Reference = NodeReference>(
  base: Reference,
  layers: readonly {
    contentNode: Reference;
    maskNode: Reference;
    opacity: number;
    blend: "normal";
    enabled: boolean;
  }[],
): { parameters: { layers: Array<{ opacity: number; blend: "normal" }> }; inputs: Reference[] } {
  const enabled = layers.filter((layer) => layer.enabled);
  return {
    parameters: {
      layers: enabled.map(({ opacity, blend }) => ({ opacity, blend })),
    },
    inputs: [base, ...enabled.flatMap(({ contentNode, maskNode }) => [contentNode, maskNode])],
  };
}
