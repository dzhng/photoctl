import { createServer } from "node:http";
import { expect, test } from "vitest";
import { GatewayClient } from "./gateway.js";
import { createEmbeddingAdapter } from "./adapters/embedding.js";

test("image embeddings use Gateway's multimodal endpoint instead of its text-only OpenAI endpoint", async () => {
  const requests: Array<{ path: string; model?: string | string[]; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ path: request.url!, model: request.headers["ai-model-id"], body });
    response.setHeader("content-type", "application/json");
    if (request.url !== "/v3/ai/embedding-model") {
      response
        .writeHead(400)
        .end(JSON.stringify({ error: { message: "Invalid input", param: "input" } }));
      return;
    }
    response.end(JSON.stringify({ embeddings: [Array(3072).fill(0.25)] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No gateway fixture address");
    const gateway = new GatewayClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "fixture",
    });
    const adapter = createEmbeddingAdapter({
      model: "google/gemini-embedding-2",
      request: (body, signal) => gateway.embeddings(body, signal),
      requestImages: (body, signal) => gateway.multimodalEmbeddings(body, signal),
    });
    expect((await adapter.images([Buffer.from("jpeg")])).vectors).toEqual([Array(3072).fill(0.25)]);
    expect(requests).toEqual([
      {
        path: "/v3/ai/embedding-model",
        model: "google/gemini-embedding-2",
        body: {
          values: ["A photograph indexed for cross-modal retrieval."],
          providerOptions: {
            google: {
              outputDimensionality: 3072,
              content: [[{ inlineData: { mimeType: "image/jpeg", data: "anBlZw==" } }]],
            },
          },
        },
      },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
