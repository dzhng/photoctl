import { z } from "zod";

export const restoreDataSchema = z.object({
  library: z.string(),
  from: z.string(),
  schema_version: z.number().int().positive(),
});

export type RestoreData = z.infer<typeof restoreDataSchema>;
