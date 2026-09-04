import sharp from "sharp";
import type { LinearImage } from "./decoder.js";

export async function encodeLinearTiff(image: LinearImage): Promise<Buffer> {
  const samples = new Uint16Array(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    samples[index] = Math.round(Math.max(0, Math.min(1, image.data[index])) * 65_535);
  }
  return await sharp(samples, {
    raw: { width: image.w, height: image.h, channels: 3 },
  })
    .toColourspace("rgb16")
    .tiff({ compression: "none" })
    .toBuffer();
}
