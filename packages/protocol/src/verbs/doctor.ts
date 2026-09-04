import { z } from "zod";

export const doctorDataSchema = z.object({
  library: z.string(),
  library_id: z.uuid(),
  node: z.string(),
  db: z.string(),
  vector: z.object({ installed: z.literal(true), version: z.string() }),
  cache: z.object({ root: z.string(), max_bytes: z.number().int().positive() }),
  lock_holder: z.null(),
});

export type DoctorData = z.infer<typeof doctorDataSchema>;
