import { z } from "zod";
import { fullHashSchema } from "../hash.js";
import {
  fillExecutionSchema,
  fillGenerationSchema,
  fillSourceContextSchema,
  fillUpscaleSchema,
} from "./layers.js";

export const reimagineDataSchema = z.object({
  id: z.uuid(),
  layer_id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
  output_node: fullHashSchema("node"),
  drift: z.literal("full-frame"),
  strength: z.number().min(0).max(1),
  generation: fillGenerationSchema,
  source_context: fillSourceContextSchema,
  upscale: fillUpscaleSchema,
  executions: z.array(fillExecutionSchema.extend({ reused: z.literal(false) })),
});
export type ReimagineData = z.infer<typeof reimagineDataSchema>;
