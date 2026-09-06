import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import { fillExecutionSchema, fillGenerationSchema, fillUpscaleSchema } from "./layers.js";

export const negativePromptGuidanceSchema = z.object({
  requested: z.string().min(1),
  applied: z.literal("prompt-guidance"),
  version: z.number().int().positive(),
  provider_prompt: z.string().min(1),
});
export type NegativePromptGuidance = z.infer<typeof negativePromptGuidanceSchema>;

export const generateDataSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
  output_node: fullHashSchema("node"),
  tag: z.literal("generated"),
  requested: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  reference: z.object({ used: z.boolean() }),
  negative_prompt: negativePromptGuidanceSchema.optional(),
  artifact: z.object({
    hash: fullHashSchema("a"),
    media_type: z.literal("image/tiff"),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  generation: fillGenerationSchema,
  upscale: fillUpscaleSchema,
  executions: z.array(fillExecutionSchema.extend({ reused: z.literal(false) })),
});

export type GenerateData = z.infer<typeof generateDataSchema>;
