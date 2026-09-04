import { expect, test } from "vitest";
import { buildGuardedUpscalePrompt, UPSCALE_PROMPT_VERSION } from "./upscale.js";

test("the versioned upscale prompt preserves intent without repeating the edit", () => {
  expect(UPSCALE_PROMPT_VERSION).toBe(1);
  expect(buildGuardedUpscalePrompt("replace the sky with sunset")).toContain(
    "Do not repeat or reinterpret this operation: replace the sky with sunset",
  );
});
