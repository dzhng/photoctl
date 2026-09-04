import sharp from "sharp";
import { expect, test } from "vitest";
import { encodeLinearTiff } from "./linear-tiff.js";

test("camera-space TIFFs map their measured black and white levels to the linear range", async () => {
  const encoded = await encodeLinearTiff({
    w: 1,
    h: 1,
    orientationApplied: true,
    space: "camera",
    data: new Float32Array([0, 50, 100]),
    whiteLevel: 100,
    blackLevel: 0,
    wbPreApplied: false,
  });
  expect(await sharp(encoded).metadata()).toMatchObject({ bitsPerSample: 16, depth: "ushort" });
  const ifdOffset = encoded.readUInt32LE(4);
  const entries = encoded.readUInt16LE(ifdOffset);
  let stripOffset: number | undefined;
  for (let index = 0; index < entries; index += 1) {
    const entry = ifdOffset + 2 + index * 12;
    if (encoded.readUInt16LE(entry) === 273) stripOffset = encoded.readUInt32LE(entry + 8);
  }
  expect(stripOffset).toBeTypeOf("number");
  const samples = [0, 1, 2].map((index) => encoded.readUInt16LE(stripOffset! + index * 2));

  expect(samples).toEqual([0, 32_768, 65_535]);
});
