import { z } from "zod";
import { developResultSchema } from "./develop.js";

const point = z.tuple([z.number().finite(), z.number().finite()]);
const region = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive(),
  z.number().positive(),
]);
export const whiteBalanceDataSchema = developResultSchema.omit({ ok: true }).extend({
  white_balance: z.object({ temp_offset_k: z.number().finite(), tint: z.number().finite() }),
  limited: z.boolean(),
  residual: z.number().nonnegative(),
  sample: z.union([z.object({ point }), z.object({ region })]).and(
    z.object({
      mean_rgb: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
      pixels: z.number().int().positive(),
      space: z.literal("scene-linear-rec2020"),
      stage: z.literal("editable-base-before-develop"),
      raster: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
    }),
  ),
});
export type WhiteBalanceData = z.infer<typeof whiteBalanceDataSchema>;
