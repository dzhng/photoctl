import { z } from "zod";

/** Actual decoder treatment travels with its pixels, including retained/offline pixels. */
export const sourceTreatmentSchema = z
  .object({
    requested: z.enum(["disabled", "reconstruct"]),
    status: z.enum(["applied", "disabled", "unsupported", "not-applicable"]),
    method: z.string().min(1).nullable(),
    scale: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]),
  })
  .refine((value) => (value.status === "applied") === (value.method !== null), {
    message: "Only applied reconstruction has a method",
  });

export type SourceTreatment = z.infer<typeof sourceTreatmentSchema>;
