import { expect, test } from "vitest";
import { estimateProviderCost } from "./cost.js";

test("unpriced models report a zero placeholder and an honest warning", () => {
  expect(estimateProviderCost("openai/gpt-image-2", { inputPx: 10, outputPx: 40 })).toEqual({
    usd: 0,
    warning: {
      code: "provider_warning",
      message: "Pricing is not available for openai/gpt-image-2; estimated cost is a placeholder",
    },
  });
});
