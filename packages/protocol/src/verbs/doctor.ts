import { z } from "zod";

export const doctorDataSchema = z.object({
  library: z.string(),
  library_id: z.uuid(),
  node: z.string(),
  db: z.string(),
  vector: z.object({ installed: z.literal(true), version: z.string() }),
  cache: z.object({ root: z.string(), max_bytes: z.number().int().positive() }),
  decoders: z.array(
    z.object({
      id: z.enum(["ciraw", "libraw"]),
      available: z.boolean(),
      version: z.string().nullable(),
      requires_window_server: z.boolean().nullable(),
    }),
  ),
  lock_holder: z.null(),
});

export type DoctorData = z.infer<typeof doctorDataSchema>;
