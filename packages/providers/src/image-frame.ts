import { PhotoctlError, type Warning } from "@photoctl/protocol";
import sharp from "sharp";

export interface ImageFrameMapping {
  source: [number, number, number, number];
  output: [number, number, number, number];
}

export interface ImageOutputPlan {
  outputDimensions: { w: number; h: number };
  frameMapping?: ImageFrameMapping;
  warnings: Warning[];
}

export function planImageOutput(
  model: string,
  { w, h }: { w: number; h: number },
): ImageOutputPlan {
  if (model !== "openai/gpt-image-2.5-flare" && model !== "openai/gpt-image-2.5-sunburst")
    return { outputDimensions: { w, h }, warnings: [] };
  const unsupported = () =>
    new PhotoctlError(
      "usage",
      `No supported ${model} canvas preserves ${w}x${h} at its requested density or larger`,
    );
  if (
    !Number.isSafeInteger(w) ||
    !Number.isSafeInteger(h) ||
    w < 1 ||
    h < 1 ||
    Math.max(w, h) > 3840
  )
    throw unsupported();
  // https://developers.openai.com/api/docs/guides/image-generation
  // Integer scaling keeps the entire source rectangle exactly representable after unpadding.
  const maxScale = Math.max(1, Math.ceil(Math.sqrt(655_360 / (w * h))));
  for (let scale = 1; scale <= maxScale; scale += 1) {
    const contentW = w * scale;
    const contentH = h * scale;
    let canvasW = Math.ceil(contentW / 16) * 16;
    let canvasH = Math.ceil(contentH / 16) * 16;
    if (canvasW > canvasH * 3) canvasH = Math.ceil(canvasW / 3 / 16) * 16;
    if (canvasH > canvasW * 3) canvasW = Math.ceil(canvasH / 3 / 16) * 16;
    if (Math.max(canvasW, canvasH) > 3840 || canvasW * canvasH > 8_294_400) throw unsupported();
    if (canvasW * canvasH < 655_360) continue;
    const outputDimensions = { w: canvasW, h: canvasH };
    if (canvasW === w && canvasH === h) return { outputDimensions, warnings: [] };
    return {
      outputDimensions,
      frameMapping: { source: [0, 0, w, h], output: [0, 0, contentW, contentH] },
      warnings: [
        {
          code: "provider_warning",
          message: `Provider canvas increased from ${w}x${h} to ${canvasW}x${canvasH} at uniform scale ${scale} for ${model}; only the declared content rectangle will be kept`,
        },
      ],
    };
  }
  throw unsupported();
}

export async function padImageToFrame(png: Buffer, plan: ImageOutputPlan): Promise<Buffer> {
  if (!plan.frameMapping) return png;
  const [left, top, width, height] = plan.frameMapping.output;
  return await sharp(png)
    .resize(width, height, { kernel: "nearest" })
    .extend({
      left,
      top,
      right: plan.outputDimensions.w - left - width,
      bottom: plan.outputDimensions.h - top - height,
      background: "#000000",
    })
    .png()
    .toBuffer();
}
