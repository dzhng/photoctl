import { commitRevision, ensurePhotoDocument, type GraphDatabase } from "../graph/store.js";
import type { ImageNodeKind, JsonValue } from "../graph/types.js";
import { developDictSchema, type DevelopDict } from "./dict.js";

export interface ActiveDevelopState {
  photoId: string;
  revisionId: string;
  outputNodeId: string;
  sourceNodeId: string;
  outputParameters: JsonValue;
  develop: DevelopDict;
  hasDevelopNode: boolean;
  renderHash: `r_${string}`;
}

export async function readActiveDevelopState(
  database: GraphDatabase,
  request: { photoId: string; orientation: number },
): Promise<ActiveDevelopState> {
  const document = await ensurePhotoDocument(database, request);
  const output = await loadNode(database, request.photoId, document.outputNodeId);
  if (output.kind !== "output") throw new Error("The active photo root is not an output node");
  const outputInputs = await loadInputs(database, request.photoId, output.id);
  if (outputInputs.length !== 1) throw new Error("The active output node must have one input");
  const input = await loadNode(database, request.photoId, outputInputs[0]);
  if (input.kind === "source") {
    return {
      photoId: request.photoId,
      revisionId: document.revisionId,
      outputNodeId: output.id,
      sourceNodeId: input.id,
      outputParameters: output.parameters,
      develop: {},
      hasDevelopNode: false,
      renderHash: document.renderHash,
    };
  }
  if (input.kind !== "develop") {
    throw new Error(`Develop state cannot be replaced beneath ${input.kind} before layers land`);
  }
  const developInputs = await loadInputs(database, request.photoId, input.id);
  if (developInputs.length !== 1) throw new Error("The active develop node must have one input");
  const source = await loadNode(database, request.photoId, developInputs[0]);
  if (source.kind !== "source")
    throw new Error("The active develop node must consume the source node");
  return {
    photoId: request.photoId,
    revisionId: document.revisionId,
    outputNodeId: output.id,
    sourceNodeId: source.id,
    outputParameters: output.parameters,
    develop: developDictSchema.parse(input.parameters),
    hasDevelopNode: true,
    renderHash: document.renderHash,
  };
}

export async function commitDevelopState(
  database: GraphDatabase,
  current: ActiveDevelopState,
  develop: DevelopDict,
): Promise<{ revisionId: string; renderHash: `r_${string}` }> {
  const committed = await commitRevision(database, {
    photoId: current.photoId,
    expectedRevisionId: current.revisionId,
    nodes: [
      {
        localKey: "develop",
        kind: "develop",
        recipeVersion: 1,
        parameters: develop,
        inputs: [{ nodeId: current.sourceNodeId }],
      },
      {
        localKey: "output",
        kind: "output",
        recipeVersion: 1,
        parameters: current.outputParameters,
        inputs: [{ localKey: "develop" }],
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "output" } }],
  });
  if (!committed.renderHash || !/^r_[0-9a-f]{64}$/.test(committed.renderHash)) {
    throw new Error("A develop revision must commit an output render hash");
  }
  return {
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
  };
}

async function loadNode(
  database: GraphDatabase,
  photoId: string,
  nodeId: string,
): Promise<{ id: string; kind: ImageNodeKind; parameters: JsonValue }> {
  const result = await database.query<{
    id: string;
    kind: ImageNodeKind;
    parameters: JsonValue;
  }>("SELECT id, kind, parameters FROM image_nodes WHERE photo_id = $1 AND id = $2", [
    photoId,
    nodeId,
  ]);
  const node = result.rows[0];
  if (!node) throw new Error(`Graph node does not exist for photo: ${nodeId}`);
  return node;
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
