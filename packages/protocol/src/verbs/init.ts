import { z } from "zod";

export const initDataSchema = z.object({
  library: z.string(),
  db: z.string(),
  cache_max_bytes: z.number().int().positive(),
});

export type InitData = z.infer<typeof initDataSchema>;
