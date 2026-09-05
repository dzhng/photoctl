import { PhotoctlError, type Warning } from "@photoctl/protocol";
import sharp from "sharp";
import { z } from "zod";
import { buildInstructionCompositePrompt } from "../prompts/image.js";

export type ImageMaskMode = "native" | "instruction+composite";
export type MaskPolarity = "transparent-edits" | "white-edits" | "unverified";
export const FAKE_IMAGE_EDIT_MODEL = "photoctl/fake-image-edit-v1";

export interface SentImage {
  png: Buffer;
  w: number;
  h: number;
}

export interface NormalizedImageResponse {
  png: Buffer;
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
  buildFullFrameEdit(crop: SentImage, prompt: string, seed?: number): FormData;
  buildGeneration(
    prompt: string,
    dimensions: { w: number; h: number },
    seed?: number,
    reference?: { png: Buffer },
  ): Record<string, unknown>;
  normalize(
    response: unknown,
    sentDimensions: { w: number; h: number },
  ): Promise<NormalizedImageResponse>;
}

interface GatewayImageModelAdapterOptions {
  model: string;
  mask: ImageMaskMode;
  maskPolarity: MaskPolarity;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
  responseTimeoutMs?: number;
}

export class GatewayImageModelAdapter implements ImageModelAdapter {
  readonly id: string;
  readonly version = "1";
  readonly mask: ImageMaskMode;
  readonly maskPolarity: MaskPolarity;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly responseTimeoutMs: number;

  constructor(options: GatewayImageModelAdapterOptions) {
    this.id =
      options.mask === "native" ? "gateway-image-v1" : "gateway-image-instruction-composite-v1";
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

  buildFullFrameEdit(crop: SentImage, prompt: string, seed?: number): FormData {
    const form = new FormData();
    form.set("model", this.model);
    form.set("image", pngBlob(crop.png), "image.png");
    form.set(
      "prompt",
      this.mask === "native" ? prompt : buildInstructionCompositePrompt("reimagine", prompt),
    );
    form.set("size", `${crop.w}x${crop.h}`);
    form.set("output_format", "png");
    if (seed !== undefined) form.set("seed", String(seed));
    return form;
  }

  buildGeneration(
    prompt: string,
    dimensions: { w: number; h: number },
    seed?: number,
    reference?: { png: Buffer },
  ): Record<string, unknown> {
    return {
      model: this.model,
      prompt,
      size: `${dimensions.w}x${dimensions.h}`,
      output_format: "png",
      ...(seed === undefined ? {} : { seed }),
      ...(reference
        ? { reference_image: `data:image/png;base64,${reference.png.toString("base64")}` }
        : {}),
    };
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
    const png = await sharp(bytes, { failOn: "error" }).png().toBuffer();
    return {
      png,
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

export function createGatewayImageModelAdapter(
  options: Omit<GatewayImageModelAdapterOptions, "mask" | "maskPolarity">,
): GatewayImageModelAdapter {
  return options.model === FAKE_IMAGE_EDIT_MODEL
    ? new GatewayImageModelAdapter({
        ...options,
        mask: "instruction+composite",
        maskPolarity: "unverified",
      })
    : new GatewayImageModelAdapter({
        ...options,
        mask: "native",
        maskPolarity: "unverified",
      });
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
