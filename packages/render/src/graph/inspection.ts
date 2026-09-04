/* eslint-disable no-await-in-loop -- Inspection intentionally bounds database pressure within each page. */
import { createHash } from "node:crypto";
import { renderHashForNode } from "./recipes.js";
import type { ImageNodeKind } from "./types.js";
import type { GraphTransaction } from "./store.js";

const MAX_PAGE = 100;
const MAX_SUMMARY_INPUTS = 32;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface GraphNodeSummary {
  id: string;
  kind: ImageNodeKind;
  recipeVersion: number;
  recipeHash: string;
  inputNodeIds: string[];
  inputCount: number;
  executionCount: number;
  artifactAvailable: boolean;
}

export interface GraphPage {
  photoId: string;
  revisionId: string;
  parentRevisionId: string | null;
  pinned: boolean;
  roots: { output?: string };
  renderHash: string | null;
  nodes: GraphNodeSummary[];
  nextCursor: string | null;
}

export interface GraphNodeRecord extends GraphNodeSummary {
  photoId: string;
  parameters: unknown | null;
  parametersTruncated: boolean;
  consumerNodeIds: string[];
  consumerCount: number;
  executions: Array<{
    executionId: string;
    evaluationHash: string;
    deterministic: boolean;
    outputArtifactHash: string;
    artifactAvailable: boolean;
    sourceProvenance: unknown | null;
    providerProvenance: unknown | null;
  }>;
  executionCount: number;
  recordTruncated: boolean;
}

export async function inspectGraph(
  database: GraphTransaction,
  request: {
    photoId: string;
    history?: boolean;
    limit?: number;
    cursor?: string;
  },
): Promise<GraphPage> {
  const history = request.history ?? false;
  const limit = request.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw new Error(`Graph page limit must be between 1 and ${MAX_PAGE}`);
  }
  const cursor = request.cursor ? parseCursor(request.cursor) : undefined;
  if (cursor && (cursor.photoId !== request.photoId || cursor.history !== history)) {
    throw new Error("Graph cursor does not match this inspection request");
  }
  const revisionId = cursor?.revisionId ?? (await activeRevision(database, request.photoId));
  if (!revisionId) throw new Error(`Photo has no document revision: ${request.photoId}`);
  const revision = await database.query<{
    parent_revision_id: string | null;
    pinned: boolean;
  }>(
    `SELECT parent_revision_id, pinned FROM document_revisions
     WHERE photo_id = $1 AND id = $2`,
    [request.photoId, revisionId],
  );
  if (!revision.rows[0]) throw new Error("Graph cursor refers to a missing document revision");
  const result = await database.query<{
    id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    recipe_hash: string;
    input_count: string;
    execution_count: string;
    artifact_available: boolean;
  }>(
    `WITH RECURSIVE revisions(id) AS (
       SELECT $2::uuid
       UNION ALL
       SELECT revision.parent_revision_id
       FROM document_revisions AS revision
       JOIN revisions ON revision.photo_id = $1 AND revision.id = revisions.id
       WHERE $3::boolean AND revision.parent_revision_id IS NOT NULL
     ), reachable(id) AS (
       SELECT root.node_id
       FROM document_revision_roots AS root
       JOIN revisions ON revisions.id = root.revision_id
       WHERE root.photo_id = $1
       UNION
       SELECT edge.input_node_id
       FROM image_node_inputs AS edge
       JOIN reachable ON reachable.id = edge.node_id
       WHERE edge.photo_id = $1
     )
     SELECT node.id, node.kind, node.recipe_version, node.recipe_hash,
       (SELECT count(*)::text FROM image_node_inputs AS input
        WHERE input.photo_id = node.photo_id AND input.node_id = node.id) AS input_count,
       (SELECT count(*)::text FROM node_executions AS execution
        WHERE execution.photo_id = node.photo_id AND execution.node_id = node.id) AS execution_count,
       EXISTS (
         SELECT 1 FROM node_executions AS execution
         JOIN image_artifacts AS artifact
           ON artifact.artifact_hash = execution.output_artifact_hash
         WHERE execution.photo_id = node.photo_id AND execution.node_id = node.id
           AND artifact.artifact_available = true
       ) AS artifact_available
     FROM reachable
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = reachable.id
     WHERE node.id > $4
     ORDER BY node.id
     LIMIT $5`,
    [request.photoId, revisionId, history, cursor?.afterNodeId ?? "", limit + 1],
  );
  const hasNext = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const nodes: GraphNodeSummary[] = [];
  for (const row of rows) {
    const inputs = await database.query<{ input_node_id: string }>(
      `SELECT input_node_id FROM image_node_inputs
       WHERE photo_id = $1 AND node_id = $2 AND input_index < $3
       ORDER BY input_index`,
      [request.photoId, row.id, MAX_SUMMARY_INPUTS],
    );
    nodes.push({
      id: row.id,
      kind: row.kind,
      recipeVersion: row.recipe_version,
      recipeHash: row.recipe_hash,
      inputNodeIds: inputs.rows.map((input) => input.input_node_id),
      inputCount: Number(row.input_count),
      executionCount: Number(row.execution_count),
      artifactAvailable: row.artifact_available,
    });
  }
  const roots = await database.query<{ root_name: "output"; node_id: string }>(
    `SELECT root_name, node_id FROM document_revision_roots
     WHERE photo_id = $1 AND revision_id = $2`,
    [request.photoId, revisionId],
  );
  const rootMap = Object.fromEntries(roots.rows.map((root) => [root.root_name, root.node_id])) as {
    output?: string;
  };
  return {
    photoId: request.photoId,
    revisionId,
    parentRevisionId: revision.rows[0].parent_revision_id,
    pinned: revision.rows[0].pinned,
    roots: rootMap,
    renderHash: rootMap.output ? renderHashForNode(rootMap.output) : null,
    nodes,
    nextCursor:
      hasNext && nodes.length > 0
        ? createCursor({
            photoId: request.photoId,
            revisionId,
            history,
            afterNodeId: nodes.at(-1)!.id,
          })
        : null,
  };
}

