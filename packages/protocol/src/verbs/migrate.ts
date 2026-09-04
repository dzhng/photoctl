import { z } from "zod";

export const migrateDataSchema = z.object({
  library: z.string(),
  from_version: z.number().int().nonnegative(),
  to_version: z.number().int().nonnegative(),
  applied: z.array(z.number().int().positive()),
});

export type MigrateData = z.infer<typeof migrateDataSchema>;
