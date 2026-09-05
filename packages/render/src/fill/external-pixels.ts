import sharp from "sharp";
import type { MaskImage } from "../mask-tiff.js";
import type { Image16 } from "../source-render.js";

export async function cropMappedExternalImage(
  png: Buffer,
  output: [number, number, number, number],
): Promise<Buffer> {
  const [left, top, width, height] = output;
  return await sharp(png).extract({ left, top, width, height }).png().toBuffer();
}

export async function cropImagePng(
  base: Image16,
  crop: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const display8 = Buffer.allocUnsafe(base.data.length);
  for (let index = 0; index < base.data.length; index += 1) {
    display8[index] = Math.round(base.data[index]! / 257);
  }
  return await sharp(display8, {
    raw: { width: base.w, height: base.h, channels: 3 },
  })
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .png()
    .toBuffer();
}

export async function cropMaskPng(
  mask: MaskImage,
  crop: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const pixels = Buffer.alloc(mask.w * mask.h);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = Math.round(mask.data[index]! * 255);
  }
  return await sharp(pixels, { raw: { width: mask.w, height: mask.h, channels: 1 } })
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .png()
    .toBuffer();
}

export async function decodeExternalImage(
  png: Buffer,
  dimensions: { w: number; h: number },
): Promise<Image16> {
  const decoded = await sharp(png).removeAlpha().toColourspace("srgb").raw().toBuffer();
  if (decoded.byteLength !== dimensions.w * dimensions.h * 3) {
    throw new Error("Provider pixels disagree with their declared intrinsic dimensions");
  }
  const expanded = new Uint16Array(decoded.byteLength);
  for (let index = 0; index < decoded.byteLength; index += 1) {
    expanded[index] = decoded[index]! * 257;
  }
  return {
    w: dimensions.w,
    h: dimensions.h,
    channels: 3,
    data: expanded,
    space: "display-srgb",
    orientationApplied: true,
  };
}

export async function image16Png(image: Image16): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    bytes[index] = Math.round(image.data[index]! / 257);
  }
  return await sharp(bytes, {
    raw: { width: image.w, height: image.h, channels: 3 },
  })
    .toColourspace("srgb")
    .png()
    .toBuffer();
}
