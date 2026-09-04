/* eslint-disable no-await-in-loop -- Ordered execution inputs are registered sequentially in one transaction. */
import {
  artifactPath,
  normalizeArtifact,
  publishArtifact,
  readArtifactImage,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import {
  deterministicExecutionId,
  evaluationHash,
  imageNodeRegistry,
  newExecutionId,
} from "./recipes.js";
import type { ImageNodeKind, JsonValue, SourceExecutionProvenance } from "./types.js";
import type { ExternalExecutionProvenance } from "./types.js";
import { warningCodes, type ProviderEvent } from "@photoctl/protocol";
import { z } from "zod";
import type { Image16 } from "../source-render.js";
import { renderSourceExecution } from "../source-render.js";
import type { ExifOrientation } from "../coordinates.js";
import type { ImageSource } from "../decoder.js";
import type { GraphDatabase, GraphTransaction } from "./store.js";

export interface EvaluatedNode {
  artifact: PublishedArtifact;
  evaluationHash: string;
  executionId: string;
  reused: boolean;
}

export class SourceEvaluationError extends Error {
  constructor(cause: unknown) {
    super("Source bytes could not be decoded", { cause });
  }
}

export interface PixelOperationInput {
  artifact: PublishedArtifact;
  evaluationHash: string;
  executionId: string;
}

export interface EvaluateGraphNodeRequest {
  database: GraphDatabase;
  libraryPath: string;
  photoId: string;
  nodeId: string;
  executionId?: string;
  source?:
    | (() => Promise<{ image: Image16; provenance: SourceExecutionProvenance }>)
    | {
        orientation: ExifOrientation;
        imageSource: ImageSource;
        locator: SourceExecutionProvenance["locator"];
      };
  operations?: Partial<
    Record<
      Exclude<ImageNodeKind, "source" | "output">,
      (input: {
        nodeId: string;
        parameters: JsonValue;
        inputs: PixelOperationInput[];
      }) => Promise<Image16 | { image: Image16; externalExecution: ExternalExecutionProvenance }>
    >
  >;
  hooks?: {
    beforePublish?: () => void | Promise<void>;
    beforeCommit?: () => void | Promise<void>;
  };
  emit?: (event: ProviderEvent) => void | Promise<void>;
}

export async function evaluateGraphNode(request: EvaluateGraphNodeRequest): Promise<EvaluatedNode> {
  const memo = new Map<string, Promise<EvaluatedNode>>();
  const evaluate = async (nodeId: string): Promise<EvaluatedNode> => {
    let pending = memo.get(nodeId);
    if (!pending) {
      pending = evaluateOne(
        request,
        nodeId,
        evaluate,
        nodeId === request.nodeId ? request.executionId : undefined,
      );
      memo.set(nodeId, pending);
    }
    return await pending;
  };
  return await evaluate(request.nodeId);
}

async function evaluateOne(
  request: EvaluateGraphNodeRequest,
  nodeId: string,
  evaluate: (nodeId: string) => Promise<EvaluatedNode>,
  requestedExecutionId: string | undefined,
): Promise<EvaluatedNode> {
  const node = await loadNode(request.database, request.photoId, nodeId);
  const deterministic = imageNodeRegistry[node.kind].deterministic;
  if (!deterministic && requestedExecutionId) {
    if (!/^exec_[0-9a-f]{64}$/.test(requestedExecutionId)) {
      throw new Error("Expected exec_ followed by a full SHA-256 hash");
    }
    const retry = await loadByExecutionId(
      request.database,
      request.libraryPath,
      request.photoId,
      requestedExecutionId,
      nodeId,
    );
    if (retry) return { ...retry, reused: true };
    const exists = await request.database.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM node_executions WHERE photo_id = $1 AND execution_id = $2
       ) AS exists`,
      [request.photoId, requestedExecutionId],
    );
    if (exists.rows[0]?.exists) {
      throw new Error(`Execution artifact is unavailable: ${requestedExecutionId}`);
    }
  }
  const inputs = await Promise.all(node.inputNodeIds.map(evaluate));
  let source: { image: Image16; provenance: SourceExecutionProvenance } | undefined;
  let normalizedSource: Awaited<ReturnType<typeof normalizeArtifact>> | undefined;
  if (node.kind === "source") {
    if (!request.source) throw new Error("Source graph evaluation requires a source producer");
    if (typeof request.source === "function") {
      source = await request.source();
    } else {
      try {
        source = await renderSourceExecution(
          request.source.orientation,
          request.source.imageSource,
          request.source.locator,
        );
      } catch (error) {
        throw new SourceEvaluationError(error);
      }
    }
    normalizedSource = await normalizeArtifact(source.image);
  }
  const evaluation = evaluationHash({
    nodeRecipeHash: node.recipeHash,
    kind: node.kind,
    recipeVersion: node.recipeVersion,
    inputArtifactHashes: inputs.map((input) => input.artifact.artifactHash),
    source:
      source && normalizedSource
        ? { ...source.provenance, outputArtifactHash: normalizedSource.artifactHash }
        : undefined,
  });
  if (deterministic) {
    const reused = await loadByEvaluation(
      request.database,
      request.libraryPath,
      request.photoId,
      nodeId,
      evaluation,
    );
    if (reused) return { ...reused, reused: true };
  }

  const executionId = deterministic
    ? deterministicExecutionId(evaluation)
    : (requestedExecutionId ?? newExecutionId());
  let artifact: PublishedArtifact;
  let externalExecution: ExternalExecutionProvenance | undefined;
  if (node.kind === "output") {
    if (inputs.length !== 1) throw new Error("Output evaluation requires one input artifact");
    artifact = inputs[0].artifact;
  } else {
    const operation =
      node.kind === "source"
        ? undefined
        : await runOperation(request, node.kind, nodeId, node.parameters, inputs);
    externalExecution = operation?.externalExecution;
    if (externalExecution) {
      if (node.kind !== "generate" && node.kind !== "upscale") {
        throw new Error(`Provider execution is not valid for ${node.kind}`);
      }
      await request.emit?.({
        event: "provider",
        execution_id: executionId,
        node_kind: node.kind,
        adapter: externalExecution.adapter,
        service: externalExecution.service,
        model: externalExecution.model,
        input_px: externalExecution.inputPx,
        target_px: externalExecution.targetPx,
        attempt: externalExecution.attempt,
      });
    }
    const normalized =
      node.kind === "source" ? normalizedSource! : await normalizeArtifact(operation!.image);
    await request.hooks?.beforePublish?.();
    artifact = await publishArtifact(request.libraryPath, normalized);
  }
  await request.hooks?.beforeCommit?.();
  const stored = await request.database.transaction(async (transaction) => {
    await registerArtifact(transaction, artifact);
    await transaction.query(
      `INSERT INTO node_executions (
         photo_id, execution_id, node_id, evaluation_hash, deterministic,
         output_artifact_hash, source_locator, source_tier, source_w, source_h,
         decoder_id, decoder_version, provider_execution
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (photo_id, execution_id) DO NOTHING`,
      [
        request.photoId,
        executionId,
        nodeId,
        evaluation,
        deterministic,
        artifact.artifactHash,
        source ? JSON.stringify(source.provenance.locator) : null,
        source?.provenance.tier ?? null,
        source?.provenance.w ?? null,
        source?.provenance.h ?? null,
        source?.provenance.decoderId ?? null,
        source?.provenance.decoderVersion ?? null,
        externalExecution ? JSON.stringify(storeExternalExecution(externalExecution)) : null,
      ],
    );
    for (const [index, input] of inputs.entries()) {
      await transaction.query(
        `INSERT INTO node_execution_inputs
           (photo_id, execution_id, input_index, input_artifact_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (photo_id, execution_id, input_index) DO NOTHING`,
        [request.photoId, executionId, index, input.artifact.artifactHash],
      );
    }
    return await loadByExecutionId(
      transaction,
      request.libraryPath,
      request.photoId,
      executionId,
      nodeId,
    );
  });
  if (!stored) throw new Error(`Execution commit failed: ${executionId}`);
  if (
    stored.evaluationHash !== evaluation ||
    stored.artifact.artifactHash !== artifact.artifactHash
  ) {
    throw new Error(`Execution identity collision: ${executionId}`);
  }
  return { ...stored, reused: false };
}

async function runOperation(
  request: EvaluateGraphNodeRequest,
  kind: Exclude<ImageNodeKind, "source" | "output">,
  nodeId: string,
  parameters: JsonValue,
  inputs: EvaluatedNode[],
): Promise<{ image: Image16; externalExecution?: ExternalExecutionProvenance }> {
  const operation = request.operations?.[kind];
  if (!operation) throw new Error(`No pixel evaluator is registered for ${kind}`);
  const result = await operation({ nodeId, parameters, inputs });
  if ("image" in result) {
    const externalExecution = externalExecutionSchema.parse(result.externalExecution);
    if (kind === "generate" || kind === "upscale") {
      assertExternalExecutionMatchesRecipe(kind, parameters, externalExecution);
    }
    return {
      image: result.image,
      externalExecution,
    };
  }
  if (kind === "generate" || kind === "upscale") {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} evaluation requires provider execution provenance`,
    );
  }
  return { image: result };
}

function assertExternalExecutionMatchesRecipe(
  kind: "generate" | "upscale",
  parameters: JsonValue,
  execution: ExternalExecutionProvenance,
): void {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error(`${kind} recipe parameters are invalid`);
  }
  if (
    execution.adapter !== parameters.adapter ||
    execution.adapterVersion !== parameters.adapter_version ||
    execution.model !== parameters.model ||
    execution.modelVersion !== parameters.model_version
  ) {
    throw new Error(`${kind} provider execution does not match its immutable recipe`);
  }
}

