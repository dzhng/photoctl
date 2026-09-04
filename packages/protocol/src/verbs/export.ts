import { z } from "zod";

export const exportResultSchema = z.object({
  id: z.uuid(),
  ok: z.literal(true),
  file: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  bytes: z.number().int().positive(),
  render_hash: z.string().regex(/^r_[0-9a-f]{12}$/),
});

export type ExportResult = z.infer<typeof exportResultSchema>;
