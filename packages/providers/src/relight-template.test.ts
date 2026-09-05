import { expect, test } from "vitest";
import { buildRelightPrompt } from "./prompts/relight.js";

test("C3 maps relight controls into the documented full-frame instruction", () => {
  expect(buildRelightPrompt({ azimuth: 35, elevation: 60, intensity: 0.75 })).toEqual({
    id: "relight-full-frame",
    version: 1,
    original: "Relight with a soft studio key light at 35° azimuth, 60° elevation, intensity 0.75.",
    derived:
      "Relight this portrait as if a single soft studio key light were placed at 35° azimuth (0 = camera-right, 90 = directly above) and 60° elevation with intensity 0.75 of 1. Keep the person's identity, expression, pose, clothing, and the background unchanged. Adjust only illumination, shadow direction, and specular highlights.\n[photoctl:relight:v1]",
  });
});
