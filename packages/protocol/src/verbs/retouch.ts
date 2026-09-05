import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const retouchDataSchema = z.object({
  id: z.uuid(),
  layer_id: z.uuid(),
  revision_id: z.uuid(),
  render_hash: fullHashSchema("r"),
  at: z.tuple([z.number(), z.number()]),
  radius: z.number().positive(),
  node: fullHashSchema("node"),
  reused: z.boolean(),
});
export type RetouchData = z.infer<typeof retouchDataSchema>;
