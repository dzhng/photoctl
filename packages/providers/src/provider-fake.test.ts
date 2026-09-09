import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { GatewayClient } from "./gateway.js";
import { GatewayStructuredModelAdapter, groundedInstancesSchema } from "./adapters/structured.js";
import {
  FAKE_IMAGE_EDIT_MODEL,
  createGatewayImageModelAdapter,
  GatewayImageModelAdapter,
} from "./adapters/image.js";
import sharp from "sharp";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

test("transparent edit masks preserve fractional coverage as inverse alpha", async () => {
  const adapter = new GatewayImageModelAdapter({
    model: "fixture-mask-model",
    mask: "native",
    maskPolarity: "transparent-edits",
  });
  const mask = await sharp(Buffer.from([0, 128, 255]), {
    raw: { width: 3, height: 1, channels: 1 },
  })
    .png()
    .toBuffer();
  const { body: form } = await adapter.buildEdit(
    "replace",
    { png: mask, w: 3, h: 1 },
    mask,
    "replace",
  );
  const wire = Buffer.from(await (form.get("mask") as File).arrayBuffer());
  const { data, info } = await sharp(wire).raw().toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  expect([data[3], data[7], data[11]]).toEqual([255, 127, 0]);
});

test("the image adapter preserves the provider's intrinsic same-ratio raster", async () => {
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
  const { body: form } = await adapter.buildEdit(
    "replace",
    { png: input, w: 20, h: 12 },
    input,
    "blue sky",
    7,
  );
  form.set("fixture_mode", "wrongdims");
  const response = await gateway.imageEdits(form);

  const normalized = await adapter.normalize(response.data, { w: 20, h: 12 });

  expect(await sharp(normalized.png).metadata()).toMatchObject({ width: 40, height: 24 });
  expect(normalized.returnedDimensions).toEqual({ w: 40, h: 24 });
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
  const { body: form } = await adapter.buildEdit(
    "replace",
    { png: input, w: 10, h: 8 },
    input,
    "blue sky",
    7,
  );
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

  await expect(
    adapter.buildEdit(
      "replace",
      { png: Buffer.from("crop"), w: 10, h: 8 },
      Buffer.from("mask"),
      "blue sky",
    ),
  ).rejects.toMatchObject({ code: "provider_unverified_mask" });
});

test.each([FAKE_IMAGE_EDIT_MODEL, "openai/gpt-image-2"])(
  "%s sends masked edits through instruction-composite",
  async (model) => {
    const adapter = createGatewayImageModelAdapter({ model });
    const { body: form } = await adapter.buildEdit(
      "remove",
      { png: Buffer.from("crop"), w: 10, h: 8 },
      Buffer.from("mask"),
      "remove the distraction",
    );

    expect(adapter).toMatchObject({
      id: "gateway-image-instruction-composite-v1",
      version: "3",
      mask: "instruction+composite",
      maskPolarity: "unverified",
    });
    expect(form.has("mask")).toBe(false);
    expect(form.get("model")).toBe(model);
    expect(form.get("prompt")).toBe(
      "remove the distraction\n[photoctl:instruction-composite:v1]\nOnly perform the remove inside the supplied crop.",
    );
  },
);

test.each([FAKE_IMAGE_EDIT_MODEL, "openai/gpt-image-2"])(
  "%s full-frame edits preserve the supplied prompt",
  async (model) => {
    const adapter = createGatewayImageModelAdapter({ model });
    const input = await sharp({
      create: { width: 10, height: 8, channels: 3, background: "#204060" },
    })
      .png()
      .toBuffer();

    const { body: form } = adapter.buildFullFrameEdit(
      { png: input, w: 10, h: 8 },
      "painted twilight",
    );

    expect(form.has("image")).toBe(true);
    expect(form.has("mask")).toBe(false);
    expect(form.get("prompt")).toBe("painted twilight");
    server = await startGatewayFixture();
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/images/edits`, {
      method: "POST",
      body: form,
    });
    expect(response.status).toBe(200);
  },
);

test("the fake gateway rejects a native mask for its reserved instruction-composite model", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const input = await sharp({
    create: { width: 10, height: 8, channels: 4, background: "#ffffffff" },
  })
    .png()
    .toBuffer();
  const { body: form } = await new GatewayImageModelAdapter({
    model: FAKE_IMAGE_EDIT_MODEL,
    mask: "native",
    maskPolarity: "transparent-edits",
  }).buildEdit("remove", { png: input, w: 10, h: 8 }, input, "remove the distraction");

  const response = await fetch(`http://127.0.0.1:${address.port}/v1/images/edits`, {
    method: "POST",
    body: form,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "fixture image edits must not send a mask" });
});

