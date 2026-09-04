import { z } from "zod";

export const cachePruneDataSchema = z.object({
  removed: z.number().int().nonnegative(),
  freed_bytes: z.number().int().nonnegative(),
  remaining_bytes: z.number().int().nonnegative(),
  max_bytes: z.number().int().nonnegative(),
});

export type CachePruneData = z.infer<typeof cachePruneDataSchema>;
