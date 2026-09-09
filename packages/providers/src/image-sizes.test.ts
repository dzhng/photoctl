import { expect, test } from "vitest";
import sharp from "sharp";
import { createGatewayImageModelAdapter, FAKE_IMAGE_EDIT_MODEL } from "./adapters/image.js";

test("a coprime crop uses uniform scaling and protected padding with an explicit inverse map", async () => {
  const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
  const pixels = Buffer.from(Array.from({ length: 383 * 384 * 3 }, (_, index) => index % 251));
  const input = await sharp(pixels, { raw: { width: 383, height: 384, channels: 3 } })
    .png()
    .toBuffer();
  const prepared = await adapter.buildEdit(
    "replace",
    { png: input, w: 383, h: 384 },
    Buffer.from("local coverage"),
    "a green circle",
  );
  expect(prepared.body.get("size")).toBe("1152x1152");
  expect(prepared.outputDimensions).toEqual({ w: 1152, h: 1152 });
  expect(prepared.frameMapping).toEqual({ source: [0, 0, 383, 384], output: [0, 0, 1149, 1152] });
  const sent = Buffer.from(await (prepared.body.get("image") as Blob).arrayBuffer());
  expect(await sharp(sent).metadata()).toMatchObject({ width: 1152, height: 1152 });
  expect(
    await sharp(sent)
      .extract({ left: 0, top: 0, width: 1149, height: 1152 })
      .resize(383, 384, { kernel: "nearest" })
      .raw()
      .toBuffer(),
  ).toEqual(pixels);
  expect(
    await sharp(sent).extract({ left: 1149, top: 0, width: 3, height: 1152 }).raw().toBuffer(),
  ).toEqual(Buffer.alloc(3 * 1152 * 3));
  expect(prepared.body.has("mask")).toBe(false);
  expect(prepared.warnings).toContainEqual({
    code: "provider_warning",
    message: expect.stringContaining("383x384 to 1152x1152"),
  });
});

test.each([
  [1001, 1000, 1008, 1008],
  [1536, 1, 1536, 512],
  [1, 1536, 512, 1536],
  [809, 809, 816, 816],
  [384, 384, 1152, 1152],
])("%sx%s is mapped into a supported %sx%s canvas", (w, h, canvasW, canvasH) => {
  const prepared = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" }).buildGeneration(
    "a landscape",
    { w, h },
  );
  expect(prepared.outputDimensions).toEqual({ w: canvasW, h: canvasH });
  expect(prepared.frameMapping?.source).toEqual([0, 0, w, h]);
  const output = prepared.frameMapping!.output;
  expect(output[2] * h).toBe(output[3] * w);
  expect(output[0] + output[2]).toBeLessThanOrEqual(canvasW);
  expect(output[1] + output[3]).toBeLessThanOrEqual(canvasH);
});

test("valid edit input bytes and full-frame prompts do not change", async () => {
  const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const full = await adapter.buildFullFrameEdit({ png, w: 1024, h: 1024 }, "painted twilight");
  const masked = await adapter.buildEdit(
    "remove",
    { png, w: 1024, h: 1024 },
    png,
    "remove the circle",
  );
  for (const prepared of [full, masked]) {
    expect(Buffer.from(await (prepared.body.get("image") as Blob).arrayBuffer())).toEqual(png);
    expect(prepared.frameMapping).toBeUndefined();
    expect(prepared.warnings).toEqual([]);
  }
  expect(full.body.get("prompt")).toBe("painted twilight");
});

test("fixture model raster sizes are independent of the real model policy", () => {
  const prepared = createGatewayImageModelAdapter({ model: FAKE_IMAGE_EDIT_MODEL }).buildGeneration(
    "a landscape",
    { w: 383, h: 384 },
  );
  expect(prepared.outputDimensions).toEqual({ w: 383, h: 384 });
  expect(prepared.frameMapping).toBeUndefined();
  expect(prepared.warnings).toEqual([]);
});

test.each(["generation", "reference generation", "full-frame edit"])(
  "%s uses the same declared provider canvas",
  async (operation) => {
    const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
    const image = {
      png: await sharp({ create: { width: 384, height: 256, channels: 3, background: "red" } })
        .png()
        .toBuffer(),
      w: 384,
      h: 256,
    };
    const prepared =
      operation === "full-frame edit"
        ? await adapter.buildFullFrameEdit(image, "a green circle")
        : adapter.buildGeneration(
            "a green circle",
            image,
            undefined,
            operation === "reference generation" ? image : undefined,
          );
    const size = prepared.body instanceof FormData ? prepared.body.get("size") : prepared.body.size;
    expect(size).toBe("1152x768");
    expect(prepared.outputDimensions).toEqual({ w: 1152, h: 768 });
  },
);

test.each([
  [1024, 1024],
  [1536, 1024],
  [1024, 1536],
  [1280, 512],
  [1536, 512],
  [2880, 2880],
  [3824, 2144],
])("an already supported %sx%s output stays unchanged", (w, h) => {
  const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
  const prepared = adapter.buildGeneration("a landscape", { w, h });
  expect(prepared.outputDimensions).toEqual({ w, h });
  expect(prepared.warnings).toEqual([]);
});

test.each([
  [3840, 2160],
  [3008, 3008],
  [3825, 1],
])("%sx%s is refused when its provider canvas exceeds model limits", (w, h) => {
  const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
  expect(() => adapter.buildGeneration("a landscape", { w, h })).toThrow(
    `No supported openai/gpt-image-2 canvas preserves ${w}x${h}`,
  );
});

test("standalone composition is explicitly confined to its requested aspect inside the provider canvas", () => {
  const adapter = createGatewayImageModelAdapter({ model: "openai/gpt-image-2" });
  const prepared = adapter.buildGeneration("a complete red vase", { w: 1001, h: 1000 });
  expect(prepared.outputDimensions).toEqual({ w: 1008, h: 1008 });
  expect(prepared.frameMapping).toEqual({ source: [0, 0, 1001, 1000], output: [0, 0, 1001, 1000] });
  expect(prepared.body).toMatchObject({
    prompt: expect.stringContaining("rectangle [0,0,1001,1000]"),
  });
});