const externalExecutionSchema = z
  .object({
    adapter: z.string().min(1).max(256),
    adapterVersion: z.string().min(1).max(256).nullable(),
    service: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    modelVersion: z.string().min(1).max(256).nullable(),
    providerRequestId: z.string().min(1).max(256).nullable(),
    seed: z.number().int().safe().nullable(),
    durationMs: z.number().finite().nonnegative(),
    costUsd: z.number().finite().nonnegative(),
    inputPx: z.number().int().nonnegative(),
    targetPx: z.number().int().nonnegative(),
    attempt: z.number().int().positive().max(5),
    densityVerdict: z.enum(["satisfied", "limited", "not-applicable"]),
    warnings: z
      .array(z.object({ code: z.enum(warningCodes), message: z.string().max(1_024) }).strict())
      .max(16),
  })
  .strip();

function storeExternalExecution(execution: ExternalExecutionProvenance): JsonValue {
  return {
    adapter: execution.adapter,
    adapter_version: execution.adapterVersion,
    attempt: execution.attempt,
    cost_usd: execution.costUsd,
    density_verdict: execution.densityVerdict,
    duration_ms: execution.durationMs,
    input_px: execution.inputPx,
    model: execution.model,
    model_version: execution.modelVersion,
    provider_request_id: execution.providerRequestId,
    seed: execution.seed,
    service: execution.service,
    target_px: execution.targetPx,
    warnings: execution.warnings,
  };
}

