import {
  PhotoctlError,
  type Warning,
  type NegativePromptGuidance,
  type ReferenceStrengthGuidance,
} from "@photoctl/protocol";
import sharp from "sharp";
import { z } from "zod";
import {
  buildInstructionCompositePrompt,
  buildNegativeGuidancePrompt,
  NEGATIVE_GUIDANCE_PROMPT_VERSION,
  buildReferenceStrengthPrompt,
  REFERENCE_STRENGTH_PROMPT_VERSION,
} from "../prompts/image.js";

export type ImageMaskMode = "native" | "instruction+composite";
export type MaskPolarity = "transparent-edits" | "white-edits" | "unverified";
export const FAKE_IMAGE_EDIT_MODEL = "photoctl/fake-image-edit-v1";

export interface SentImage {
  png: Buffer;
  w: number;
  h: number;
}

export type ImageInit = "original" | "fill" | "noise" | "empty";

export interface ImageEditControls {
  reference?: { png: Buffer };
  init?: ImageInit;
}

export interface PreparedImageEdit {
  body: FormData;
  warnings: Warning[];
  appliedControls: { reference: boolean; init: ImageInit };
}

export type PreparedImageGeneration = Omit<PreparedImageEdit, "body"> & {
  negativePrompt?: NegativePromptGuidance;
  referenceStrength?: ReferenceStrengthGuidance;
} & ({ route: "generations"; body: Record<string, unknown> } | { route: "edits"; body: FormData });

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
    controls?: ImageEditControls,
  ): Promise<PreparedImageEdit>;
  buildFullFrameEdit(crop: SentImage, prompt: string, seed?: number): PreparedImageEdit;
  buildGeneration(
    prompt: string,
    dimensions: { w: number; h: number },
    seed?: number,
    reference?: { png: Buffer; strength?: number },
    negativePrompt?: string,
  ): PreparedImageGeneration;
  normalize(
    response: unknown,
    sentDimensions: { w: number; h: number },
    onDecodedImage?: (bytes: Buffer) => Promise<void>,
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
  readonly version: string;
  readonly mask: ImageMaskMode;
  readonly maskPolarity: MaskPolarity;
  private readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly responseTimeoutMs: number;

  constructor(options: GatewayImageModelAdapterOptions) {
    this.id =
      options.mask === "native" ? "gateway-image-v1" : "gateway-image-instruction-composite-v1";
    this.version = "3";
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

  async buildEdit(
    operation: string,
    crop: SentImage,
    mask: Buffer,
    prompt: string,
    seed?: number,
    controls: ImageEditControls = {},
  ): Promise<PreparedImageEdit> {
    if (this.mask === "native" && this.maskPolarity === "unverified") {
      throw new PhotoctlError(
        "provider_unverified_mask",
        `Mask polarity is unverified for ${this.model}`,
      );
    }
    const form = new FormData();
    const { reference, warnings, appliedControls } = this.prepareControls(controls);
    form.set("model", this.model);
    if (reference) {
      // The image-edit API applies the mask to the first image in this ordered array.
      form.append("image[]", pngBlob(crop.png), "crop.png");
      form.append("image[]", pngBlob(reference.png), "reference.png");
    } else form.set("image", pngBlob(crop.png), "crop.png");
    if (this.mask === "native") {
      let wireMask = mask;
      if (this.maskPolarity === "transparent-edits") {
        // Internal PNG coverage is white=edit; this provider expresses edit coverage as transparency.
        const { data, info } = await sharp(mask)
          .extractChannel(0)
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (let index = 0; index < data.length; index += 1) data[index] = 255 - data[index]!;
        wireMask = await sharp({
          create: {
            width: info.width,
            height: info.height,
            channels: 3,
            background: "#ffffff",
          },
        })
          .joinChannel(data, { raw: { width: info.width, height: info.height, channels: 1 } })
          .png()
          .toBuffer();
      }
      form.set("mask", pngBlob(wireMask), "mask.png");
    }
    form.set(
      "prompt",
      this.mask === "native" ? prompt : buildInstructionCompositePrompt(operation, prompt),
    );
    form.set("size", `${crop.w}x${crop.h}`);
    form.set("output_format", "png");
    if (seed !== undefined) form.set("seed", String(seed));
    if (this.model === FAKE_IMAGE_EDIT_MODEL) form.set("init", appliedControls.init);
    return { body: form, warnings, appliedControls };
  }

  buildFullFrameEdit(crop: SentImage, prompt: string, seed?: number): PreparedImageEdit {
    const form = new FormData();
    form.set("model", this.model);
    form.set("image", pngBlob(crop.png), "image.png");
    form.set("prompt", prompt);
    form.set("size", `${crop.w}x${crop.h}`);
    form.set("output_format", "png");
    if (seed !== undefined) form.set("seed", String(seed));
    return { body: form, warnings: [], appliedControls: { reference: false, init: "original" } };
  }

  buildGeneration(
    prompt: string,
    dimensions: { w: number; h: number },
    seed?: number,
    reference?: { png: Buffer; strength?: number },
    negativePrompt?: string,
  ): PreparedImageGeneration {
    const prepared = this.prepareControls(reference ? { reference } : {});
    const strength = reference?.strength;
    if (strength !== undefined && !prepared.reference)
      throw new PhotoctlError("usage", `Reference strength is unsupported by ${this.model}`);
    if (negativePrompt !== undefined) prompt = buildNegativeGuidancePrompt(prompt, negativePrompt);
    if (strength !== undefined) prompt = buildReferenceStrengthPrompt(prompt, strength);
    // Multipart normalizes field line endings; retain the actual transmitted guidance text.
    if ((negativePrompt !== undefined || strength !== undefined) && prepared.reference)
      prompt = prompt.replace(/\r\n|\r|\n/g, "\r\n");
    const fields = {
      model: this.model,
      prompt,
      size: `${dimensions.w}x${dimensions.h}`,
      output_format: "png",
      ...(seed === undefined ? {} : { seed }),
    };
    const metadata = {
      warnings: prepared.warnings,
      appliedControls: prepared.appliedControls,
      ...(strength === undefined
        ? {}
        : {
            referenceStrength: {
              requested: strength,
              applied: "prompt-guidance" as const,
              version: REFERENCE_STRENGTH_PROMPT_VERSION,
              provider_prompt: prompt,
            },
          }),
      ...(negativePrompt === undefined
        ? {}
        : {
            negativePrompt: {
              requested: negativePrompt,
              applied: "prompt-guidance" as const,
              version: NEGATIVE_GUIDANCE_PROMPT_VERSION,
              provider_prompt: prompt,
            },
          }),
    };
    if (!prepared.reference) return { route: "generations", body: fields, ...metadata };
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
    form.append("image[]", pngBlob(prepared.reference.png), "reference.png");
    return { route: "edits", body: form, ...metadata };
  }

  private prepareControls(controls: ImageEditControls) {
    const warnings: Warning[] = [];
    const fixture = this.model === FAKE_IMAGE_EDIT_MODEL;
    const reference =
      controls.reference && (this.model === "openai/gpt-image-2" || fixture)
        ? controls.reference
        : undefined;
    if (controls.reference && !reference)
      warnings.push({
        code: "provider_warning",
        message: `Reference images are unsupported by ${this.model}; the reference was not sent`,
      });
    if (!fixture && controls.init && controls.init !== "original")
      warnings.push({
        code: "provider_warning",
        message: `Initialization ${controls.init} is unsupported by ${this.model}; original initialization was used`,
      });
    return {
      reference,
      warnings,
      appliedControls: {
        reference: reference !== undefined,
        init: fixture ? (controls.init ?? "original") : ("original" as ImageInit),
      },
    };
  }

  async normalize(
    response: unknown,
    sentDimensions: { w: number; h: number },
    onDecodedImage?: (bytes: Buffer) => Promise<void>,
  ): Promise<NormalizedImageResponse> {
    const parsed = imageResponseSchema.parse(response);
    const item = parsed.data[0]!;
    const bytes = item.b64_json
      ? Buffer.from(item.b64_json, "base64")
      : await downloadImage(this.fetcher, item.url!, this.maxResponseBytes, this.responseTimeoutMs);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height)
      throw new Error("Provider image dimensions are missing");
    if (onDecodedImage) {
      await onDecodedImage(bytes);
    }
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
  return options.model === FAKE_IMAGE_EDIT_MODEL || options.model === "openai/gpt-image-2"
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
