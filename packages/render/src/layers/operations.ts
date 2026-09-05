import { artifactPath, normalizeMaskArtifact, publishArtifact } from "../artifacts/publication.js";
import type { MaskImage } from "../mask-tiff.js";
/* eslint-disable no-await-in-loop -- Graph chains are inherently ordered database walks. */
import {
  commitRevision,
  ensurePhotoDocument,
  loadActiveDocument,
  type GraphDatabase,
  type NodeDraft,
} from "../graph/store.js";
import { readArtifactMask } from "../artifacts/publication.js";
import {
  resolveTransformMatrix,
  transformPoint,
  type Transform,
  type TransformMatrix,
} from "../transforms.js";
import {
  compositeV2Projection,
  resolveLayerId,
  type NewLayerIdentity,
  type RevisionLayer,
  type RevisionLayerDraft,
} from "./model.js";
import type { ImageNodeKind, JsonValue } from "../graph/types.js";

export type ManualMaskShape =
  | { kind: "box"; bbox: [number, number, number, number] }
  | { kind: "brush"; points: Array<[number, number]> };

export interface ManualLayerResult {
  layerId: string;
  revisionId: string;
  renderHash: `r_${string}`;
  artifactHash: `a_${string}`;
  bbox: [number, number, number, number];
  pixels: number;
}

export async function createManualLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    orientation: number;
    dimensions: { w: number; h: number };
    shape: ManualMaskShape;
  },
): Promise<ManualLayerResult> {
  await ensurePhotoDocument(database, {
    photoId: request.photoId,
    orientation: request.orientation,
  });
  const current = await loadActiveDocument(database, request.photoId);
  if (!current) throw new Error("The active photo document is missing");
  const raster = rasterizeManualMask(request.dimensions, request.shape);
  const published = await publishArtifact(libraryPath, await normalizeMaskArtifact(raster.mask));
  const layers: RevisionLayerDraft[] = [
    ...current.layers.map((layer) => ({
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
      layer: { localKey: "manual-layer" },
      name: `Segment ${current.layers.length + 1}`,
      z: current.layers.length,
      contentNode: { nodeId: current.roots.base },
      maskNode: { localKey: "manual-mask" },
      opacity: 1,
      blend: "normal",
      enabled: true,
    },
  ];
  const projection = compositeV2Projection({ nodeId: current.roots.base }, layers);
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: current.revisionId,
    artifacts: [published],
    nodes: [
      {
        localKey: "manual-mask",
        kind: "mask",
        recipeVersion: 1,
        parameters: { artifact_hash: published.artifactHash },
        inputs: [],
      },
      { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
    newLayers: [{ localKey: "manual-layer", role: "subject" }],
    layers,
  });
  if (!committed.renderHash) throw new Error("A layer revision must have a render hash");
  return {
    layerId: committed.newLayers["manual-layer"],
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    artifactHash: published.artifactHash,
    bbox: raster.bbox,
    pixels: raster.pixels,
  };
}

export async function readLayerSummary(
  database: GraphDatabase,
  request: { photoId: string; orientation: number; layer: string },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const layer = document.layers.find(({ id }) => id === layerId);
  if (!layer) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  return {
    document,
    layer,
    chain: {
      content: await firstInputChain(database, request.photoId, layer.contentNodeId),
      mask: await firstInputChain(database, request.photoId, layer.maskNodeId),
    },
  };
}

export async function transformLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    orientation: number;
    layer: string;
    transform: Transform;
    relative: boolean;
  },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const selected = requiredLayer(document.layers, layerId);
  const content = await splitTransformLineage(database, request.photoId, selected.contentNodeId);
  const mask = await splitTransformLineage(database, request.photoId, selected.maskNodeId);
  if (JSON.stringify(content.matrix) !== JSON.stringify(mask.matrix)) {
    throw new Error("Layer content and mask transforms disagree");
  }
  const centroid = await maskCentroid(database, libraryPath, request.photoId, mask.baseNodeId);
  const anchor =
    request.relative && request.transform.anchor === "centroid"
      ? transformPoint(content.matrix, centroid)
      : centroid;
  const matrix = resolveTransformMatrix(
    content.matrix,
    request.transform,
    request.relative,
    anchor,
  );
  const nodes: NodeDraft[] = [
    transformDraft("layer-content-transform", content.baseNodeId, matrix),
    transformDraft("layer-mask-transform", mask.baseNodeId, matrix),
  ];
  let contentNode: { localKey: string } = { localKey: "layer-content-transform" };
  for (const [index, node] of content.prefix.toReversed().entries()) {
    const localKey = `layer-content-prefix-${index}`;
    nodes.push({
      localKey,
      kind: node.kind,
      recipeVersion: node.recipeVersion,
      parameters: node.parameters,
      inputs: [contentNode],
    });
    contentNode = { localKey };
  }
  const layers = document.layers.map((layer) =>
    layer.id === layerId
      ? layerDraft(layer, layer.z, contentNode, { localKey: "layer-mask-transform" })
      : layerDraft(layer, layer.z),
  );
  const committed = await commitLayerSnapshot(database, document, layers, { nodes });
  return { ...committed, layer: committed.layers.find(({ id }) => id === layerId)!, matrix };
}

