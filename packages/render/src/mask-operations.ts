import { clipMaskToFrame, featherMask, morphologyMask, thresholdMask } from "@photoctl/img";
import { z } from "zod";
import type { MaskImage } from "./mask-tiff.js";

export const effectiveMaskParametersSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("support") }).strict(),
  z
    .object({
      operation: z.literal("fit"),
      mode: z.enum(["strict", "expand", "free"]),
      expand_px: z.number().int().min(0).max(4096),
      feather_px: z.number().int().min(0).max(64),
      visible: z
        .object({
          matrix: z.tuple([
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
            z.number().finite(),
          ]),
          w: z.number().int().positive(),
          h: z.number().int().positive(),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine((value) => value.mode === "expand" || value.expand_px === 0),
]);
export type EffectiveMaskParameters = z.infer<typeof effectiveMaskParametersSchema>;
export type FillFit = Extract<EffectiveMaskParameters, { operation: "fit" }>;

/** The native mask kernels alone define coverage; the DAG stores their exact recipe. */
export async function applyEffectiveMask(
  mask: MaskImage,
  parameters: EffectiveMaskParameters,
): Promise<MaskImage> {
  if (parameters.operation === "support") {
    return { ...mask, data: await thresholdMask(mask.data, mask.w, mask.h, 0, false) };
  }
  let data =
    parameters.mode === "free"
      ? mask.data
      : await thresholdMask(mask.data, mask.w, mask.h, 0.5, true);
  if (parameters.expand_px > 0)
    data = await morphologyMask(data, mask.w, mask.h, parameters.expand_px, "dilate");
  if (parameters.feather_px > 0)
    data = await featherMask(data, mask.w, mask.h, parameters.feather_px);
  if (parameters.visible)
    data = clipMaskToFrame(
      data,
      mask.w,
      mask.h,
      parameters.visible.matrix,
      parameters.visible.w,
      parameters.visible.h,
    );
  return { ...mask, data };
}
