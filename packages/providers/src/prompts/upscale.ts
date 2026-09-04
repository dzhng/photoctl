export const UPSCALE_PROMPT_VERSION = 1;

export function buildGuardedUpscalePrompt(originalOperation: string): string {
  return [
    "Increase natural detail while preserving identity, composition, lighting, and color.",
    `Do not repeat or reinterpret this operation: ${originalOperation}`,
    "Do not add objects, alter expressions, change text, or move edges.",
  ].join("\n");
}
