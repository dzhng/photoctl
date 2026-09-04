export const IMAGE_INSTRUCTION_PROMPT_VERSION = 1;

export function buildInstructionCompositePrompt(operation: string, prompt: string): string {
  return `${prompt}\nOnly perform the ${operation} inside the supplied crop.`;
}
