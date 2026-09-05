import { canonicalJson } from "../graph/recipes.js";
import type {
  CommitRevisionRequest,
  GraphTransaction,
  NodeDraft,
  NodeReference,
} from "../graph/store.js";
import { markupDocumentSchema, type MarkupDocument } from "@photoctl/protocol";

type StoredNode = { id: string; kind: string; recipeVersion: number; parameters: unknown };

export async function projectMarkupRequest(
  transaction: GraphTransaction,
  request: CommitRevisionRequest,
  activeRevisionId: string | null,
): Promise<{
  nodes: NodeDraft[];
  rootUpdates: CommitRevisionRequest["rootUpdates"];
  document: MarkupDocument;
}> {
  const stored = await transaction.query<{ items: unknown }>(
    "SELECT items FROM markup WHERE photo_id = $1",
    [request.photoId],
  );
  const document = markupDocumentSchema.parse(
    request.markupDocument === undefined ? (stored.rows[0]?.items ?? []) : request.markupDocument,
  );
  const nodes = [...request.nodes];
  const rootUpdates = [...request.rootUpdates];
  const outputIndex = rootUpdates.findIndex(({ root }) => root === "output");
  const baseIndex = rootUpdates.findIndex(({ root }) => root === "base");
  let currentOutput: StoredNode | undefined;
  let currentUnderlying: NodeReference | undefined;
  if (activeRevisionId) {
    const outputNodeId = await revisionOutput(transaction, request.photoId, activeRevisionId);
    if (outputNodeId) {
      currentOutput = await loadNode(transaction, request.photoId, outputNodeId);
      currentUnderlying = { nodeId: outputNodeId };
      if (currentOutput.kind === "markup") {
        currentUnderlying = {
          nodeId: await markupInput(transaction, request.photoId, outputNodeId),
        };
      }
    }
  }
  const explicitChange = request.markupDocument !== undefined;
  const underlyingUpdate =
    outputIndex >= 0
      ? rootUpdates[outputIndex]!.node
      : baseIndex >= 0
        ? rootUpdates[baseIndex]!.node
        : currentUnderlying;
  if (document.length > 0 && (explicitChange || outputIndex >= 0 || baseIndex >= 0)) {
    if (!underlyingUpdate) throw new Error("Markup requires an existing RGB output");
    let localKey = "markup-output";
    while (nodes.some((node) => node.localKey === localKey)) localKey += "-next";
    nodes.push({
      localKey,
      kind: "markup",
      recipeVersion: 1,
      parameters: { document },
      inputs: [underlyingUpdate],
    });
    const update = { root: "output" as const, node: { localKey } };
    if (outputIndex >= 0) rootUpdates[outputIndex] = update;
    else rootUpdates.push(update);
  } else if (document.length === 0 && explicitChange && currentOutput?.kind === "markup") {
    if (!underlyingUpdate) throw new Error("Markup output is missing its RGB input");
    const update = { root: "output" as const, node: underlyingUpdate };
    if (outputIndex >= 0) rootUpdates[outputIndex] = update;
    else rootUpdates.push(update);
  }
  return { nodes, rootUpdates, document };
}

export async function unwrapMarkupProjection(
  transaction: GraphTransaction,
  photoId: string,
  outputNodeId: string,
  document: MarkupDocument,
): Promise<string> {
  const output = await loadNode(transaction, photoId, outputNodeId);
  if (document.length === 0) {
    if (output.kind === "markup") {
      throw new Error("An empty markup document cannot retain a markup output wrapper");
    }
    return outputNodeId;
  }
  if (output.kind !== "markup" || output.recipeVersion !== 1) {
    throw new Error("A non-empty markup document must be the final output projection");
  }
  const projected = markupDocumentSchema.parse(
    (output.parameters as { document?: unknown }).document,
  );
  if (canonicalJson(projected) !== canonicalJson(document)) {
    throw new Error("The markup output recipe must match the persisted document");
  }
  return await markupInput(transaction, photoId, outputNodeId);
}

export async function markupFreeOutputNode(
  transaction: GraphTransaction,
  photoId: string,
  outputNodeId: string,
): Promise<string> {
  const output = await loadNode(transaction, photoId, outputNodeId);
  return output.kind === "markup"
    ? await markupInput(transaction, photoId, outputNodeId)
    : outputNodeId;
}

export async function restoreMarkupForRevision(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string | null,
): Promise<void> {
  let document: MarkupDocument = [];
  if (revisionId) {
    const outputNodeId = await revisionOutput(transaction, photoId, revisionId);
    if (outputNodeId) {
      const output = await loadNode(transaction, photoId, outputNodeId);
      if (output.kind === "markup") {
        document = markupDocumentSchema.parse(
          (output.parameters as { document?: unknown }).document,
        );
      }
    }
  }
  await transaction.query(
    `INSERT INTO markup (photo_id, items) VALUES ($1, $2::jsonb)
     ON CONFLICT (photo_id) DO UPDATE SET items = EXCLUDED.items`,
    [photoId, canonicalJson(document)],
  );
}

async function revisionOutput(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string,
): Promise<string | undefined> {
  const result = await transaction.query<{ node_id: string }>(
    `SELECT node_id FROM document_revision_roots
     WHERE photo_id = $1 AND revision_id = $2 AND root_name = 'output'`,
    [photoId, revisionId],
  );
  return result.rows[0]?.node_id;
}

async function markupInput(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<string> {
  const result = await transaction.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  if (result.rows.length !== 1) throw new Error("A markup output requires one input");
  return result.rows[0]!.input_node_id;
}

async function loadNode(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<StoredNode> {
  const result = await transaction.query<{
    id: string;
    kind: string;
    recipe_version: number;
    parameters: unknown;
  }>(
    `SELECT id, kind, recipe_version, parameters FROM image_nodes
     WHERE photo_id = $1 AND id = $2`,
    [photoId, nodeId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Graph input does not exist for photo: ${nodeId}`);
  return {
    id: row.id,
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
  };
}
