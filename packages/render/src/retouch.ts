import { normalizeMaskArtifact, publishArtifact } from "./artifacts/publication.js";
import { commitRevision, type GraphDatabase, type NodeDraft } from "./graph/store.js";
import { compositeV2Projection, type RevisionLayerDraft } from "./layers/model.js";
import type { JsonValue } from "./graph/types.js";
import { developGeometryMatrix } from "./develop/geometry.js";
import { readActiveDevelopState } from "./develop/state.js";
import { invertTransformMatrix, transformPoint, type TransformMatrix } from "./transforms.js";

const NEIGHBORHOOD_RADIUS = 3;
const REFINEMENT_ITERATIONS = 512;
const REFINEMENT_PIXEL_BUDGET = 8_000_000;

export interface RetouchResult {
  layerId: string;
  revisionId: string;
  renderHash: `r_${string}`;
  at: [number, number];
  radius: number;
  nodeId: `node_${string}`;
  reused: boolean;
}

export async function createRetouchLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    orientation: number;
    dimensions: { w: number; h: number };
    at: [number, number];
    radius: number;
  },
): Promise<RetouchResult> {
  validateCircle(request.dimensions, request.at, request.radius);
  const state = await readActiveDevelopState(database, {
    photoId: request.photoId,
    orientation: request.orientation,
  });
  const document = {
    revisionId: state.revisionId,
    renderHash: state.renderHash,
    layers: state.layers,
    roots: { base: state.baseNodeId, output: state.outputNodeId },
  };
  const existing = (
    await Promise.all(
      document.layers
        .filter(({ role }) => role === "retouch")
        .map(async (layer) => ({
          layer,
          node: (
            await database.query<{ kind: string; parameters: JsonValue }>(
              "SELECT kind, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2",
              [request.photoId, layer.contentNodeId],
            )
          ).rows[0],
        })),
    )
  ).find(({ node }) => {
    const parameters = node?.parameters as { at?: unknown; radius?: unknown } | undefined;
    return (
      node?.kind === "heal" &&
      samePoint(parameters?.at, request.at) &&
      parameters?.radius === request.radius
    );
  });
  if (existing) {
    return {
      layerId: existing.layer.id,
      revisionId: document.revisionId,
      renderHash: document.renderHash as `r_${string}`,
      at: request.at,
      radius: request.radius,
      nodeId: existing.layer.contentNodeId as `node_${string}`,
      reused: true,
    };
  }

  const geometry = developGeometryMatrix(request.dimensions.w, request.dimensions.h, state.develop);
  const mask = circularMask(request.dimensions, request.at, request.radius, geometry);
  const published = await publishArtifact(libraryPath, await normalizeMaskArtifact(mask));
  const nodes: NodeDraft[] = [
    {
      localKey: "mask",
      kind: "mask",
      recipeVersion: 1,
      parameters: { artifact_hash: published.artifactHash },
      inputs: [],
    },
    {
      localKey: "heal",
      kind: "heal",
      recipeVersion: 1,
      parameters: {
        method: "fast-marching-harmonic",
        at: request.at,
        radius: request.radius,
        neighborhood_radius: NEIGHBORHOOD_RADIUS,
        refinement_iterations: REFINEMENT_ITERATIONS,
        refinement_pixel_budget: REFINEMENT_PIXEL_BUDGET,
      },
      inputs: [{ nodeId: state.pixelOutputNodeId }, { localKey: "mask" }],
    },
  ];
  const layers: RevisionLayerDraft[] = [
    ...document.layers.map((layer) => ({
      layer: { layerId: layer.id },
      name: layer.name,
      z: layer.z,
      contentNode: { nodeId: layer.contentNodeId },
      maskNode: { nodeId: layer.maskNodeId },
      opacity: layer.opacity,
      blend: layer.blend,
      enabled: layer.enabled,
    })),
    {
      layer: { localKey: "retouch-layer" },
      name: `Retouch ${document.layers.length + 1}`,
      z: Math.max(-1, ...document.layers.map(({ z }) => z)) + 1,
      contentNode: { localKey: "heal" },
      maskNode: { localKey: "mask" },
      opacity: 1,
      blend: "normal",
      enabled: true,
    },
  ];
  nodes.push({
    localKey: "composite",
    kind: "composite",
    recipeVersion: 2,
    ...compositeV2Projection({ nodeId: document.roots.base }, layers),
  });
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    artifacts: [published],
    nodes,
    newLayers: [{ localKey: "retouch-layer", role: "retouch" }],
    layers,
    rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
  });
  if (!committed.renderHash) throw new Error("A retouch revision must have a render hash");
  return {
    layerId: committed.newLayers["retouch-layer"]!,
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    at: request.at,
    radius: request.radius,
    nodeId: committed.nodes.heal!.id as `node_${string}`,
    reused: false,
  };
}

export function circularMask(
  dimensions: { w: number; h: number },
  at: [number, number],
  radius: number,
  geometry: { matrix: TransformMatrix; w: number; h: number } = {
    matrix: [1, 0, 0, 1, 0, 0],
    ...dimensions,
  },
) {
  validateCircle(dimensions, at, radius);
  const data = new Float32Array(geometry.w * geometry.h);
  const squared = radius * radius;
  const inverse = invertTransformMatrix(geometry.matrix);
  for (let y = 0; y < geometry.h; y += 1)
    for (let x = 0; x < geometry.w; x += 1) {
      const base = transformPoint(inverse, { x: x + 0.5, y: y + 0.5 });
      const dx = base.x - at[0];
      const dy = base.y - at[1];
      if (dx * dx + dy * dy <= squared) data[y * geometry.w + x] = 1;
    }
  if (!data.some((value) => value > 0))
    throw new Error("Retouch circle does not intersect the current crop");
  if (data.every((value) => value > 0))
    throw new Error("Retouch circle must leave surrounding pixels in the current crop");
  return { w: geometry.w, h: geometry.h, data };
}

function validateCircle(
  dimensions: { w: number; h: number },
  at: [number, number],
  radius: number,
) {
  if (
    !at.every(Number.isFinite) ||
    at[0] < 0 ||
    at[0] > dimensions.w ||
    at[1] < 0 ||
    at[1] > dimensions.h
  )
    throw new Error("Retouch point must be inside the oriented image bounds");
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Retouch radius must be positive");
  const centers: Array<[number, number]> = [
    [0.5, 0.5],
    [dimensions.w - 0.5, 0.5],
    [0.5, dimensions.h - 0.5],
    [dimensions.w - 0.5, dimensions.h - 0.5],
  ];
  const squared = radius * radius;
  const distance = ([x, y]: [number, number]) => (x - at[0]) ** 2 + (y - at[1]) ** 2;
  const nearest: [number, number] = [
    Math.min(dimensions.w - 0.5, Math.max(0.5, at[0])),
    Math.min(dimensions.h - 0.5, Math.max(0.5, at[1])),
  ];
  if (distance(nearest) > squared) throw new Error("Retouch circle does not cover a pixel center");
  if (centers.every((center) => distance(center) <= squared))
    throw new Error("Retouch circle must leave surrounding pixels outside the mask");
}
function samePoint(value: unknown, point: [number, number]): boolean {
  return (
    Array.isArray(value) && value.length === 2 && value[0] === point[0] && value[1] === point[1]
  );
}
