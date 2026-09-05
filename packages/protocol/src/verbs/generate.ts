import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import { fillExecutionSchema, fillGenerationSchema, fillUpscaleSchema } from "./layers.js";

export const generateDataSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
  output_node: fullHashSchema("node"),
  tag: z.literal("generated"),
  requested: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  reference: z.object({ used: z.boolean() }),
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
