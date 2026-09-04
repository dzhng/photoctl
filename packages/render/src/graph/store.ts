import { randomUUID } from "node:crypto";
import {
  canonicalJson,
  canonicalNodeRecipe,
  canonicalParameters,
  imageNodeRegistry,
  logicalNodeId,
  recipeHash,
  renderHashForNode,
} from "./recipes.js";
import type { ImageNodeKind, JsonValue, StoredImageNode } from "./types.js";

interface QueryResult<Row> {
  rows: Row[];
}

export interface GraphTransaction {
  query<Row>(sql: string, parameters?: unknown[]): Promise<QueryResult<Row>>;
}

export interface GraphDatabase extends GraphTransaction {
  transaction<Result>(run: (transaction: GraphTransaction) => Promise<Result>): Promise<Result>;
}

export type NodeReference = { nodeId: string } | { localKey: string };
export interface NodeDraft {
  localKey: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  parameters: JsonValue;
  inputs: NodeReference[];
}
export interface CommitRevisionRequest {
  photoId: string;
  expectedRevisionId: string | null;
  nodes: NodeDraft[];
  rootUpdates: Array<{ root: "output"; node: NodeReference }>;
}
export interface CommitRevisionResult {
  revisionId: string;
  nodes: Record<string, StoredImageNode>;
  roots: { output?: string };
  renderHash: string | null;
}

export async function commitRevision(
  database: GraphDatabase,
  request: CommitRevisionRequest,
): Promise<CommitRevisionResult> {
  assertRequestShape(request);
  return await database.transaction(async (transaction) => {
    const activeRevisionId = await lockDocument(transaction, request.photoId);
    if (activeRevisionId !== request.expectedRevisionId) {
      throw new Error("The document changed before this revision could be committed");
    }

    const drafts = new Map(request.nodes.map((node) => [node.localKey, node]));
    const resolved = new Map<string, StoredImageNode>();
    const resolving = new Set<string>();
    const resolveReference = async (reference: NodeReference): Promise<StoredImageNode> => {
      if ("nodeId" in reference) {
        return await loadNode(transaction, request.photoId, reference.nodeId);
      }
      const cached = resolved.get(reference.localKey);
      if (cached) return cached;
      const draft = drafts.get(reference.localKey);
      if (!draft) throw new Error(`Unknown local graph node: ${reference.localKey}`);
      if (resolving.has(reference.localKey)) throw new Error("Image graph cycle refused");
      resolving.add(reference.localKey);
      const inputs = await mapInOrder(draft.inputs, resolveReference);
      const parameters = canonicalParameters(draft.kind, draft.parameters);
      const recipe = recipeHash(
        canonicalNodeRecipe({
          kind: draft.kind,
          recipeVersion: draft.recipeVersion,
          parameters,
          inputNodeIds: inputs.map((input) => input.id),
        }),
      );
      const node: StoredImageNode = {
        id: logicalNodeId(recipe),
        photoId: request.photoId,
        kind: draft.kind,
        recipeVersion: draft.recipeVersion,
        parameters,
        recipeHash: recipe,
      };
      await storeNode(transaction, node, inputs);
      resolving.delete(reference.localKey);
      resolved.set(reference.localKey, node);
      return node;
    };

    const rootUpdates = new Map<"output", string>(
      await mapInOrder(request.rootUpdates, async (update) => {
        const node = await resolveReference(update.node);
        await assertRootActivationAllowed(transaction, node);
        return [update.root, node.id];
      }),
    );
    if (resolved.size !== drafts.size) {
      throw new Error("Every supplied graph node must be reachable from a resulting document root");
    }

    const revisionId = randomUUID();
    await transaction.query(
      `INSERT INTO document_revisions (id, photo_id, parent_revision_id)
       VALUES ($1, $2, $3)`,
      [revisionId, request.photoId, activeRevisionId],
    );
    if (activeRevisionId) {
      await transaction.query(
        `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
         SELECT $1, photo_id, root_name, node_id FROM document_revision_roots
         WHERE photo_id = $2 AND revision_id = $3`,
        [revisionId, request.photoId, activeRevisionId],
      );
    }
    await mapInOrder([...rootUpdates], async ([root, nodeId]) => {
      await transaction.query(
        `INSERT INTO document_revision_roots (revision_id, photo_id, root_name, node_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (photo_id, revision_id, root_name)
         DO UPDATE SET node_id = EXCLUDED.node_id`,
        [revisionId, request.photoId, root, nodeId],
      );
    });
    await transaction.query(
      "UPDATE photo_documents SET active_revision_id = $1 WHERE photo_id = $2",
      [revisionId, request.photoId],
    );
    const roots = await loadRevisionRoots(transaction, request.photoId, revisionId);
    return {
      revisionId,
      nodes: Object.fromEntries(resolved),
      roots,
      renderHash: roots.output ? renderHashForNode(roots.output) : null,
    };
  });
}

export async function undoRevision(
  database: GraphDatabase,
  request: { photoId: string; expectedRevisionId: string },
): Promise<{ revisionId: string | null; renderHash: string | null }> {
  return await database.transaction(async (transaction) => {
    const activeRevisionId = await lockDocument(transaction, request.photoId);
    if (activeRevisionId !== request.expectedRevisionId) {
      throw new Error("The document changed before undo could be committed");
    }
    const revision = await transaction.query<{ parent_revision_id: string | null }>(
      "SELECT parent_revision_id FROM document_revisions WHERE id = $1 AND photo_id = $2",
      [activeRevisionId, request.photoId],
    );
    const parentRevisionId = revision.rows[0]?.parent_revision_id ?? null;
    await transaction.query(
      "UPDATE photo_documents SET active_revision_id = $1 WHERE photo_id = $2",
      [parentRevisionId, request.photoId],
    );
    const roots = parentRevisionId
      ? await loadRevisionRoots(transaction, request.photoId, parentRevisionId)
      : ({} as { output?: string });
    return {
      revisionId: parentRevisionId,
      renderHash: roots.output ? renderHashForNode(roots.output) : null,
    };
  });
}

