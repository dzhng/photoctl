import { z } from "zod";

export const searchSourceSchema = z.enum(["text", "vector"]);
export const searchHitSchema = z.object({
  id: z.uuid(),
  file: z.string(),
  score: z.number().positive(),
  sources: z.array(searchSourceSchema).min(1),
});
export const searchDataSchema = z.object({ hits: z.array(searchHitSchema) });

export type SearchHit = z.infer<typeof searchHitSchema>;
export type SearchData = z.infer<typeof searchDataSchema>;
