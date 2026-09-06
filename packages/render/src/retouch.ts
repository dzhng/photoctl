import { normalizeMaskArtifact, publishArtifact } from "./artifacts/publication.js";
import {
  commitRevision,
  ensurePhotoDocument,
  loadActiveDocument,
  RevisionConflictError,
  type GraphDatabase,
  type NodeDraft,
} from "./graph/store.js";
import type { RevisionLayerDraft } from "./layers/model.js";
import type { JsonValue } from "./graph/types.js";
import { developFrame, savedRenderFrame, type RenderFrame } from "./graph/frame.js";
import { markupFreeOutputNode } from "./markup/graph.js";
import { transformPoint } from "./transforms.js";
import { readPhotographicSupport } from "./graph/evaluator.js";
import type { MaskImage } from "./mask-tiff.js";

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
  validateCircle(request.at, request.radius);
  let document = await loadActiveDocument(database, request.photoId);
  const existing = (
    await Promise.all(
      (document?.layers ?? [])
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
  if (existing && document) {
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

  let pixelOutputNodeId = document
    ? await markupFreeOutputNode(database, request.photoId, document.roots.output)
    : undefined;
  const support = pixelOutputNodeId
    ? await readPhotographicSupport({
        database,
        libraryPath,
        photoId: request.photoId,
        nodeId: pixelOutputNodeId,
      })
    : undefined;
  const frame = support?.frame ?? developFrame(request.dimensions, request.dimensions);
  const mask = circularMask(frame, request.at, request.radius, support?.mask);
  if (!document) {
    const initialized = await ensurePhotoDocument(database, {
      photoId: request.photoId,
      orientation: request.orientation,
      expectedRevisionId: null,
    });
    pixelOutputNodeId = initialized.outputNodeId;
    document = await loadActiveDocument(database, request.photoId);
    if (document?.revisionId !== initialized.revisionId) throw new RevisionConflictError();
  }
  if (!document || !pixelOutputNodeId) throw new Error("The active photo document is missing");
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
      localKey: "mask-placement",
      kind: "transform",
      recipeVersion: 2,
      parameters: { matrix: [1, 0, 0, 1, 0, 0], frame: savedRenderFrame(frame) },
      inputs: [{ localKey: "mask" }],
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
      inputs: [{ nodeId: pixelOutputNodeId }, { localKey: "mask-placement" }],
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
      maskNode: { localKey: "mask-placement" },
      opacity: 1,
      blend: "normal",
      enabled: true,
    },
  ];
  const committed = await commitRevision(database, {
    outputPlan: "photographic",
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    artifacts: [published],
    nodes,
    newLayers: [{ localKey: "retouch-layer", role: "retouch" }],
    layers,
    rootUpdates: [],
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

function circularMask(
  frame: RenderFrame,
  at: [number, number],
  radius: number,
  support?: MaskImage,
) {
  const point = transformPoint(frame.baseToRaster, { x: at[0], y: at[1] });
  const { w, h } = frame.raster;
  if (point.x < 0 || point.x > w || point.y < 0 || point.y > h)
    throw new Error("Retouch point must be inside the current photographic viewport");
  const data = new Float32Array(w * h);
  const squared = radius * radius;
  let surrounding = 0;
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const base = transformPoint(frame.rasterToBase, { x: x + 0.5, y: y + 0.5 });
      const dx = base.x - at[0];
      const dy = base.y - at[1];
      if (support && support.data[y * w + x]! <= 0) continue;
      if (dx * dx + dy * dy <= squared) data[y * w + x] = 1;
      else surrounding++;
    }
  if (!data.some((value) => value > 0))
    throw new Error("Retouch circle does not cover a current photographic pixel center");
  if (surrounding === 0)
    throw new Error(
      "Retouch circle must leave surrounding pixels in the current photographic viewport",
    );
  return { w, h, data };
}

function validateCircle(at: [number, number], radius: number) {
  if (!at.every(Number.isFinite)) throw new Error("Retouch point must be finite");
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Retouch radius must be positive");
}
function samePoint(value: unknown, point: [number, number]): boolean {
  return (
    Array.isArray(value) && value.length === 2 && value[0] === point[0] && value[1] === point[1]
  );
}
