import { expect, test } from "vitest";
import { createEmbeddingAdapter } from "./embedding.js";

test("the embedding adapter sends the versioned candidate image shape and validates 3072 values", async () => {
  let sent: unknown;
  const adapter = createEmbeddingAdapter({
    model: "fixture/embed",
    request: async (body) => {
      sent = body;
      return {
        data: { data: [{ embedding: Array(3_072).fill(0.25) }] },
        requestId: "req_1",
        attempts: 1,
      };
    },
  });

  const result = await adapter.images([Buffer.from("jpeg")]);

  expect(result.vectors[0]).toEqual(Array(3_072).fill(0.25));
  expect(sent).toEqual({
    model: "fixture/embed",
    dimensions: 3_072,
    input: [
      {
        content: [
          { type: "text", text: "A photograph indexed for cross-modal retrieval." },
          { type: "image_url", image_url: "data:image/jpeg;base64,anBlZw==" },
        ],
      },
    ],
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
  });

  await expect(adapter.text(["warm portrait"])).rejects.toMatchObject({
    code: "provider_busy",
  });
});

test("the provisional image request version never silently widens beyond its one defined candidate", async () => {
  const adapter = createEmbeddingAdapter({
    model: "fixture/embed",
    request: async () => {
      throw new Error("must not send");
    },
  });
  await expect(adapter.images([Buffer.from("one"), Buffer.from("two")])).rejects.toThrow(
    "openai-compatible-content-parts-candidate-v1 requires exactly one image",
  );
});
