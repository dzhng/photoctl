import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const renderDataSchema = z.object({
  id: z.uuid(),
  file: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  space: z.literal("scene-linear-rec2020"),
  render_hash: fullHashSchema("r"),
});

export type RenderData = z.infer<typeof renderDataSchema>;
