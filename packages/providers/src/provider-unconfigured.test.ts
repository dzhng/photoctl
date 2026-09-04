import { expect, test } from "vitest";
import { PhotoctlError } from "@photoctl/protocol";
import { GatewayClient } from "./gateway.js";

test("gateway calls fail unavailable before making a request when the key is absent", async () => {
  let requested = false;
  const gateway = new GatewayClient({
    apiKey: undefined,
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });

  const error = await gateway
    .embeddings({ model: "google/gemini-embedding-2", input: ["portrait"] })
    .catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(PhotoctlError);
  expect(error).toMatchObject({ code: "provider_unconfigured" });
  expect(requested).toBe(false);
});

test("rate limiting retries a bounded number of times before reporting temporary failure", async () => {
  let requests = 0;
  const delays: number[] = [];
  const gateway = new GatewayClient({
    apiKey: "fixture-key",
    maxAttempts: 3,
    fetch: async () => {
      requests += 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "60" } });
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  const error = await gateway
    .embeddings({ model: "google/gemini-embedding-2", input: ["portrait"] })
    .catch((cause: unknown) => cause);

  expect(error).toMatchObject({ code: "provider_busy", data: { attempts: 3 } });
  expect(requests).toBe(3);
  expect(delays).toEqual([2_000, 2_000]);
});

test("a stalled gateway attempt is aborted and reported as a temporary provider failure", async () => {
  const gateway = new GatewayClient({
    apiKey: "fixture-key",
    requestTimeoutMs: 1,
    fetch: async (_url, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
  });

  const error = await gateway
    .embeddings({ model: "fixed", input: ["portrait"] })
    .catch((cause) => cause);

  expect(error).toMatchObject({ code: "provider_busy" });
});

test("ordinary gateway rejections remain typed protocol failures", async () => {
  const unauthorized = new GatewayClient({
    apiKey: "bad-key",
    fetch: async () => new Response("{}", { status: 401 }),
  });
  const unavailable = new GatewayClient({
    apiKey: "fixture-key",
    fetch: async () => new Response("{}", { status: 503 }),
  });

  await expect(unauthorized.embeddings({})).rejects.toMatchObject({
    code: "provider_unconfigured",
    data: { status: 401 },
  });
  await expect(unavailable.embeddings({})).rejects.toMatchObject({
    code: "provider_busy",
    data: { status: 503 },
  });
});
