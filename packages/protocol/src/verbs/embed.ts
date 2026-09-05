import { z } from "zod";
import { errorCodes } from "../envelope.js";
import { providerModelIdSchema } from "../provider.js";

export const embedSuccessSchema = z.object({
  id: z.uuid(),
  ok: z.literal(true),
  model: providerModelIdSchema,
});

export const embedFailureSchema = z.object({
  id: z.string(),
  ok: z.literal(false),
  code: z.enum(errorCodes),
});

export const embedResultSchema = z.discriminatedUnion("ok", [
  embedSuccessSchema,
  embedFailureSchema,
]);

export const embedAllFailureDataSchema = z.object({
  failures_omitted: z.number().int().nonnegative(),
});

export type EmbedResult = z.infer<typeof embedResultSchema>;
export type EmbedAllFailureData = z.infer<typeof embedAllFailureDataSchema>;
