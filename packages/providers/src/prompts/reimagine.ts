export const REIMAGINE_PROMPT_VERSION = 1;

export function buildReimaginePrompt(prompt: string, strength: number) {
  const preserve = Math.round((1 - strength) * 100);
  return {
    id: "reimagine-full-frame",
    version: REIMAGINE_PROMPT_VERSION,
    original: prompt,
    derived: `${prompt}\n[photoctl:reimagine:v1]\nTransform the full frame while preserving approximately ${preserve}% of the source composition and identity.`,
  };
}
