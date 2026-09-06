import { z } from "zod";
import { developResultSchema } from "./develop.js";

export const cropDataSchema = developResultSchema.omit({ ok: true }).extend({
  auto: z
    .discriminatedUnion("detected", [
      z.object({ detected: z.literal(false), correction_deg: z.null() }),
      z.object({ detected: z.literal(true), correction_deg: z.number().finite() }),
    ])
    .nullable(),
});

export type CropData = z.infer<typeof cropDataSchema>;