test("the fake gateway requires the exact instruction-composite prompt marker", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const input = await sharp({
    create: { width: 10, height: 8, channels: 4, background: "#ffffffff" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("model", FAKE_IMAGE_EDIT_MODEL);
  form.set("image", new Blob([Uint8Array.from(input)], { type: "image/png" }), "crop.png");
  form.set("prompt", "remove the distraction");
  form.set("init", "original");
  form.set("size", "10x8");
  form.set("output_format", "png");

  const response = await fetch(`http://127.0.0.1:${address.port}/v1/images/edits`, {
    method: "POST",
    body: form,
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "fixture image edits require instruction-composite v1",
  });
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

const signedGroundingPoints = [
  { at: [200, 100], label: 1 },
  { at: [300, 200], label: 1 },
  { at: [400, 300], label: 1 },
  { at: [500, 400], label: 1 },
  { at: [600, 500], label: 1 },
  { at: [0, 0], label: 0 },
  { at: [1000, 1000], label: 0 },
  { at: [900, 100], label: 0 },
  { at: [100, 900], label: 0 },
  { at: [750, 250], label: 0 },
  { at: [250, 750], label: 0 },
  { at: [999, 999], label: 0 },
];

const providerGroundingPoints = signedGroundingPoints.map(({ at: [x, y], label }) => ({
  at: { x, y },
  label,
}));

test("segment grounding preserves signed points and converts provider coordinates once", async () => {
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      fetch: async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  instances: [
                    {
                      box_2d: [100, 200, 600, 700],
                      label: "person",
                      points: providerGroundingPoints,
                    },
                    {
                      box_2d: [0, 0, 1_000, 1_000],
                      label: "frame",
                      points: providerGroundingPoints,
                    },
                  ],
                }),
              },
            },
          ],
        }),
    }),
    model: "fake/grounding-v1",
  });

  const answer = await adapter.ask(
    groundedInstancesSchema,
    [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 800, h: 600 } }],
    "Find people",
  );
  expect(answer.value.instances).toEqual([
    {
      box_2d: [160, 60, 400, 300],
      label: "person",
      points: [
        { at: [160, 60], label: 1 },
        { at: [240, 120], label: 1 },
        { at: [320, 180], label: 1 },
        { at: [400, 240], label: 1 },
        { at: [480, 300], label: 1 },
        { at: [0, 0], label: 0 },
        { at: [799, 599], label: 0 },
        { at: [720, 60], label: 0 },
        { at: [80, 540], label: 0 },
        { at: [600, 150], label: 0 },
        { at: [200, 450], label: 0 },
        { at: [799, 599], label: 0 },
      ],
    },
    {
      box_2d: [0, 0, 800, 600],
      label: "frame",
      points: [
        { at: [160, 60], label: 1 },
        { at: [240, 120], label: 1 },
        { at: [320, 180], label: 1 },
        { at: [400, 240], label: 1 },
        { at: [480, 300], label: 1 },
        { at: [0, 0], label: 0 },
        { at: [799, 599], label: 0 },
        { at: [720, 60], label: 0 },
        { at: [80, 540], label: 0 },
        { at: [600, 150], label: 0 },
        { at: [200, 450], label: 0 },
        { at: [799, 599], label: 0 },
      ],
    },
  ]);
});

test("segment grounding bounds provider-controlled instance fan-out", () => {
  expect(() =>
    groundedInstancesSchema.parse({
      instances: Array.from({ length: 101 }, (_, index) => ({
        box_2d: [index, 0, 1, 1],
        label: `instance ${index}`,
        points: signedGroundingPoints,
      })),
    }),
  ).toThrow();
  expect(() =>
    groundedInstancesSchema.parse({
      instances: [
        { box_2d: [0, 0, 1, 1], label: "person", points: signedGroundingPoints, confidence: 0.9 },
      ],
    }),
  ).toThrow();
});