export async function reorderLayer(
  database: GraphDatabase,
  request: {
    photoId: string;
    orientation: number;
    layer: string;
    destination: "front" | "back" | "up" | "down" | number;
  },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const from = document.layers.findIndex(({ id }) => id === layerId);
  if (from < 0) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  let to: number;
  if (request.destination === "front") to = document.layers.length - 1;
  else if (request.destination === "back") to = 0;
  else if (request.destination === "up") to = Math.min(document.layers.length - 1, from + 1);
  else if (request.destination === "down") to = Math.max(0, from - 1);
  else to = request.destination - 1;
  if (!Number.isSafeInteger(to) || to < 0 || to >= document.layers.length) {
    throw new Error(`Layer position must be between 1 and ${document.layers.length}`);
  }
  const reordered = [...document.layers];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  const committed = await commitLayerSnapshot(
    database,
    document,
    reordered.map((layer, z) => layerDraft(layer, z)),
  );
  return { ...committed, layerId };
}

export async function setLayer(
  database: GraphDatabase,
  request: {
    photoId: string;
    orientation: number;
    layer: string;
    name?: string;
    opacity?: number;
    blend?: "normal";
  },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  if (request.name !== undefined && (request.name.length === 0 || request.name.length > 256)) {
    throw new Error("Layer name must contain between 1 and 256 characters");
  }
  if (
    request.opacity !== undefined &&
    (!Number.isFinite(request.opacity) || request.opacity < 0 || request.opacity > 1)
  ) {
    throw new Error("Layer opacity must be between 0 and 1");
  }
  const layers = document.layers.map((layer) =>
    layerDraft(
      layer.id === layerId
        ? {
            ...layer,
            name: request.name ?? layer.name,
            opacity: request.opacity ?? layer.opacity,
            blend: request.blend ?? layer.blend,
          }
        : layer,
      layer.z,
    ),
  );
  requiredLayer(document.layers, layerId);
  const committed = await commitLayerSnapshot(database, document, layers);
  return { ...committed, layer: committed.layers.find(({ id }) => id === layerId)! };
}

export async function duplicateLayer(
  database: GraphDatabase,
  request: { photoId: string; orientation: number; layer: string },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const source = requiredLayer(document.layers, layerId);
  const name = `${source.name.slice(0, 251)} copy`;
  const drafts: RevisionLayerDraft[] = [];
  for (const layer of document.layers) {
    drafts.push(layerDraft(layer, drafts.length));
    if (layer.id === source.id) {
      drafts.push({
        layer: { localKey: "duplicate-layer" },
        name,
        z: drafts.length,
        contentNode: { nodeId: source.contentNodeId },
        maskNode: { nodeId: source.maskNodeId },
        opacity: source.opacity,
        blend: source.blend,
        enabled: source.enabled,
      });
    }
  }
  const committed = await commitLayerSnapshot(database, document, drafts, {
    newLayers: [{ localKey: "duplicate-layer", role: source.role }],
  });
  const duplicateId = committed.newLayers["duplicate-layer"];
  return {
    ...committed,
    sourceLayerId: source.id,
    layer: committed.layers.find(({ id }) => id === duplicateId)!,
  };
}