export async function inspectGraphNode(
  database: GraphTransaction,
  request: { photoId: string; nodeId: string },
): Promise<GraphNodeRecord> {
  const result = await database.query<{
    id: string;
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: unknown;
    recipe_hash: string;
    input_count: string;
    consumer_count: string;
    execution_count: string;
    artifact_available: boolean;
  }>(
    `SELECT node.id, node.kind, node.recipe_version, node.parameters, node.recipe_hash,
       (SELECT count(*)::text FROM image_node_inputs AS input
        WHERE input.photo_id = node.photo_id AND input.node_id = node.id) AS input_count,
       (SELECT count(*)::text FROM image_node_inputs AS consumer
        WHERE consumer.photo_id = node.photo_id AND consumer.input_node_id = node.id) AS consumer_count,
       (SELECT count(*)::text FROM node_executions AS execution
        WHERE execution.photo_id = node.photo_id AND execution.node_id = node.id) AS execution_count,
       EXISTS (
         SELECT 1 FROM node_executions AS execution
         JOIN image_artifacts AS artifact
           ON artifact.artifact_hash = execution.output_artifact_hash
         WHERE execution.photo_id = node.photo_id AND execution.node_id = node.id
           AND artifact.artifact_available = true
       ) AS artifact_available
     FROM image_nodes AS node WHERE node.photo_id = $1 AND node.id = $2`,
    [request.photoId, request.nodeId],
  );
  const node = result.rows[0];
  if (!node) throw new Error(`Graph node does not exist for photo: ${request.nodeId}`);
  const [inputs, consumers, executions] = await Promise.all([
    database.query<{ input_node_id: string }>(
      `SELECT input_node_id FROM image_node_inputs
       WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index LIMIT 65`,
      [request.photoId, request.nodeId],
    ),
    database.query<{ node_id: string }>(
      `SELECT node_id FROM image_node_inputs
       WHERE photo_id = $1 AND input_node_id = $2 ORDER BY node_id LIMIT 65`,
      [request.photoId, request.nodeId],
    ),
    database.query<{
      execution_id: string;
      evaluation_hash: string;
      deterministic: boolean;
      output_artifact_hash: string;
      artifact_available: boolean;
      source_locator: unknown | null;
      source_tier: string | null;
      source_w: number | null;
      source_h: number | null;
      decoder_id: string | null;
      decoder_version: string | null;
      provider_execution: Record<string, unknown> | null;
      input_artifact_hashes: string[];
      output_w: number;
      output_h: number;
    }>(
      `SELECT execution.execution_id, execution.evaluation_hash, execution.deterministic,
         execution.output_artifact_hash, artifact.artifact_available,
         execution.source_locator, execution.source_tier, execution.source_w,
         execution.source_h, execution.decoder_id, execution.decoder_version,
         execution.provider_execution,
         ARRAY(
           SELECT input.input_artifact_hash
           FROM node_execution_inputs AS input
           WHERE input.photo_id = execution.photo_id
             AND input.execution_id = execution.execution_id
           ORDER BY input.input_index
         ) AS input_artifact_hashes,
         artifact.w AS output_w, artifact.h AS output_h
       FROM node_executions AS execution
       JOIN image_artifacts AS artifact
         ON artifact.artifact_hash = execution.output_artifact_hash
       WHERE execution.photo_id = $1 AND execution.node_id = $2
       ORDER BY execution.created_at DESC, execution.execution_id
       LIMIT 65`,
      [request.photoId, request.nodeId],
    ),
  ]);
  const parametersJson = JSON.stringify(node.parameters);
  const parametersTruncated = Buffer.byteLength(parametersJson) > 64 * 1024;
  const inputRows = inputs.rows.slice(0, 64);
  const consumerRows = consumers.rows.slice(0, 64);
  const executionRows = executions.rows.slice(0, 64);
  const inputCount = Number(node.input_count);
  const consumerCount = Number(node.consumer_count);
  const executionCount = Number(node.execution_count);
  return {
    id: node.id,
    photoId: request.photoId,
    kind: node.kind,
    recipeVersion: node.recipe_version,
    recipeHash: node.recipe_hash,
    parameters: parametersTruncated ? null : node.parameters,
    parametersTruncated,
    inputNodeIds: inputRows.map((input) => input.input_node_id),
    inputCount,
    consumerNodeIds: consumerRows.map((consumer) => consumer.node_id),
    consumerCount,
    executions: executionRows.map((execution) => ({
      executionId: execution.execution_id,
      evaluationHash: execution.evaluation_hash,
      deterministic: execution.deterministic,
      outputArtifactHash: execution.output_artifact_hash,
      artifactAvailable: execution.artifact_available,
      sourceProvenance: execution.source_locator
        ? {
            locator: execution.source_locator,
            tier: execution.source_tier,
            w: execution.source_w,
            h: execution.source_h,
            decoder_id: execution.decoder_id,
            decoder_version: execution.decoder_version,
          }
        : null,
      providerProvenance: execution.provider_execution
        ? {
            parameters: parametersTruncated ? null : node.parameters,
            parameters_truncated: parametersTruncated,
            input_node_ids: inputRows.map((input) => input.input_node_id),
            input_artifact_hashes: execution.input_artifact_hashes,
            recipe_version: node.recipe_version,
            execution_id: execution.execution_id,
            ...execution.provider_execution,
            output: {
              dimensions: { w: execution.output_w, h: execution.output_h },
              artifact_hash: execution.output_artifact_hash,
              available: execution.artifact_available,
            },
          }
        : null,
    })),
    executionCount,
    artifactAvailable: node.artifact_available,
    recordTruncated:
      parametersTruncated || inputCount > 64 || consumerCount > 64 || executionCount > 64,
  };
}