async function lockDocument(
  transaction: GraphTransaction,
  photoId: string,
): Promise<string | null> {
  await transaction.query(
    `INSERT INTO photo_documents (photo_id, active_revision_id)
     VALUES ($1, NULL) ON CONFLICT (photo_id) DO NOTHING`,
    [photoId],
  );
  const result = await transaction.query<{ active_revision_id: string | null }>(
    "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1 FOR UPDATE",
    [photoId],
  );
  if (result.rows.length !== 1) throw new Error(`Photo does not exist: ${photoId}`);
  return result.rows[0].active_revision_id;
}

async function storeNode(
  transaction: GraphTransaction,
  node: StoredImageNode,
  inputs: StoredImageNode[],
): Promise<void> {
  await transaction.query(
    `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (photo_id, id) DO NOTHING`,
    [
      node.photoId,
      node.id,
      node.kind,
      node.recipeVersion,
      JSON.stringify(node.parameters),
      node.recipeHash,
    ],
  );
  const stored = await loadNode(transaction, node.photoId, node.id);
  if (
    stored.kind !== node.kind ||
    stored.recipeVersion !== node.recipeVersion ||
    stored.recipeHash !== node.recipeHash ||
    canonicalJson(stored.parameters) !== canonicalJson(node.parameters)
  ) {
    throw new Error(`Image node identity collision: ${node.id}`);
  }
  await mapInOrder(inputs, async (input, index) => {
    await transaction.query(
      `INSERT INTO image_node_inputs (photo_id, node_id, input_index, input_node_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (photo_id, node_id, input_index) DO NOTHING`,
      [node.photoId, node.id, index, input.id],
    );
  });
  const storedInputs = await transaction.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [node.photoId, node.id],
  );
  if (
    storedInputs.rows.length !== inputs.length ||
    storedInputs.rows.some((input, index) => input.input_node_id !== inputs[index].id)
  ) {
    throw new Error(`Image node identity collision: ${node.id}`);
  }
}

async function loadNode(
  transaction: GraphTransaction,
  photoId: string,
  nodeId: string,
): Promise<StoredImageNode> {
  const result = await transaction.query<{
    id: string;
    photo_id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
    recipe_hash: string;
  }>(
    `SELECT id, photo_id, kind, recipe_version, parameters, recipe_hash
     FROM image_nodes WHERE photo_id = $1 AND id = $2`,
    [photoId, nodeId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Graph input does not exist for photo: ${nodeId}`);
  return {
    id: row.id,
    photoId: row.photo_id,
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
    recipeHash: row.recipe_hash,
  };
}

async function assertRootActivationAllowed(
  transaction: GraphTransaction,
  node: StoredImageNode,
): Promise<void> {
  const reachable = await transaction.query<{
    id: string;
    kind: ImageNodeKind;
    has_published_artifact: boolean;
  }>(
    `WITH RECURSIVE reachable(node_id) AS (
       VALUES ($2::text)
       UNION
       SELECT edge.input_node_id
       FROM image_node_inputs AS edge
       JOIN reachable ON reachable.node_id = edge.node_id
       WHERE edge.photo_id = $1
     )
     SELECT candidate.id, candidate.kind,
       EXISTS (
         SELECT 1 FROM node_executions AS execution
         JOIN image_artifacts AS artifact
           ON artifact.artifact_hash = execution.output_artifact_hash
         WHERE execution.photo_id = candidate.photo_id
           AND execution.node_id = candidate.id
           AND artifact.artifact_available = true
       ) AS has_published_artifact
     FROM reachable
     JOIN image_nodes AS candidate
       ON candidate.photo_id = $1 AND candidate.id = reachable.node_id`,
    [node.photoId, node.id],
  );
  const unavailable = reachable.rows.find(
    (candidate) =>
      !imageNodeRegistry[candidate.kind].deterministic && !candidate.has_published_artifact,
  );
  if (unavailable) {
    throw new Error(
      "A nondeterministic output cannot become active before its artifact is published",
    );
  }
}

async function loadRevisionRoots(
  transaction: GraphTransaction,
  photoId: string,
  revisionId: string,
): Promise<{ output?: string }> {
  const result = await transaction.query<{ root_name: "output"; node_id: string }>(
    `SELECT root_name, node_id FROM document_revision_roots
     WHERE photo_id = $1 AND revision_id = $2`,
    [photoId, revisionId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.root_name, row.node_id]));
}

function assertRequestShape(request: CommitRevisionRequest): void {
  const keys = request.nodes.map((node) => node.localKey);
  if (keys.some((key) => key.length === 0) || new Set(keys).size !== keys.length) {
    throw new Error("Local graph node keys must be non-empty and unique");
  }
  const roots = request.rootUpdates.map((update) => update.root);
  if (new Set(roots).size !== roots.length) throw new Error("A revision may update each root once");
  if (request.rootUpdates.length === 0) {
    throw new Error("A revision must redirect at least one document root");
  }
}

async function mapInOrder<Input, Output>(
  values: Input[],
  map: (value: Input, index: number) => Promise<Output>,
  index = 0,
  output: Output[] = [],
): Promise<Output[]> {
  if (index === values.length) return output;
  output.push(await map(values[index], index));
  return await mapInOrder(values, map, index + 1, output);
}
