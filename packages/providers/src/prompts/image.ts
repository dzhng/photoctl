export const IMAGE_INSTRUCTION_PROMPT_VERSION = 1;
export const REFERENCE_VARIATION_PROMPT = {
  version: 1,
  text: "Create a new variation of the reference image. Preserve its main subject and composition while varying visual details.",
};
export const IMAGE_INSTRUCTION_COMPOSITE_MARKER = `[photoctl:instruction-composite:v${IMAGE_INSTRUCTION_PROMPT_VERSION}]`;

export function buildInstructionCompositePrompt(operation: string, prompt: string): string {
  return `${prompt}\n${IMAGE_INSTRUCTION_COMPOSITE_MARKER}\nOnly perform the ${operation} inside the supplied crop.`;
}
