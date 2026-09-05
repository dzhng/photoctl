import {
  commitRevision,
  ensurePhotoDocument,
  loadActiveDocument,
  type GraphDatabase,
  type NodeDraft,
  type NodeReference,
} from "../graph/store.js";
import type { ImageNodeKind, JsonValue } from "../graph/types.js";
import {
  compositeV2Projection,
  type RevisionLayer,
  type RevisionLayerDraft,
} from "../layers/model.js";
import { unfilledVacancyLayerIds } from "../layers/status.js";
import { developDictSchema, type DevelopDict } from "./dict.js";
import { applyDevelopCompensation, planDevelopChange } from "./tiers.js";
import { markupFreeOutputNode } from "../markup/graph.js";

export interface ActiveDevelopState {
  photoId: string;
  revisionId: string;
  outputNodeId: string;
  /** Current RGB output without the final editable markup presentation node. */
  pixelOutputNodeId: string;
  baseNodeId: string;
  sourceNodeId: string;
  outputParameters: JsonValue;
  develop: DevelopDict;
  hasDevelopNode: boolean;
  layers: RevisionLayer[];
  layerDevelop: Record<string, DevelopDict>;
  renderHash: `r_${string}`;
  revisionMetadata: Record<string, JsonValue> | null;
}

export async function activeLayerStatus(
  database: GraphDatabase,
  state: ActiveDevelopState,
): Promise<{
  count: number;
  staleIds: string[];
  unfilledVacancyIds: string[];
}> {
  const unfilledVacancies = await unfilledVacancyLayerIds(database, state.photoId, state.layers);
  return {
    count: state.layers.length,
    staleIds: state.layers
      .filter(
        (layer) =>
          !unfilledVacancies.has(layer.id) &&
          planDevelopChange(state.layerDevelop[layer.id] ?? {}, state.develop)?.tier === 2,
      )
      .map(({ id }) => id),
    unfilledVacancyIds: state.layers
      .filter((layer) => layer.enabled && unfilledVacancies.has(layer.id))
      .map(({ id }) => id),
  };
}

export async function readActiveDevelopState(
  database: GraphDatabase,
  request: { photoId: string; orientation: number },
): Promise<ActiveDevelopState> {
  await ensurePhotoDocument(database, request);
  const document = await loadActiveDocument(database, request.photoId);
  if (!document) throw new Error("The active photo document is missing");
  const output = await loadNode(database, request.photoId, document.roots.base);
  const pixelOutputNodeId = await markupFreeOutputNode(
    database,
    request.photoId,
    document.roots.output,
  );
  if (output.kind !== "output") throw new Error("The active base root is not an output node");
  const outputInputs = await loadInputs(database, request.photoId, output.id);
  if (outputInputs.length !== 1) throw new Error("The active output node must have one input");
  const input = await loadNode(database, request.photoId, outputInputs[0]);
  const layerDevelop = Object.fromEntries(
    await Promise.all(
      document.layers.map(async (layer) => [
        layer.id,
        await readLayerDevelop(database, request.photoId, layer.contentNodeId),
      ]),
    ),
  );
  if (isDevelopSource(input)) {
    return {
      photoId: request.photoId,
      revisionId: document.revisionId,
      outputNodeId: document.roots.output,
      pixelOutputNodeId,
      baseNodeId: document.roots.base,
      sourceNodeId: input.id,
      outputParameters: output.parameters,
      develop: {},
      hasDevelopNode: false,
      layers: document.layers,
      layerDevelop,
      renderHash: document.renderHash,
      revisionMetadata: document.metadata,
    };
  }
  if (input.kind !== "develop") {
    throw new Error(`Develop state cannot be replaced beneath ${input.kind} before layers land`);
  }
  const developInputs = await loadInputs(database, request.photoId, input.id);
  if (developInputs.length !== 1) throw new Error("The active develop node must have one input");
  const source = await loadNode(database, request.photoId, developInputs[0]);
  if (!isDevelopSource(source))
    throw new Error("The active develop node must consume the source node");
  return {
    photoId: request.photoId,
    revisionId: document.revisionId,
    outputNodeId: document.roots.output,
    pixelOutputNodeId,
    baseNodeId: document.roots.base,
    sourceNodeId: source.id,
    outputParameters: output.parameters,
    develop: developDictSchema.parse(input.parameters),
    hasDevelopNode: true,
    layers: document.layers,
    layerDevelop,
    renderHash: document.renderHash,
    revisionMetadata: document.metadata,
  };
}

function isDevelopSource(node: { kind: ImageNodeKind; recipeVersion: number }): boolean {
  return node.kind === "source" || (node.kind === "generate" && node.recipeVersion === 2);
}

