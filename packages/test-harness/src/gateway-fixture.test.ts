import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import { startGatewayFixture } from "./gateway-fixture.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

test("native image embeddings depend on image bytes and reject missing image content", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const embed = async (data?: string) =>
    await fetch(`http://127.0.0.1:${address.port}/v3/ai/embedding-model`, {
      method: "POST",
      headers: { "content-type": "application/json", "ai-model-id": "google/gemini-embedding-2" },
      body: JSON.stringify({
        values: ["portrait"],
        providerOptions: {
          google: {
            content: data ? [[{ inlineData: { mimeType: "image/jpeg", data } }]] : [],
          },
        },
      }),
    });
  const first = await embed("cmVk");
  expect(first.status).toBe(200);
  const vector = await first.json();
  expect(vector).toMatchObject({ embeddings: [expect.any(Array)] });
  expect(vector).toEqual(await (await embed("cmVk")).json());
  expect(vector).not.toEqual(await (await embed("Ymx1ZQ==")).json());
  expect((await embed()).status).toBe(400);
});

test("the fake gateway returns deterministic request-byte embeddings and rejects unowned routes", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const base = `http://127.0.0.1:${address.port}/v1`;
  const body = JSON.stringify({ model: "google/gemini-embedding-2", input: ["portrait"] });
  const first = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const second = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const unknown = await fetch(`${base}/models`, { method: "POST" });

  expect(first.status).toBe(200);
  expect(await first.json()).toEqual(await second.json());
  expect(unknown.status).toBe(404);
});
