export const IMAGE_INSTRUCTION_PROMPT_VERSION = 1;
export const IMAGE_INSTRUCTION_COMPOSITE_MARKER = `[photoctl:instruction-composite:v${IMAGE_INSTRUCTION_PROMPT_VERSION}]`;

export function buildInstructionCompositePrompt(operation: string, prompt: string): string {
  return `${prompt}\n${IMAGE_INSTRUCTION_COMPOSITE_MARKER}\nOnly perform the ${operation} inside the supplied crop.`;
}