export async function commitDevelopState(
  database: GraphDatabase,
  current: ActiveDevelopState,
  develop: DevelopDict,
  metadata?: Record<string, JsonValue>,
): Promise<{
  revisionId: string;
  renderHash: `r_${string}`;
  layers: { deltaApplied: string[]; stale: string[] };
}> {
  const unfilledVacancies = await unfilledVacancyLayerIds(
    database,
    current.photoId,
    current.layers,
  );
  const layerChanges = current.layers.map((layer) =>
    unfilledVacancies.has(layer.id)
      ? null
      : planDevelopChange(current.layerDevelop[layer.id] ?? {}, develop),
  );
  const nodes: NodeDraft[] = [
    {
      localKey: "develop",
      kind: "develop",
      recipeVersion: 1,
      parameters: develop,
      inputs: [{ nodeId: current.sourceNodeId }],
    },
    {
      localKey: "base-output",
      kind: "output",
      recipeVersion: 1,
      parameters: current.outputParameters,
      inputs: [{ localKey: "develop" }],
    },
  ];
  const layers: RevisionLayerDraft[] = current.layers.map((layer, index) => {
    const change = layerChanges[index];
    let contentNode: NodeReference = { nodeId: layer.contentNodeId };
    if (change?.tier === 1) {
      for (const [step, compensation] of change.compensations.entries()) {
        const localKey = `delta-${index}-${step}`;
        nodes.push({
          localKey,
          kind: "delta",
          recipeVersion: 1,
          parameters: compensation,
          inputs: [contentNode],
        });
        contentNode = { localKey };
      }
    }
    return {
      layer: { layerId: layer.id },
      name: layer.name,
      z: layer.z,
      contentNode,
      maskNode: { nodeId: layer.maskNodeId },
      opacity: layer.opacity,
      blend: layer.blend,
      enabled: layer.enabled,
    };
  });
  const rootUpdates: Array<{
    root: "base" | "output";
    node: { localKey: string };
  }> = [{ root: "base", node: { localKey: "base-output" } }];
  if (layers.length === 0) {
    rootUpdates.push({ root: "output", node: { localKey: "base-output" } });
  } else {
    const projection = compositeV2Projection({ localKey: "base-output" }, layers);
    nodes.push({
      localKey: "composite",
      kind: "composite",
      recipeVersion: 2,
      ...projection,
    });
    rootUpdates.push({ root: "output", node: { localKey: "composite" } });
  }
  const committed = await commitRevision(database, {
    photoId: current.photoId,
    expectedRevisionId: current.revisionId,
    nodes,
    rootUpdates,
    layers,
    ...(metadata === undefined ? {} : { metadata }),
  });
  if (!committed.renderHash || !/^r_[0-9a-f]{64}$/.test(committed.renderHash)) {
    throw new Error("A develop revision must commit an output render hash");
  }
  return {
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    layers: {
      deltaApplied: committed.layers
        .filter((_, index) => layerChanges[index]?.tier === 1)
        .map(({ id }) => id),
      stale: committed.layers
        .filter((_, index) => layerChanges[index]?.tier === 2)
        .map(({ id }) => id),
    },
  };
}

async function readLayerDevelop(
  database: GraphDatabase,
  photoId: string,
  contentNodeId: string,
): Promise<DevelopDict> {
  const result = await database.query<{
    depth: number;
    kind: ImageNodeKind;
    parameters: JsonValue;
  }>(
    `WITH RECURSIVE lineage(node_id, depth) AS (
       SELECT $2::text, 0
       UNION ALL
       SELECT edge.input_node_id, lineage.depth + 1
       FROM lineage
       JOIN image_node_inputs AS edge
         ON edge.photo_id = $1 AND edge.node_id = lineage.node_id AND edge.input_index = 0
     )
     SELECT lineage.depth, node.kind, node.parameters
     FROM lineage
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
     ORDER BY lineage.depth DESC`,
    [photoId, contentNodeId],
  );
  let develop: DevelopDict = {};
  for (const node of result.rows) {
    if (node.kind === "develop") develop = developDictSchema.parse(node.parameters);
    if (node.kind === "delta") {
      develop = applyDevelopCompensation(develop, developDictSchema.parse(node.parameters));
    }
  }
  return develop;
}

async function loadNode(
  database: GraphDatabase,
  photoId: string,
  nodeId: string,
): Promise<{ id: string; kind: ImageNodeKind; recipeVersion: number; parameters: JsonValue }> {
  const result = await database.query<{
    id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
  }>(
    "SELECT id, kind, recipe_version, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2",
    [photoId, nodeId],
  );
  const node = result.rows[0];
  if (!node) throw new Error(`Graph node does not exist for photo: ${nodeId}`);
  return { ...node, recipeVersion: node.recipe_version };
}

async function loadInputs(
  database: GraphDatabase,
  photoId: string,
  nodeId: string,
): Promise<string[]> {
  const result = await database.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  return result.rows.map((row) => row.input_node_id);
}
