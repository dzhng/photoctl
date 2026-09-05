import { z } from "zod";
import { fullHashSchema } from "../hash.js";

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

export type SegmentData = z.infer<typeof segmentDataSchema>;
export type LayerListData = z.infer<typeof layerListDataSchema>;
export type LayerShowData = z.infer<typeof layerShowDataSchema>;
export type LayerTransformData = z.infer<typeof layerTransformDataSchema>;
