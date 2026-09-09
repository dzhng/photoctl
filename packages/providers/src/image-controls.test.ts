import { expect, test } from "vitest";
import sharp from "sharp";
import {
  FAKE_IMAGE_EDIT_MODEL,
  GatewayImageModelAdapter,
  createGatewayImageModelAdapter,
} from "./adapters/image.js";
import { GatewayClient } from "./gateway.js";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";

test("referenced edits serialize the masked image first and reference second", async () => {
  const adapter = new GatewayImageModelAdapter({
    model: FAKE_IMAGE_EDIT_MODEL,
    mask: "native",
    maskPolarity: "transparent-edits",
  });
  const crop = await png("#ff0000");
  const reference = await png("#00ff00");
  const mask = await png("#ffffff");
  const prepared = await adapter.buildEdit(
    "replace",
    { png: crop, w: 2, h: 2 },
    mask,
    "green ceramic",
    7,
    { reference: { png: reference }, init: "original" },
  );
  // Serialize and parse the HTTP body so duplicate multipart field order is exercised.
  const request = new Request("https://gateway.test/v1/images/edits", {
    method: "POST",
    body: prepared.body,
  });
  const wire = await request.formData();
  const images = await Promise.all(
    wire.getAll("image[]").map(async (file) => Buffer.from(await (file as File).arrayBuffer())),
  );
  expect(images).toEqual([crop, reference]);
  expect(wire.has("image")).toBe(false);
  expect(
    await sharp(Buffer.from(await (wire.get("mask") as File).arrayBuffer()))
      .extractChannel("alpha")
      .raw()
      .toBuffer(),
  ).toEqual(Buffer.alloc(4));
  expect(prepared.warnings).toEqual([]);
  expect(prepared.appliedControls).toEqual({ reference: true, init: "original" });
});

async function png(background: string): Promise<Buffer> {
  return await sharp({ create: { width: 2, height: 2, channels: 3, background } })
    .png()
    .toBuffer();
}

test.each([FAKE_IMAGE_EDIT_MODEL, "openai/gpt-image-2"])(
  "%s reference-guided generation preserves its prompt without a mask",
  async (model) => {
    const adapter = createGatewayImageModelAdapter({ model });
    const reference = await png("#00ff00");
    const prepared = adapter.buildGeneration("a ceramic vase", { w: 1024, h: 1024 }, 11, {
      png: reference,
    });
    expect(prepared.route).toBe("edits");
    if (prepared.route !== "edits") throw new Error("Expected reference edit request");
    const wire = await new Request("https://gateway.test/v1/images/edits", {
      method: "POST",
      body: prepared.body,
    }).formData();
    expect(Buffer.from(await (wire.get("image[]") as File).arrayBuffer())).toEqual(reference);
    expect(wire.has("mask")).toBe(false);
    expect(wire.get("size")).toBe("1024x1024");
    expect(wire.get("prompt")).toBe("a ceramic vase");
    expect(prepared.appliedControls.reference).toBe(true);
  },
);

test("the fixture consumes delegated initialization instead of silently ignoring it", async () => {
  const server = await startGatewayFixture();
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture unavailable");
    const gateway = new GatewayClient({
      apiKey: "fixture",
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
    const adapter = createGatewayImageModelAdapter({ model: FAKE_IMAGE_EDIT_MODEL });
    const input = await png("#ffffff");
    const colors = await Promise.all(
      (["original", "fill", "noise", "empty"] as const).map(async (init) => {
        const prepared = await adapter.buildEdit(
          "replace",
          { png: input, w: 2, h: 2 },
          input,
          "blue",
          undefined,
          { init },
        );
        const response = await gateway.imageEdits(prepared.body);
        const normalized = await adapter.normalize(response.data, { w: 2, h: 2 });
        expect(prepared.warnings).toEqual([]);
        expect(prepared.appliedControls.init).toBe(init);
        return Array.from(
          (await sharp(normalized.png).removeAlpha().raw().toBuffer()).subarray(0, 3),
        );
      }),
    );
    // These are fixture signatures, not claims about a live model's latent initialization.
    expect(colors).toEqual([
      [51, 102, 153],
      [153, 102, 51],
      [102, 153, 51],
      [0, 0, 0],
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
