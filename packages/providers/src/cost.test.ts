import { expect, test } from "vitest";
import { estimateEmbeddingCost, estimateProviderCost } from "./cost.js";

test("unpriced models report a zero placeholder and an honest warning", () => {
  expect(estimateProviderCost("openai/gpt-image-2", { inputPx: 10, outputPx: 40 })).toEqual({
    usd: 0,
    warning: {
      code: "provider_warning",
      message: "Pricing is not available for openai/gpt-image-2; estimated cost is a placeholder",
    },
  });
});

test("the pinned Gemini embedding price estimates the explicitly queued image count", () => {
  expect(estimateEmbeddingCost("google/gemini-embedding-2", 2_000)).toEqual({ usd: 0.9 });
  expect(estimateEmbeddingCost("google/gemini-embedding-2", 1)).toEqual({ usd: 0.00045 });
});

test("an unpriced embedding override remains explicit rather than borrowing another model's price", () => {
  expect(estimateEmbeddingCost("fixture/unpriced", 2_000)).toMatchObject({
    usd: 0,
    warning: { code: "provider_warning" },
  });
});
