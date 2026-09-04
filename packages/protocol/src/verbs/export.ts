import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const exportResultSchema = z.object({
  id: z.uuid(),
  ok: z.literal(true),
  file: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  bytes: z.number().int().positive(),
  render_hash: fullHashSchema("r"),
});

export type ExportResult = z.infer<typeof exportResultSchema>;
