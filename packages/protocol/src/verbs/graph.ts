import { z } from "zod";
import { fullHashSchema } from "../hash.js";

const nodeId = fullHashSchema("node");
const recipeHash = fullHashSchema("recipe");
const executionId = fullHashSchema("exec");
const evaluationHash = fullHashSchema("eval");
const artifactHash = fullHashSchema("a");

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
      }),
    )
    .max(64),
  record_truncated: z.boolean(),
});

export type GraphShowData = z.infer<typeof graphShowDataSchema>;
export type GraphNodeData = z.infer<typeof graphNodeDataSchema>;
