import { z } from "zod";

export const importDataSchema = z.object({
  imported: z.number().int().nonnegative(),
  already_present: z.number().int().nonnegative(),
  skipped_unsupported: z.number().int().nonnegative(),
  ids: z.array(z.uuid()),
  volume: z.object({ uuid: z.string(), mount: z.string(), online: z.boolean() }).nullable(),
  xmp_read: z.object({
    sidecars_found: z.number().int().nonnegative(),
    ratings: z.number().int().nonnegative(),
    keywords: z.number().int().nonnegative(),
    labels: z.number().int().nonnegative(),
  }),
  previews: z.object({
    embedded_extracted: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  embeddings: z.object({
    queued: z.number().int().nonnegative(),
    note: z.string(),
  }),
  elapsed_s: z.number().nonnegative(),
});

export type ImportData = z.infer<typeof importDataSchema>;
