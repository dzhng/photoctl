import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const developLayersSchema = z.object({
  delta_applied: z.array(z.string()),
  stale: z.array(z.string()),
});

export const developResultSchema = z.object({
  id: z.string().uuid(),
  ok: z.literal(true),
  develop_hash: fullHashSchema("h"),
  render_hash: fullHashSchema("r"),
  layers: developLayersSchema,
});

export type DevelopResult = z.infer<typeof developResultSchema>;
