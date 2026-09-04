import { z } from "zod";
import { fullHashSchema } from "../hash.js";

export const presetSummarySchema = z.object({
  name: z.string(),
  source: z.enum(["package", "library"]),
});

export const presetDataSchema = presetSummarySchema.extend({
  develop: z.record(z.string(), z.unknown()),
  develop_hash: fullHashSchema("h"),
});

export type PresetSummary = z.infer<typeof presetSummarySchema>;
export type PresetData = z.infer<typeof presetDataSchema>;
