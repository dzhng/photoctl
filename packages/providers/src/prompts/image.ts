import type { ImageOutputPlan } from "../image-frame.js";

export const IMAGE_INSTRUCTION_PROMPT_VERSION = 1;

export function buildImageFramePrompt(prompt: string, plan: ImageOutputPlan): string {
  if (!plan.frameMapping) return prompt;
  return `${prompt}\n[photoctl:image-frame:v1]\nCompose the entire requested image inside rectangle [${plan.frameMapping.output.join(",")}] (left, top, width, height) on the ${plan.outputDimensions.w}x${plan.outputDimensions.h} canvas. Keep all requested subjects inside this content rectangle. Leave the padding outside it blank; that padding will be removed.`;
}

export const NEGATIVE_GUIDANCE_PROMPT_VERSION = 1;
export const REFERENCE_STRENGTH_PROMPT_VERSION = 1;

export function buildReferenceStrengthPrompt(prompt: string, strength: number): string {
  return `${prompt}\n[photoctl:reference-strength:v${REFERENCE_STRENGTH_PROMPT_VERSION}]\nReference variation strength: ${strength} on a 0 to 1 scale. At 0, preserve the reference as closely as possible; at 1, allow the greatest variation. Use intermediate values for proportionate freedom to vary.`;
}

export function buildNegativeGuidancePrompt(prompt: string, negative: string): string {
  return `${prompt}\n[photoctl:negative-guidance:v${NEGATIVE_GUIDANCE_PROMPT_VERSION}]\nAvoid these things: ${negative}`;
}
export const REFERENCE_VARIATION_PROMPT = {
  version: 1,
  text: "Create a new variation of the reference image. Preserve its main subject and composition while varying visual details.",
};
export const IMAGE_INSTRUCTION_COMPOSITE_MARKER = `[photoctl:instruction-composite:v${IMAGE_INSTRUCTION_PROMPT_VERSION}]`;

export function buildInstructionCompositePrompt(operation: string, prompt: string): string {
  return `${prompt}\n${IMAGE_INSTRUCTION_COMPOSITE_MARKER}\nOnly perform the ${operation} inside the supplied crop.`;
}
