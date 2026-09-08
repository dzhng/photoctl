import { expect, test } from "vitest";
import { estimateEmbeddingCost } from "./cost.js";

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