async function registerArtifact(
  transaction: GraphTransaction,
  artifact: PublishedArtifact,
): Promise<void> {
  await transaction.query(
    `INSERT INTO image_artifacts
       (artifact_hash, media_type, bytes, w, h, artifact_available)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (artifact_hash) DO UPDATE SET artifact_available = true`,
    [artifact.artifactHash, artifact.mediaType, artifact.storageBytes, artifact.w, artifact.h],
  );
  const stored = await transaction.query<{
    media_type: string;
    bytes: string;
    w: number;
    h: number;
  }>(`SELECT media_type, bytes::text, w, h FROM image_artifacts WHERE artifact_hash = $1`, [
    artifact.artifactHash,
  ]);
  const row = stored.rows[0];
  if (
    !row ||
    row.media_type !== artifact.mediaType ||
    Number(row.bytes) !== artifact.storageBytes ||
    row.w !== artifact.w ||
    row.h !== artifact.h
  ) {
    throw new Error(`Artifact metadata collision: ${artifact.artifactHash}`);
  }
}

async function loadNode(database: GraphTransaction, photoId: string, nodeId: string) {
  const rows = await database.query<{
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
    recipe_hash: string;
  }>(
    `SELECT kind, recipe_version, parameters, recipe_hash
     FROM image_nodes WHERE photo_id = $1 AND id = $2`,
    [photoId, nodeId],
  );
  const row = rows.rows[0];
  if (!row) throw new Error(`Graph node does not exist for photo: ${nodeId}`);
  const inputs = await database.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  return {
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
    recipeHash: row.recipe_hash,
    inputNodeIds: inputs.rows.map((input) => input.input_node_id),
  };
}

