import { z } from "zod";

export const decodeDataSchema = z.object({
  id: z.uuid(),
  decoder: z.enum(["file", "ciraw", "libraw"]),
  file: z.string(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  space: z.enum(["camera", "scene-linear-rec2020"]),
});

export type DecodeData = z.infer<typeof decodeDataSchema>;
