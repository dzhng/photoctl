import { PhotoctlError, type Warning } from "@photoctl/protocol";
import { resampleDisplaySrgb } from "@photoctl/img";
import sharp from "sharp";
import { z } from "zod";
import { buildInstructionCompositePrompt } from "../prompts/image.js";

export type ImageMaskMode = "native" | "instruction+composite";
export type MaskPolarity = "transparent-edits" | "white-edits" | "unverified";

export interface SentImage {
  png: Buffer;
  w: number;
  h: number;
}

export interface NormalizedImageResponse {
  png: Buffer;
  resampled: boolean;
  returnedDimensions: { w: number; h: number };
  wholeFrame: boolean;
  warnings: Warning[];
}

export interface ImageModelAdapter {
  readonly id: string;
  readonly version: string | null;
  readonly mask: ImageMaskMode;
  readonly maskPolarity: MaskPolarity;
  buildEdit(
    operation: string,
    crop: SentImage,
    mask: Buffer,
    prompt: string,
    seed?: number,
  ): FormData;
  normalize(
    response: unknown,
    sentDimensions: { w: number; h: number },
  ): Promise<NormalizedImageResponse>;
}

export class GatewayImageModelAdapter implements ImageModelAdapter {
  readonly id = "gateway-image-v1";
  readonly version = "1";
  readonly mask: ImageMaskMode;
  readonly maskPolarity: MaskPolarity;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly responseTimeoutMs: number;

  constructor(options: {
    model: string;
    mask: ImageMaskMode;
    maskPolarity: MaskPolarity;
    fetch?: typeof fetch;
    maxResponseBytes?: number;
    responseTimeoutMs?: number;
  }) {
    this.model = options.model;
    this.mask = options.mask;
    this.maskPolarity = options.maskPolarity;
    this.fetcher = options.fetch ?? fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? 64 * 1024 * 1024;
    this.responseTimeoutMs = options.responseTimeoutMs ?? 30_000;
    if (!Number.isSafeInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error("Provider maxResponseBytes must be a positive integer");
    }
    if (!Number.isSafeInteger(this.responseTimeoutMs) || this.responseTimeoutMs < 1) {
      throw new Error("Provider responseTimeoutMs must be a positive integer");
    }
  }

  buildEdit(
    operation: string,
    crop: SentImage,
    mask: Buffer,
    prompt: string,
    seed?: number,
  ): FormData {
    if (this.mask === "native" && this.maskPolarity === "unverified") {
      throw new PhotoctlError(
        "provider_unverified_mask",
        `Mask polarity is unverified for ${this.model}`,
      );
    }
    const form = new FormData();
    form.set("model", this.model);
    form.set("image", pngBlob(crop.png), "crop.png");
    if (this.mask === "native") {
      form.set("mask", pngBlob(mask), "mask.png");
    }
    form.set(
      "prompt",
      this.mask === "native" ? prompt : buildInstructionCompositePrompt(operation, prompt),
    );
    form.set("size", `${crop.w}x${crop.h}`);
    form.set("output_format", "png");
    if (seed !== undefined) form.set("seed", String(seed));
    return form;
  }

  async normalize(
    response: unknown,
    sentDimensions: { w: number; h: number },
  ): Promise<NormalizedImageResponse> {
    const parsed = imageResponseSchema.parse(response);
    const item = parsed.data[0]!;
    const bytes = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadImage(this.fetcher, item.url!, this.maxResponseBytes, this.responseTimeoutMs);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("Provider image dimensions are missing");
    if (metadata.width * sentDimensions.h !== metadata.height * sentDimensions.w) {
      throw new PhotoctlError(
        "provider_whole_frame",
        "The provider returned an unexplained aspect ratio change",
        { returned: { w: metadata.width, h: metadata.height }, sent: sentDimensions },
      );
    }
    const resampled = metadata.width !== sentDimensions.w || metadata.height !== sentDimensions.h;
    const png = resampled
      ? await resamplePng(bytes, metadata.width, metadata.height, sentDimensions)
      : await sharp(bytes, { failOn: "error" }).png().toBuffer();
    return {
      png,
      resampled,
      returnedDimensions: { w: metadata.width, h: metadata.height },
      wholeFrame: parsed.photoctl_fixture?.wholeframe === true,
      warnings: parsed.photoctl_fixture?.wholeframe
        ? [
            {
              code: "provider_warning",
              message: "The provider edited the whole sent frame",
            },
          ]
        : [],
    };
  }
}

async function downloadImage(
  fetcher: typeof fetch,
  url: string,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response is too large");
    if (!response.body) throw new Error("response has no body");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("response is too large");
      }
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    throw new PhotoctlError("provider_busy", "The provider image could not be downloaded", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const imageResponseSchema = z.object({
  data: z
    .array(
      z
        .object({ b64_json: z.string().min(1).optional(), url: z.url().optional() })
        .refine((item) => Boolean(item.b64_json) !== Boolean(item.url)),
    )
    .min(1),
  photoctl_fixture: z.object({ wholeframe: z.boolean() }).optional(),
});

function pngBlob(bytes: Buffer): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: "image/png" });
}

async function resamplePng(
  bytes: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  target: { w: number; h: number },
): Promise<Buffer> {
  const decoded = await sharp(bytes, { failOn: "error" })
    .toColourspace("rgb16")
    .removeAlpha()
    .raw({ depth: "ushort" })
    .toBuffer();
  const samples = new Uint16Array(decoded.length / Uint16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = decoded.readUInt16LE(index * Uint16Array.BYTES_PER_ELEMENT);
  }
  const resized = resampleDisplaySrgb(samples, sourceWidth, sourceHeight, target.w, target.h);
  const output = Buffer.allocUnsafe(resized.length);
  for (let index = 0; index < resized.length; index += 1) {
    output[index] = Math.round(resized[index]! / 257);
  }
  return await sharp(output, {
    raw: { width: target.w, height: target.h, channels: 3 },
  })
    .png()
    .toBuffer();
}
