import { z } from "zod";

export const backupDataSchema = z.object({
  library: z.string(),
  path: z.string(),
  bytes: z.number().int().positive(),
});

export type BackupData = z.infer<typeof backupDataSchema>;