export async function removeLayer(
  database: GraphDatabase,
  request: { photoId: string; orientation: number; layer: string },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  requiredLayer(document.layers, layerId);
  const committed = await commitLayerSnapshot(
    database,
    document,
    document.layers.filter(({ id }) => id !== layerId).map((layer, z) => layerDraft(layer, z)),
  );
  return { ...committed, layerId };
}

export async function clearLayers(
  database: GraphDatabase,
  request: { photoId: string; orientation: number },
) {
  await ensurePhotoDocument(database, request);
  const document = await activeDocument(database, request.photoId);
  const committed = await commitLayerSnapshot(database, document, []);
  return { ...committed, removed: document.layers.length };
}

async function commitLayerSnapshot(
  database: GraphDatabase,
  document: Awaited<ReturnType<typeof activeDocument>>,
  layers: RevisionLayerDraft[],
  additions: { nodes?: NodeDraft[]; newLayers?: NewLayerIdentity[] } = {},
) {
  const nodes = [...(additions.nodes ?? [])];
  const rootUpdates: Array<{ root: "output"; node: { nodeId: string } | { localKey: string } }> =
    [];
  if (layers.length === 0) {
    rootUpdates.push({ root: "output", node: { nodeId: document.roots.base } });
  } else {
    const projection = compositeV2Projection({ nodeId: document.roots.base }, layers);
    nodes.push({ localKey: "composite", kind: "composite", recipeVersion: 2, ...projection });
    rootUpdates.push({ root: "output", node: { localKey: "composite" } });
  }
  const committed = await commitRevision(database, {
    photoId: document.photoId,
    expectedRevisionId: document.revisionId,
    nodes,
    rootUpdates,
    newLayers: additions.newLayers,
    layers,
  });
  if (!committed.renderHash) throw new Error("A layer revision must have a render hash");
  return { ...committed, renderHash: committed.renderHash as `r_${string}` };
}

function layerDraft(
  layer: RevisionLayer,
  z: number,
  contentNode: { nodeId: string } | { localKey: string } = { nodeId: layer.contentNodeId },
  maskNode: { nodeId: string } | { localKey: string } = { nodeId: layer.maskNodeId },
): RevisionLayerDraft {
  return {
    layer: { layerId: layer.id },
    name: layer.name,
    z,
    contentNode,
    maskNode,
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  };
}

function requiredLayer(layers: RevisionLayer[], layerId: string): RevisionLayer {
  const layer = layers.find(({ id }) => id === layerId);
  if (!layer) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  return layer;
}

async function activeDocument(database: GraphDatabase, photoId: string) {
  const document = await loadActiveDocument(database, photoId);
  if (!document) throw new Error("The active photo document is missing");
  return { ...document, photoId };
}

interface ChainNode {
  id: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  parameters: JsonValue;
  inputNodeIds: string[];
}

async function firstInputChain(database: GraphDatabase, photoId: string, root: string) {
  const chain: ChainNode[] = [];
  let nodeId: string | undefined = root;
  while (nodeId) {
    const node = await loadChainNode(database, photoId, nodeId);
    chain.push(node);
    nodeId = node.inputNodeIds[0];
  }
  return chain;
}

