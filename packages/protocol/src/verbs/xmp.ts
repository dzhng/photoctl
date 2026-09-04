import { z } from "zod";
import { errorCodes } from "../envelope.js";

export const xmpSuccessSchema = z.object({
  id: z.uuid(),
  ok: z.literal(true),
  action: z.enum(["written", "read"]),
  sidecar: z.string(),
});

export const xmpFailureSchema = z
  .object({
    id: z.string(),
    ok: z.literal(false),
    code: z.enum(errorCodes),
  })
  .passthrough();

export const xmpResultSchema = z.discriminatedUnion("ok", [xmpSuccessSchema, xmpFailureSchema]);

export type XmpSuccess = z.infer<typeof xmpSuccessSchema>;
export type XmpFailure = z.infer<typeof xmpFailureSchema>;
export type XmpResult = z.infer<typeof xmpResultSchema>;
