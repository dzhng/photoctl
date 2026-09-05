import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import { warningCodes } from "../envelope.js";

const nodeId = fullHashSchema("node");
const revisionFields = {
  id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
};

export const layerSummarySchema = z.object({
  id: z.uuid(),
  role: z.enum(["subject", "vacancy", "reimagine", "retouch"]),
  of_layer: z.uuid().nullable(),
  name: z.string().min(1).max(256),
  z: z.number().int().nonnegative(),
  content_node_id: nodeId,
  mask_node_id: nodeId,
  opacity: z.number().min(0).max(1),
  blend: z.literal("normal"),
  enabled: z.boolean(),
});

export const segmentDataSchema = z.object({
  ...revisionFields,
  layer_id: z.uuid(),
  mask: z.object({
    artifact_hash: fullHashSchema("a"),
    bbox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
    pixels: z.number().int().positive(),
  }),
});

const segmentMaskSchema = z.object({
  artifact_hash: fullHashSchema("a").nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
  pixels: z.number().int().positive(),
});

export const segmentInstancesDataSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid().nullable(),
  render_hash: fullHashSchema("r").nullable(),
  gateway_calls: z.number().int().min(0).max(1),
  instances: z.array(
    z.object({
      i: z.number().int().nonnegative(),
      label: z.string().min(1),
      bbox: z.tuple([z.number(), z.number(), z.number().positive(), z.number().positive()]),
      layer_id: z.uuid().nullable(),
      mask: segmentMaskSchema,
    }),
  ),
});

export const layerListDataSchema = z.object({
  ...revisionFields,
  layers: z.array(layerSummarySchema),
});

const chainNodeSchema = z.object({
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
  ]),
  recipe_version: z.number().int().positive(),
  parameters: z.unknown(),
  input_node_ids: z.array(nodeId),
});

export const layerShowDataSchema = z.object({
  ...revisionFields,
  layer: layerSummarySchema,
  chain: z.object({
    content: z.array(chainNodeSchema),
    mask: z.array(chainNodeSchema),
  }),
});

export const layerTransformDataSchema = z.object({
  ...revisionFields,
  layer_id: z.uuid(),
  matrix: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
  layer: layerSummarySchema,
});

export const layerSetDataSchema = z.object({
  ...revisionFields,
  layer_id: z.uuid(),
  layer: layerSummarySchema,
});

export const layerDuplicateDataSchema = z.object({
  ...revisionFields,
  source_layer_id: z.uuid(),
  layer_id: z.uuid(),
  layer: layerSummarySchema,
});

export const layerMutationDataSchema = z.object({
  ...revisionFields,
  layer_id: z.uuid(),
  z: z.number().int().nonnegative().optional(),
});

export const layerClearDataSchema = z.object({
  ...revisionFields,
  removed: z.number().int().nonnegative(),
});

export const fillMoveDataSchema = z.object({
  ...revisionFields,
  layer_id: z.uuid(),
  vacancy_layer_id: z.uuid(),
  matrix: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
});

const fillGraphSchema = z.object({
  revision: z.uuid(),
  layer: z.uuid(),
  output_node: nodeId,
  render_hash: fullHashSchema("r"),
});
const fillGenerationSchema = z.object({
  node: nodeId,
  adapter: z.string().min(1),
  model: z.string().min(1),
  returned: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
});
const fillSourceContextSchema = z.object({
  tier: z.string().min(1),
  pixel_scale: z.number().positive(),
  resolution_limited: z.boolean(),
});
const fillUpscaleSchema = z.object({
  enabled: z.boolean(),
  executed: z.boolean(),
  node: nodeId.nullable(),
  adapter: z.string().min(1).nullable(),
  model: z.string().min(1),
  input: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  target: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  generated: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  final: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  density_satisfied: z.boolean(),
  warnings: z.array(
    z.object({
      code: z.enum(warningCodes),
      message: z.string().min(1),
      id: z.string().optional(),
    }),
  ),
});
const fillCompositeSchema = z.object({ node: nodeId, unmasked_bit_exact: z.literal(true) });
const fillExecutionSchema = z.object({
  kind: z.enum(["generate", "upscale"]),
  node: nodeId,
  adapter: z.string().min(1),
  model: z.string().min(1),
  duration_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
  reused: z.boolean(),
});

export const fillStrictDataSchema = z.object({
  id: z.uuid(),
  graph: fillGraphSchema,
  generation: fillGenerationSchema,
  source_context: fillSourceContextSchema,
  upscale: fillUpscaleSchema,
  composite: fillCompositeSchema,
  executions: z.array(fillExecutionSchema),
});

export const layerRefreshDataSchema = fillStrictDataSchema.extend({
  refreshed: z.object({
    kind: z.enum(["generate", "upscale"]),
    from_node: nodeId,
    node: nodeId,
  }),
});

export type SegmentData = z.infer<typeof segmentDataSchema>;
export type SegmentInstancesData = z.infer<typeof segmentInstancesDataSchema>;
export type LayerListData = z.infer<typeof layerListDataSchema>;
export type LayerShowData = z.infer<typeof layerShowDataSchema>;
export type LayerTransformData = z.infer<typeof layerTransformDataSchema>;
export type LayerRefreshData = z.infer<typeof layerRefreshDataSchema>;
export type FillMoveData = z.infer<typeof fillMoveDataSchema>;
export type FillStrictData = z.infer<typeof fillStrictDataSchema>;