async function loadChainNode(
  database: GraphDatabase,
  photoId: string,
  nodeId: string,
): Promise<ChainNode> {
  const result = await database.query<{
    id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
  }>(
    "SELECT id, kind, recipe_version, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2",
    [photoId, nodeId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Graph node does not exist for photo: ${nodeId}`);
  const inputs = await database.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  return {
    id: row.id,
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
    inputNodeIds: inputs.rows.map(({ input_node_id }) => input_node_id),
  };
}

async function splitTransformLineage(database: GraphDatabase, photoId: string, root: string) {
  const prefix: ChainNode[] = [];
  let nodeId = root;
  while (true) {
    const node = await loadChainNode(database, photoId, nodeId);
    if (node.kind === "transform") {
      return {
        baseNodeId: node.inputNodeIds[0],
        matrix: transformMatrixFrom(node.parameters),
        prefix,
      };
    }
    if (node.kind !== "delta" || node.inputNodeIds.length !== 1) {
      return { baseNodeId: nodeId, matrix: [1, 0, 0, 1, 0, 0] as TransformMatrix, prefix };
    }
    prefix.push(node);
    nodeId = node.inputNodeIds[0];
  }
}

function transformDraft(localKey: string, inputNodeId: string, matrix: TransformMatrix): NodeDraft {
  return {
    localKey,
    kind: "transform",
    recipeVersion: 1,
    parameters: { matrix: [...matrix] },
    inputs: [{ nodeId: inputNodeId }],
  };
}

function transformMatrixFrom(parameters: JsonValue): TransformMatrix {
  if (
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters) ||
    !Array.isArray(parameters.matrix) ||
    parameters.matrix.length !== 6 ||
    parameters.matrix.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("Transform node has an invalid matrix");
  }
  return [
    parameters.matrix[0] as number,
    parameters.matrix[1] as number,
    parameters.matrix[2] as number,
    parameters.matrix[3] as number,
    parameters.matrix[4] as number,
    parameters.matrix[5] as number,
  ];
}

async function maskCentroid(
  database: GraphDatabase,
  libraryPath: string,
  photoId: string,
  maskRoot: string,
) {
  const chain = await firstInputChain(database, photoId, maskRoot);
  const permanent = chain.find(({ kind }) => kind === "mask");
  const artifactHash = (permanent?.parameters as { artifact_hash?: string } | undefined)
    ?.artifact_hash;
  if (!artifactHash) throw new Error("Layer mask lineage has no permanent mask artifact");
  const artifact = await database.query<{ w: number; h: number }>(
    "SELECT w, h FROM image_artifacts WHERE artifact_hash = $1 AND artifact_available = true",
    [artifactHash],
  );
  const dimensions = artifact.rows[0];
  if (!dimensions) throw new Error(`Mask artifact is unavailable: ${artifactHash}`);
  const path = artifactPath(libraryPath, artifactHash, "tif");
  const mask = await readArtifactMask(path, artifactHash);
  let weight = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < mask.data.length; index += 1) {
    const coverage = mask.data[index];
    weight += coverage;
    x += ((index % dimensions.w) + 0.5) * coverage;
    y += (Math.floor(index / dimensions.w) + 0.5) * coverage;
  }
  if (weight === 0) throw new Error("Layer mask has no covered pixels");
  return { x: x / weight, y: y / weight };
}

export function rasterizeManualMask(
  dimensions: { w: number; h: number },
  shape: ManualMaskShape,
): { mask: MaskImage; bbox: [number, number, number, number]; pixels: number } {
  const data = new Float32Array(dimensions.w * dimensions.h);
  const contains =
    shape.kind === "box" ? boxContains(shape.bbox) : polygonContains(assertPolygon(shape.points));
  let pixels = 0;
  for (let y = 0; y < dimensions.h; y += 1) {
    for (let x = 0; x < dimensions.w; x += 1) {
      if (!contains(x + 0.5, y + 0.5)) continue;
      data[y * dimensions.w + x] = 1;
      pixels += 1;
    }
  }
  if (pixels === 0) throw new Error("Manual mask does not cover any pixel centers");
  return {
    mask: { w: dimensions.w, h: dimensions.h, data },
    bbox: shape.kind === "box" ? shape.bbox : polygonBounds(shape.points),
    pixels,
  };
}

function boxContains([x, y, w, h]: [number, number, number, number]) {
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
    throw new Error("Segment box must contain finite x,y,w,h values with positive size");
  }
  return (pointX: number, pointY: number) =>
    pointX >= x && pointX < x + w && pointY >= y && pointY < y + h;
}

function assertPolygon(points: Array<[number, number]>): Array<[number, number]> {
  if (
    points.length < 3 ||
    points.some((point) => point.length !== 2 || !point.every(Number.isFinite))
  ) {
    throw new Error("Segment brush must be a polygon with at least three finite points");
  }
  return points;
}

function polygonContains(points: Array<[number, number]>) {
  return (x: number, y: number) => {
    let inside = false;
    for (
      let current = 0, previous = points.length - 1;
      current < points.length;
      previous = current++
    ) {
      const [x1, y1] = points[current];
      const [x2, y2] = points[previous];
      if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) {
        inside = !inside;
      }
    }
    return inside;
  };
}

function polygonBounds(points: Array<[number, number]>): [number, number, number, number] {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}
