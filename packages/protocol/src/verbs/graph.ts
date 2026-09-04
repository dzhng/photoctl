import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import { warningCodes } from "../envelope.js";

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
  model: z.string().max(256),
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
    .array(z.object({ code: z.enum(warningCodes), message: z.string().max(1_024) }))
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
    "mask_composite",
    "composite",
    "crop",
    "markup",
    "output",
  ]),
  recipe_version: z.number().int().positive(),
  recipe_hash: recipeHash,
  input_node_ids: z.array(nodeId).max(32),
  input_count: z.number().int().nonnegative(),
  execution_count: z.number().int().nonnegative(),
  artifact_available: z.boolean(),
});

export const graphShowDataSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  parent_revision_id: z.uuid().nullable(),
  pinned: z.boolean(),
  scope: z.object({ root: z.literal("output"), history: z.boolean() }),
  roots: z.object({ output: nodeId }),
  render_hash: fullHashSchema("r"),
  nodes: z.array(graphNodeSummarySchema).max(100),
  next_cursor: z.string().nullable(),
});

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
