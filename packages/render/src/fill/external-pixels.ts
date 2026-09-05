import sharp from "sharp";
import { clipMaskToFrame, resampleDisplaySrgbRegion, resampleMaskRegion } from "@photoctl/img";
import { composeTransformMatrices, type TransformMatrix } from "../transforms.js";
import type { MaskImage } from "../mask-tiff.js";
import type { Image16 } from "../source-render.js";

/** Provider sampling never changes the base-space crop used for final placement. */
export async function fillProviderInputs(
  base: Image16,
  mask: MaskImage,
  crop: { x: number; y: number; w: number; h: number },
  fullResolution = false,
  baseToInput?: TransformMatrix,
) {
  const scale = fullResolution ? 1 : Math.min(1, 1536 / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * scale));
  const h = Math.max(1, Math.round(crop.h * scale));
  if (scale === 1 && !baseToInput) {
    return {
      image: { png: await cropImagePng(base, crop), w, h },
      mask: await cropMaskPng(mask, crop),
    };
  }
  const pixels = resampleDisplaySrgbRegion(
    base.data,
    base.w,
    base.h,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    w,
    h,
    baseToInput,
  );
  let reducedMask = resampleMaskRegion(
    mask.data,
    mask.w,
    mask.h,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    w,
    h,
  );
  if (baseToInput) {
    // Interpolation can mix visible neighbors into an unseen sample; protect exactly where RGB is padded.
    const sentToInput = composeTransformMatrices(baseToInput, [
      crop.w / w,
      0,
      0,
      crop.h / h,
      crop.x,
      crop.y,
    ]);
    reducedMask = clipMaskToFrame(reducedMask, w, h, sentToInput, base.w, base.h);
  }
  return {
    image: {
      png: await image16Png({
        ...base,
        w,
        h,
        data: pixels,
      }),
      w,
      h,
    },
    mask: await cropMaskPng({ ...mask, w, h, data: reducedMask }, { x: 0, y: 0, w, h }),
  };
}

export async function cropMappedExternalImage(
  png: Buffer,
  output: [number, number, number, number],
): Promise<Buffer> {
  const [left, top, width, height] = output;
  return await sharp(png).extract({ left, top, width, height }).png().toBuffer();
}

async function cropImagePng(
  base: Image16,
  crop: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const display8 = Buffer.allocUnsafe(crop.w * crop.h * 3);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w * 3; x += 1) {
      display8[y * crop.w * 3 + x] = Math.round(
        base.data[((crop.y + y) * base.w + crop.x) * 3 + x]! / 257,
      );
    }
  }
  return await sharp(display8, {
    raw: { width: crop.w, height: crop.h, channels: 3 },
  })
    .png()
    .toBuffer();
}

async function cropMaskPng(
  mask: MaskImage,
  crop: { x: number; y: number; w: number; h: number },
): Promise<Buffer> {
  const pixels = Buffer.allocUnsafe(crop.w * crop.h);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w; x += 1) {
      pixels[y * crop.w + x] = Math.round(mask.data[(crop.y + y) * mask.w + crop.x + x]! * 255);
    }
  }
  return await sharp(pixels, { raw: { width: crop.w, height: crop.h, channels: 1 } })
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
