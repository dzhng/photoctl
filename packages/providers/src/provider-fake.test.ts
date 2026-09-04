import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { GatewayClient } from "./gateway.js";
import { GatewayStructuredModelAdapter } from "./adapters/structured.js";
import { GatewayImageModelAdapter } from "./adapters/image.js";
import sharp from "sharp";
import { PhotoctlError } from "@photoctl/protocol";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

test("the image adapter uses multipart edits and normalizes wrong-sized PNGs", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const gateway = new GatewayClient({
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  const adapter = new GatewayImageModelAdapter({
    model: "openai/gpt-image-2",
    mask: "native",
    maskPolarity: "transparent-edits",
  });
  const input = await sharp({
    create: { width: 20, height: 12, channels: 4, background: "#ffffffff" },
  })
    .png()
    .toBuffer();
  const form = adapter.buildEdit("replace", { png: input, w: 20, h: 12 }, input, "blue sky", 7);
  form.set("fixture_mode", "wrongdims");
  const response = await gateway.imageEdits(form);

  const normalized = await adapter.normalize(response.data, { w: 20, h: 12 });

  expect(await sharp(normalized.png).metadata()).toMatchObject({ width: 20, height: 12 });
  expect(normalized.resampled).toBe(true);
});

test("the fake gateway owns image generations at the sent dimensions", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const gateway = new GatewayClient({
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });

  const response = await gateway.imageGenerations({
    model: "openai/gpt-image-2",
    prompt: "studio portrait",
    size: "13x9",
  });
  const body = response.data as { data: Array<{ b64_json: string }> };

  expect(await sharp(Buffer.from(body.data[0]!.b64_json, "base64")).metadata()).toMatchObject({
    width: 13,
    height: 9,
  });
});

test("whole-frame fake responses surface the adapter warning", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const gateway = new GatewayClient({
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
  });
  const adapter = new GatewayImageModelAdapter({
    model: "openai/gpt-image-2",
    mask: "instruction+composite",
    maskPolarity: "unverified",
  });
  const input = await sharp({
    create: { width: 10, height: 8, channels: 4, background: "#ffffffff" },
  })
    .png()
    .toBuffer();
  const form = adapter.buildEdit("replace", { png: input, w: 10, h: 8 }, input, "blue sky", 7);
  form.set("fixture_mode", "wholeframe");

  const response = await gateway.imageEdits(form);
  const normalized = await adapter.normalize(response.data, { w: 10, h: 8 });

  expect(normalized.warnings).toEqual([
    { code: "provider_warning", message: "The provider edited the whole sent frame" },
  ]);
});

test("URL image responses are bounded before decode", async () => {
  const adapter = new GatewayImageModelAdapter({
    model: "openai/gpt-image-2",
    mask: "native",
    maskPolarity: "transparent-edits",
    maxResponseBytes: 4,
    fetch: async () => new Response(Buffer.alloc(5)),
  });

  await expect(
    adapter.normalize({ data: [{ url: "https://signed.example/image" }] }, { w: 1, h: 1 }),
  ).rejects.toMatchObject({ code: "provider_busy" });
});

test("an unverified native mask is refused before pixels leave the process", async () => {
  const adapter = new GatewayImageModelAdapter({
    model: "openai/gpt-image-2",
    mask: "native",
    maskPolarity: "unverified",
  });

  const error = (() => {
    try {
      adapter.buildEdit(
        "replace",
        { png: Buffer.from("crop"), w: 10, h: 8 },
        Buffer.from("mask"),
        "blue sky",
      );
    } catch (cause) {
      return cause;
    }
  })();

  expect(error).toBeInstanceOf(PhotoctlError);
  expect(error).toMatchObject({ code: "provider_unverified_mask" });
});

test("the structured adapter sends a JSON-schema request through the real HTTP gateway seam", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      baseUrl: `http://127.0.0.1:${address.port}`,
    }),
    model: "google/gemini-3.1-flash",
  });

  const answer = await adapter.ask(
    {
      name: "box",
      jsonSchema: {
        type: "object",
        properties: { box_2d: { type: "array", items: { type: "number" } } },
        required: ["box_2d"],
      },
      parse: (value) => value as { box_2d: number[] },
    },
    [],
    "Find the subject",
  );

  expect(answer.value).toEqual({ box_2d: [100, 200, 300, 400] });
  expect(answer.model).toBe("google/gemini-3.1-flash");
});

test("the structured adapter converts normalized provider boxes into the image frame", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
    }),
    model: "google/gemini-3.1-flash",
  });

  const answer = await adapter.ask(
    {
      name: "box",
      jsonSchema: { type: "object" },
      parse: (value) => value as { box_2d: number[] },
    },
    [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 1_000, h: 500 } }],
    "Find the subject",
  );

  expect(answer.value).toEqual({ box_2d: [200, 50, 200, 100] });
});

test("the structured adapter rejects reversed provider boxes", async () => {
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      fetch: async () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ box_2d: [900, 800, 100, 200] }) } }],
        }),
    }),
    model: "google/gemini-3.1-flash",
  });

  await expect(
    adapter.ask(
      { name: "box", jsonSchema: {}, parse: (value) => value },
      [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 10, h: 10 } }],
      "Find the subject",
    ),
  ).rejects.toThrow("ordered");
});
