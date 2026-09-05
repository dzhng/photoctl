import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import { warningCodes } from "../envelope.js";
import { providerModelIdSchema } from "../provider.js";

const nodeId = fullHashSchema("node");
const recipeHash = fullHashSchema("recipe");
const executionId = fullHashSchema("exec");
const evaluationHash = fullHashSchema("eval");
const artifactHash = fullHashSchema("a");

const providerProvenanceSchema = z.object({
  parameters: z.unknown().nullable(),
  parameters_truncated: z.boolean(),
  input_node_ids: z.array(nodeId).max(64),
  input_artifact_hashes: z.array(artifactHash).max(64),
  recipe_version: z.number().int().positive(),
  execution_id: executionId,
  adapter: z.string().max(256),
  adapter_version: z.string().max(256).nullable(),
  service: z.string().max(256),
  model: providerModelIdSchema,
  model_version: z.string().max(256).nullable(),
  provider_request_id: z.string().max(256).nullable(),
  seed: z.number().int().nullable(),
  duration_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  input_px: z.number().int().nonnegative(),
  target_px: z.number().int().nonnegative(),
  attempt: z.number().int().positive().max(5),
  density_verdict: z.enum(["satisfied", "limited", "not-applicable"]),
  warnings: z
    .array(
      z.object({
        code: z.enum(warningCodes),
        message: z.string().max(1_024),
        attempt_id: z.uuid().optional(),
      }),
    )
    .max(16),
  output: z.object({
    dimensions: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    artifact_hash: artifactHash,
    available: z.boolean(),
  }),
});

const graphNodeSummarySchema = z.object({
  id: nodeId,
  kind: z.enum([
    "source",
    "develop",
    "generate",
    "upscale",
    "resample",
    "transform",
    "solid",
    "mask",
    "delta",
    "mask_composite",
    "composite",
    "crop",
    "markup",
    "output",
    "geometry",
  ]),
  recipe_version: z.number().int().positive(),
  recipe_hash: recipeHash,
  input_node_ids: z.array(nodeId).max(32),
  input_count: z.number().int().nonnegative(),
  execution_count: z.number().int().nonnegative(),
  artifact_available: z.boolean(),
});

const graphShowFields = {
  id: z.uuid(),
  revision_id: z.uuid(),
  parent_revision_id: z.uuid().nullable(),
  pinned: z.boolean(),
  render_hash: fullHashSchema("r"),
  nodes: z.array(graphNodeSummarySchema).max(100),
  next_cursor: z.string().nullable(),
};

export const graphShowDataSchema = z.union([
  z.object({
    ...graphShowFields,
    scope: z.object({ root: z.literal("output"), history: z.boolean() }),
    roots: z.object({ output: nodeId, geometry: nodeId.optional() }),
  }),
  z.object({
    ...graphShowFields,
    scope: z.object({ root: z.literal("layer"), layer_id: z.uuid(), history: z.boolean() }),
    roots: z.object({ content: nodeId, mask: nodeId, authored_checkpoint: nodeId.optional() }),
  }),
]);

export const graphNodeDataSchema = graphNodeSummarySchema.extend({
  photo_id: z.uuid(),
  parameters: z.unknown().nullable(),
  parameters_truncated: z.boolean(),
  input_node_ids: z.array(nodeId).max(64),
  consumer_node_ids: z.array(nodeId).max(64),
  consumer_count: z.number().int().nonnegative(),
  executions: z
    .array(
      z.object({
        execution_id: executionId,
        provider_image_attempt_id: z.uuid().nullable(),
        evaluation_hash: evaluationHash,
        deterministic: z.boolean(),
        output_artifact_hash: artifactHash,
        artifact_available: z.boolean(),
        source_provenance: z.unknown().nullable(),
        provider_provenance: providerProvenanceSchema.nullable(),
      }),
    )
    .max(64),
  record_truncated: z.boolean(),
});

export type GraphShowData = z.infer<typeof graphShowDataSchema>;
export type GraphNodeData = z.infer<typeof graphNodeDataSchema>;

const attemptState = z.enum(["started", "retained", "committed", "rejected", "failed"]);
export const graphAttemptsDataSchema = z.object({
  attempts: z
    .array(
      z.object({
        id: z.uuid(),
        state: attemptState,
        created_at: z.iso.datetime(),
        operation: z.string().max(32),
        model: z.string().max(256),
        original: z
          .object({ artifact_hash: artifactHash, recorded_available: z.boolean() })
          .nullable(),
      }),
    )
    .max(100),
  next_cursor: z.string().nullable(),
});
export const graphAttemptDataSchema = z.object({
  id: z.uuid(),
  state: attemptState,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  request: z.unknown().nullable(),
  provenance: z.unknown().nullable(),
  outcome: z.unknown().nullable(),
  original: z
    .object({
      artifact_hash: artifactHash,
      path: z.string(),
      media_type: z.string(),
      validation_profile: z.enum(["linear-rgb-tiff", "mask-tiff", "encoded-image"]),
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      available: z.boolean(),
    })
    .nullable(),
  executions: z.array(z.object({ photo_id: z.uuid(), execution_id: executionId })).max(64),
  record_truncated: z.boolean(),
});
export type GraphAttemptsData = z.infer<typeof graphAttemptsDataSchema>;
export type GraphAttemptData = z.infer<typeof graphAttemptDataSchema>;