test("segment grounding refuses ambiguous ordered point pairs from a provider", async () => {
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      fetch: async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  instances: [
                    { label: "person", box_2d: [0, 0, 1000, 1000], points: signedGroundingPoints },
                  ],
                }),
              },
            },
          ],
        }),
    }),
    model: "fake/grounding-v1",
  });
  await expect(
    adapter.ask(
      groundedInstancesSchema,
      [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 800, h: 600 } }],
      "Find people",
    ),
  ).rejects.toThrow();
});

test.each([
  [-1, 500],
  [1000.01, 500],
  [500, -0.01],
  [500, 1001],
])(
  "segment grounding rejects out-of-range provider point (%s,%s) before rasterization",
  async (x, y) => {
    const adapter = new GatewayStructuredModelAdapter({
      gateway: new GatewayClient({
        apiKey: "fixture-key",
        fetch: async () =>
          Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    instances: [
                      {
                        label: "target",
                        box_2d: [0, 0, 1000, 1000],
                        points: [{ at: { x, y }, label: 1 }, ...providerGroundingPoints.slice(1)],
                      },
                    ],
                  }),
                },
              },
            ],
          }),
      }),
      model: "fake/grounding-v1",
    });
    await expect(
      adapter.ask(
        groundedInstancesSchema,
        [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 800, h: 600 } }],
        "Select the described target",
      ),
    ).rejects.toThrow();
  },
);

test("segment grounding requires five inclusion and seven exclusion points per instance", () => {
  const instance = { label: "target", box_2d: [0, 0, 800, 600] };
  const parsePoints = (points: typeof signedGroundingPoints) =>
    groundedInstancesSchema.parse({
      instances: [{ ...instance, points }],
    });
  expect(() =>
    parsePoints(signedGroundingPoints.map((point) => ({ ...point, label: 1 }))),
  ).toThrow();
  expect(() => parsePoints(signedGroundingPoints.slice(1))).toThrow();
  expect(() => parsePoints([...signedGroundingPoints, { at: [1, 1], label: 0 }])).toThrow();
  expect(parsePoints(signedGroundingPoints).instances[0]?.points).toEqual(signedGroundingPoints);
});

test("segment grounding accepts no matches without inventing point prompts", async () => {
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      fetch: async () => Response.json({ choices: [{ message: { content: '{"instances":[]}' } }] }),
    }),
    model: "fake/grounding-v1",
  });
  const answer = await adapter.ask(
    groundedInstancesSchema,
    [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 800, h: 600 } }],
    "Select the absent striped umbrella",
  );
  expect(answer.value).toEqual({ instances: [] });
});

test.each([
  { at: [100, 100], label: 2 },
  { at: [100, 100], label: -1 },
  { at: [100, 100], label: 0.5 },
  { at: [Number.NaN, 100], label: 0 },
  { at: [100, Number.POSITIVE_INFINITY], label: 0 },
])("segment grounding rejects malformed signed point %j", (invalid) => {
  expect(() =>
    groundedInstancesSchema.parse({
      instances: [
        {
          label: "target",
          box_2d: [0, 0, 800, 600],
          points: [...signedGroundingPoints.slice(0, -1), invalid],
        },
      ],
    }),
  ).toThrow();
});

test("other structured schemas retain their own point coordinate meaning", async () => {
  const response = { points: [{ at: [250, 750], label: 1 }] };
  const adapter = new GatewayStructuredModelAdapter({
    gateway: new GatewayClient({
      apiKey: "fixture-key",
      fetch: async () =>
        Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] }),
    }),
    model: "fake/structured-v1",
  });
  const answer = await adapter.ask(
    { name: "annotation", jsonSchema: {}, parse: (value) => value },
    [{ bytes: Buffer.from("jpeg"), mediaType: "image/jpeg", dimensions: { w: 800, h: 600 } }],
    "Return annotation points",
  );
  expect(answer.value).toEqual(response);
});
