import { expect, test } from "vitest";
import { buildGuardedUpscalePrompt, UPSCALE_PROMPT_ID, UPSCALE_PROMPT_VERSION } from "./upscale.js";

test("the versioned upscale prompt preserves intent without repeating the edit", () => {
  const prompt = buildGuardedUpscalePrompt("replace the sky with sunset");

  expect(prompt).toEqual({
    id: "photoctl/upscale-balanced-v1",
    version: 1,
    original: "replace the sky with sunset",
    derived: [
      "Add plausible fine detail consistent with the image's original creative intent.",
      "Use a balanced creative treatment: synthesize medium detail while keeping resemblance high.",
      "Preserve composition, silhouette, identity, pose, lighting, placement, color, and boundary geometry.",
      "Do not add, remove, replace, move, or reinterpret subjects, objects, expressions, or text.",
      "Do not repeat, resume, or reinterpret the replacement instruction that produced these pixels.",
    ].join("\n"),
  });
  expect(prompt.derived).not.toContain(prompt.original);
  expect(UPSCALE_PROMPT_ID).toBe(prompt.id);
  expect(UPSCALE_PROMPT_VERSION).toBe(prompt.version);
});