async function loadByEvaluation(
  database: GraphTransaction,
  libraryPath: string,
  photoId: string,
  nodeId: string,
  evaluation: string,
): Promise<Omit<EvaluatedNode, "reused"> | undefined> {
  const result = await database.query<{ execution_id: string }>(
    `SELECT execution_id FROM node_executions
     WHERE photo_id = $1 AND node_id = $2 AND evaluation_hash = $3 AND deterministic = true`,
    [photoId, nodeId, evaluation],
  );
  const executionId = result.rows[0]?.execution_id;
  return executionId
    ? await loadByExecutionId(database, libraryPath, photoId, executionId, nodeId)
    : undefined;
}

async function loadByExecutionId(
  database: GraphTransaction,
  libraryPath: string,
  photoId: string,
  executionId: string,
  expectedNodeId: string,
): Promise<Omit<EvaluatedNode, "reused"> | undefined> {
  const result = await database.query<{
    execution_id: string;
    node_id: string;
    evaluation_hash: string;
    output_artifact_hash: string;
    media_type: string;
    bytes: string;
    w: number;
    h: number;
    artifact_available: boolean;
  }>(
    `SELECT execution.execution_id, execution.node_id, execution.evaluation_hash,
       execution.output_artifact_hash, artifact.media_type, artifact.bytes::text,
       artifact.w, artifact.h, artifact.artifact_available
     FROM node_executions AS execution
     JOIN image_artifacts AS artifact
       ON artifact.artifact_hash = execution.output_artifact_hash
     WHERE execution.photo_id = $1 AND execution.execution_id = $2`,
    [photoId, executionId],
  );
  const row = result.rows[0];
  if (row && row.node_id !== expectedNodeId) {
    throw new Error(`Execution identity collision: ${executionId}`);
  }
  if (!row || !row.artifact_available) return undefined;
  if (row.media_type !== "image/tiff")
    throw new Error(`Unsupported artifact media type: ${row.media_type}`);
  const path = artifactPath(libraryPath, row.output_artifact_hash, "tif");
  try {
    await readArtifactImage(path, row.output_artifact_hash);
  } catch {
    await database.query(
      "UPDATE image_artifacts SET artifact_available = false WHERE artifact_hash = $1",
      [row.output_artifact_hash],
    );
    return undefined;
  }
  return {
    artifact: {
      artifactHash: row.output_artifact_hash as `a_${string}`,
      extension: "tif",
      mediaType: "image/tiff",
      path,
      storageBytes: Number(row.bytes),
      w: row.w,
      h: row.h,
    },
    evaluationHash: row.evaluation_hash,
    executionId: row.execution_id,
  };
}
