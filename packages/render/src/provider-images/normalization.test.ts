import { GatewayImageModelAdapter } from "@photoctl/providers";
import sharp from "sharp";
import { expect, test } from "vitest";
import { normalizeGeneratedImage } from "./normalization.js";

test("declared unpadding extracts asymmetric content at its mapped location after raw retention", async () => {
  const pixels = Buffer.from(Array.from({ length: 16 * 16 * 3 }, (_, index) => index % 251));
  const raw = await sharp(pixels, { raw: { width: 16, height: 16, channels: 3 } })
    .png()
    .toBuffer();
  const retained: Buffer[] = [];
  const normalized = await normalizeGeneratedImage(
    new GatewayImageModelAdapter({
      model: "fixture/image-v1",
      mask: "native",
      maskPolarity: "unverified",
    }),
    { data: [{ b64_json: raw.toString("base64") }] },
    {
      outputDimensions: { w: 16, h: 16 },
      frameMapping: { source: [0, 0, 3, 2], output: [5, 7, 6, 4] },
    },
    async (bytes) => {
      retained.push(bytes);
    },
  );
  expect(retained).toEqual([raw]);
  expect(normalized.returnedDimensions).toEqual({ w: 6, h: 4 });
  const expected = Buffer.concat(
    [7, 8, 9, 10].map((y) => pixels.subarray((y * 16 + 5) * 3, (y * 16 + 11) * 3)),
  );
  expect(await sharp(normalized.png).raw().toBuffer()).toEqual(expected);
});

test("an unexpected provider canvas is retained but cannot be cropped with a different frame plan", async () => {
  const raw = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const retained: Buffer[] = [];
  await expect(
    normalizeGeneratedImage(
      new GatewayImageModelAdapter({
        model: "fixture/image-v1",
        mask: "native",
        maskPolarity: "unverified",
      }),
      { data: [{ b64_json: raw.toString("base64") }] },
      {
        outputDimensions: { w: 16, h: 16 },
        frameMapping: { source: [0, 0, 3, 2], output: [5, 7, 6, 4] },
      },
      async (bytes) => {
        retained.push(bytes);
      },
    ),
  ).rejects.toMatchObject({ code: "provider_whole_frame" });
  expect(retained).toEqual([raw]);
});
