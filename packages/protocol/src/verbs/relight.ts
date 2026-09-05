import { z } from "zod";
import { reimagineDataSchema } from "./reimagine.js";

export const relightDataSchema = reimagineDataSchema.omit({ strength: true }).extend({
  azimuth: z.number().min(0).max(360),
  elevation: z.number().min(-90).max(90),
  intensity: z.number().min(0).max(1),
});
export type RelightData = z.infer<typeof relightDataSchema>;
