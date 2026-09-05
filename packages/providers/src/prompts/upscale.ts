export const UPSCALE_PROMPT_ID = "photoctl/upscale-balanced-v1" as const;
export const UPSCALE_PROMPT_VERSION = 1 as const;

export interface GuardedUpscalePrompt {
  id: typeof UPSCALE_PROMPT_ID;
  version: typeof UPSCALE_PROMPT_VERSION;
  original: string;
  derived: string;
}

export function buildGuardedUpscalePrompt(original: string): GuardedUpscalePrompt {
  return {
    id: UPSCALE_PROMPT_ID,
    version: UPSCALE_PROMPT_VERSION,
    original,
    derived: [
      "Add plausible fine detail consistent with the image's original creative intent.",
      "Use a balanced creative treatment: synthesize medium detail while keeping resemblance high.",
      "Preserve composition, silhouette, identity, pose, lighting, placement, color, and boundary geometry.",
      "Do not add, remove, replace, move, or reinterpret subjects, objects, expressions, or text.",
      "Do not repeat, resume, or reinterpret the replacement instruction that produced these pixels.",
    ].join("\n"),
  };
}
