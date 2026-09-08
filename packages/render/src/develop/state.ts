import {
  commitRevision,
  ensurePhotoDocument,
  loadActiveDocument,
  type GraphDatabase,
  type NodeDraft,
  type NodeReference,
} from "../graph/store.js";
import type { ImageNodeKind, JsonValue } from "../graph/types.js";
import { layerDraft, type RevisionLayer, type RevisionLayerDraft } from "../layers/model.js";
import { unfilledVacancyLayerIds } from "../layers/status.js";
import { developDictSchema, type DevelopDict } from "./dict.js";
import { applyDevelopCompensation, planDevelopChange } from "./tiers.js";
import { markupFreeOutputNode } from "../markup/graph.js";
import { readBaseDevelopInput, type BaseDevelopInput } from "../graph/base-input.js";
import { planDevelopIntent } from "../graph/output.js";
import { isDeepStrictEqual } from "node:util";

export interface ActiveDevelopState extends BaseDevelopInput {
  photoId: string;
  revisionId: string;
  geometryNodeId?: string;
  outputNodeId: string;
  /** Current RGB output without the final editable markup presentation node. */
  pixelOutputNodeId: string;
  baseNodeId: string;
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
  const base = await readBaseDevelopInput(database, request.photoId, document.roots.base);
  const pixelOutputNodeId = await markupFreeOutputNode(
    database,
    request.photoId,
    document.roots.output,
  );
  const layerDevelop = Object.fromEntries(
    await Promise.all(
      document.layers.map(async (layer) => [
        layer.id,
        await readLayerDevelop(database, request.photoId, layer.contentNodeId),
      ]),
    ),
  );
  return {
    ...base,
    photoId: request.photoId,
    revisionId: document.revisionId,
    geometryNodeId: document.roots.geometry,
    outputNodeId: document.roots.output,
    pixelOutputNodeId,
    baseNodeId: document.roots.base,
    layers: document.layers,
    layerDevelop,
    renderHash: document.renderHash,
    revisionMetadata: document.metadata,
  };
}

export async function commitDevelopState(
  database: GraphDatabase,
  current: ActiveDevelopState,
  develop: DevelopDict,
  metadata?: Record<string, JsonValue> | null,
  touchedGeometry: readonly ("crop" | "aspect_ratio")[] = (
    ["crop", "aspect_ratio"] as const
  ).filter((key) => !isDeepStrictEqual(current.develop[key], develop[key])),
): Promise<{
  revisionId: string;
  renderHash: `r_${string}`;
  layers: { deltaApplied: string[]; stale: string[] };
}> {
  const intent = await planDevelopIntent(database, current, develop, touchedGeometry);
  if (!intent.changed && metadata === undefined)
    return {
      revisionId: current.revisionId,
      renderHash: current.renderHash,
      layers: { deltaApplied: [], stale: [] },
    };
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
      inputs: [{ nodeId: current.developInputNodeId }],
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
    return layerDraft(layer, layer.z, contentNode);
  });
  const committed = await commitRevision(database, {
    outputPlan: "photographic",
    photoId: current.photoId,
    expectedRevisionId: current.revisionId,
    nodes: [...nodes, ...intent.nodes],
    rootUpdates: [{ root: "base", node: { localKey: "base-output" } }, ...intent.rootUpdates],
    layers,
    ...(metadata == null ? {} : { metadata }),
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
