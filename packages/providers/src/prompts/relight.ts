export const RELIGHT_PROMPT_VERSION = 1;

export function buildRelightPrompt(input: {
  azimuth: number;
  elevation: number;
  intensity: number;
}) {
  const original = `Relight with a soft studio key light at ${input.azimuth}° azimuth, ${input.elevation}° elevation, intensity ${input.intensity}.`;
  return {
    id: "relight-full-frame",
    version: RELIGHT_PROMPT_VERSION,
    original,
    derived: `Relight this portrait as if a single soft studio key light were placed at ${input.azimuth}° azimuth (0 = camera-right, 90 = directly above) and ${input.elevation}° elevation with intensity ${input.intensity} of 1. Keep the person's identity, expression, pose, clothing, and the background unchanged. Adjust only illumination, shadow direction, and specular highlights.\n[photoctl:relight:v1]`,
  };
}
