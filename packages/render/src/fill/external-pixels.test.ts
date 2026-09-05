import sharp from "sharp";
import { expect, test } from "vitest";
import { decodeExternalImage } from "./external-pixels.js";

test("external 8-bit display pixels expand across the canonical 16-bit display range", async () => {
  const png = await sharp(Buffer.from([0, 128, 255]), {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();

  const decoded = await decodeExternalImage(png, { w: 1, h: 1 });

  expect([...decoded.data]).toEqual([0, 32_896, 65_535]);
});
