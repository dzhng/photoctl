import { expect, test } from "vitest";
import { createEmbeddingAdapter } from "./embedding.js";

test("a text-only model cannot silently index the shared caption instead of the image", async () => {
  const adapter = createEmbeddingAdapter({
    model: "openai/text-embedding-3-large",
    request: async () => ({
      data: { data: [{ embedding: Array(3072).fill(0.25) }] },
      requestId: null,
      attempts: 1,
    }),
    requestImages: async () => ({
      data: { embeddings: [Array(3072).fill(0.25)] },
      requestId: null,
      attempts: 1,
    }),
  });
  await expect(adapter.images([Buffer.from("jpeg")])).rejects.toMatchObject({
    code: "provider_unconfigured",
  });
});

test("the embedding adapter rejects a malformed provider response without retaining its body", async () => {
  const adapter = createEmbeddingAdapter({
    model: "fixture/embed",
    request: async () => ({
      data: { data: [{ embedding: [1, 2] }], secret: "must not escape" },
      requestId: null,
      attempts: 1,
    }),
    requestImages: async () => {
      throw new Error("Unexpected image request");
    },
  });

  const error = await adapter.text(["warm portrait"]).catch((caught: unknown) => caught);
  expect(error).toMatchObject({
    code: "provider_busy",
    data: { expected_count: 1, observed_count: 1, dimensions: [2] },
  });
  expect(JSON.stringify(error)).not.toContain("must not escape");
});

test.each([
  ["count", [{ embedding: Array(3_072).fill(0.25) }, { embedding: Array(3_072).fill(0.5) }]],
  ["finite values", [{ embedding: [...Array(3_071).fill(0.25), Number.NaN] }]],
])("the embedding adapter rejects the wrong %s", async (_case, data) => {
  const adapter = createEmbeddingAdapter({
    model: "fixture/embed",
    request: async () => ({ data: { data }, requestId: null, attempts: 1 }),
    requestImages: async () => {
      throw new Error("Unexpected image request");
    },
  });

  await expect(adapter.text(["warm portrait"])).rejects.toMatchObject({
    code: "provider_busy",
  });
});

test("each image receives its own vector through the multimodal request", async () => {
  const adapter = createEmbeddingAdapter({
    model: "google/gemini-embedding-2",
    request: async () => {
      throw new Error("Unexpected text request");
    },
    requestImages: async () => ({
      data: { embeddings: [Array(3072).fill(0.25), Array(3072).fill(0.5)] },
      requestId: "images",
      attempts: 1,
    }),
  });
  expect((await adapter.images([Buffer.from("one"), Buffer.from("two")])).vectors).toEqual([
    Array(3072).fill(0.25),
    Array(3072).fill(0.5),
  ]);
});
