import { z } from "zod";
import type { StructuredSchema } from "../adapters/structured.js";

export const AUTO_ENHANCE_PROMPT_VERSION = 1;
export const AUTO_ENHANCE_RANGES = {
  exposure: [-2, 2],
  highlights: [-100, 100],
  shadows: [-100, 100],
  contrast: [-100, 100],
  black_point: [-100, 100],
  vibrance: [-100, 100],
  saturation: [-100, 100],
  "white_balance.temp_offset_k": [-1_500, 1_500],
} as const;
export type AutoEnhancePath = keyof typeof AUTO_ENHANCE_RANGES;

const adjustmentProperties = {
  exposure: { type: "number" },
  highlights: { type: "number" },
  shadows: { type: "number" },
  contrast: { type: "number" },
  black_point: { type: "number" },
  vibrance: { type: "number" },
  saturation: { type: "number" },
  white_balance: {
    type: "object",
    additionalProperties: false,
    properties: { temp_offset_k: { type: "number" } },
    required: ["temp_offset_k"],
  },
} as const;

const proposal = z
  .object({
    exposure: z.number().optional(),
    highlights: z.number().optional(),
    shadows: z.number().optional(),
    contrast: z.number().optional(),
    black_point: z.number().optional(),
    vibrance: z.number().optional(),
    saturation: z.number().optional(),
    white_balance: z.object({ temp_offset_k: z.number() }).strict().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Auto-enhance must propose an adjustment");

export type AutoEnhanceProposal = z.infer<typeof proposal>;

export const autoEnhanceSchema: StructuredSchema<AutoEnhanceProposal> = {
  name: "photoctl_auto_enhance",
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    minProperties: 1,
    properties: adjustmentProperties,
  },
  parse: (value) => proposal.parse(value),
};

export function buildAutoEnhancePrompt(statsJson: string): string {
  const exposure = AUTO_ENHANCE_RANGES.exposure;
  const tone = AUTO_ENHANCE_RANGES.highlights;
  const temperature = AUTO_ENHANCE_RANGES["white_balance.temp_offset_k"];
  return [
    `You are a careful photo editor. Given this image (a 1024px preview) and its measured stats, return only JSON with keys from: exposure [${exposure}], highlights, shadows, contrast, black_point, vibrance, saturation [${tone}], white_balance.temp_offset_k [${temperature}]. Be conservative. Protect skin tones. Never clip highlights that are currently held. Explain nothing.`,
    statsJson,
  ].join("\n");
}