async function activeRevision(database: GraphTransaction, photoId: string): Promise<string | null> {
  const result = await database.query<{ active_revision_id: string | null }>(
    "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
    [photoId],
  );
  return result.rows[0]?.active_revision_id ?? null;
}

interface GraphCursor {
  photoId: string;
  revisionId: string;
  history: boolean;
  afterNodeId: string;
}

function createCursor(cursor: GraphCursor): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  const checksum = createHash("sha256").update(payload).digest("hex");
  return `${payload}.${checksum}`;
}

function parseCursor(cursor: string): GraphCursor {
  const [payload, checksum, extra] = cursor.split(".");
  if (
    !payload ||
    !checksum ||
    extra ||
    createHash("sha256").update(payload).digest("hex") !== checksum
  ) {
    throw new Error("Invalid graph cursor");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid graph cursor");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("photoId" in value) ||
    typeof value.photoId !== "string" ||
    !UUID_PATTERN.test(value.photoId) ||
    !("revisionId" in value) ||
    typeof value.revisionId !== "string" ||
    !UUID_PATTERN.test(value.revisionId) ||
    !("history" in value) ||
    typeof value.history !== "boolean" ||
    !("afterNodeId" in value) ||
    typeof value.afterNodeId !== "string" ||
    !/^node_[0-9a-f]{64}$/.test(value.afterNodeId)
  ) {
    throw new Error("Invalid graph cursor");
  }
  return value as GraphCursor;
}
