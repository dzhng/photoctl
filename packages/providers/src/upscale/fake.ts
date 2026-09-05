import { createHash } from "node:crypto";
import sharp from "sharp";
import type { UpscaleAdapter, UpscaleInput, UpscaleResult } from "./adapter.js";

export type FakeUpscaleMode =
  | "normal"
  | "wrong-aspect"
  | "too-small"
  | "transport-failure"
  | "corrupt"
  | "mapped-frame";

export class FakeUpscaleAdapter implements UpscaleAdapter {
  readonly colorContract = "opaque-display-srgb" as const;
  readonly supportedScales = [2, 4] as const;
  readonly version = "1";
  readonly limits: UpscaleAdapter["limits"];
  readonly id: string;
  private readonly mode: FakeUpscaleMode;
  private readonly nativeTiling: boolean;

  constructor(
    options: {
      id?: string;
      mode?: FakeUpscaleMode;
      nativeTiling?: boolean;
      limits?: Partial<UpscaleAdapter["limits"]>;
    } = {},
  ) {
    this.id = options.id ?? "photoctl/fake-upscale-v1";
    this.mode = options.mode ?? "normal";
    this.nativeTiling = options.nativeTiling ?? false;
    this.limits = {
      maxInputPixels: 16_000_000,
      maxOutputPixels: 64_000_000,
      maxOutputEdge: 16_384,
      ...options.limits,
    };
  }

  async upscale(input: UpscaleInput): Promise<UpscaleResult> {
    if (this.mode === "transport-failure") throw new Error("Fake upscaler transport failed");
    const source = input.artifact.dimensions;
    if (source.w * source.h > this.limits.maxInputPixels) {
      throw new Error("Fake upscaler input exceeds its limit");
    }
    const scale = this.largestValidScale(input.scale, source);
    const samplingDimensions =
      this.mode === "wrong-aspect"
        ? { w: source.w * scale + 1, h: source.h * scale }
        : this.mode === "too-small"
          ? { w: Math.max(1, source.w - 1), h: Math.max(1, source.h - 1) }
          : { w: source.w * scale, h: source.h * scale };
    const dimensions =
      this.mode === "mapped-frame"
        ? { w: samplingDimensions.w + 2, h: samplingDimensions.h + 2 }
        : samplingDimensions;
    const color = createHash("sha256")
      .update(input.artifact.bytes)
      .update(input.prompt ?? "")
      .digest()
      .subarray(0, 3);
    const bytes =
      this.mode === "corrupt"
        ? Buffer.from("not a png")
        : await sharp({
            create: {
              width: dimensions.w,
              height: dimensions.h,
              channels: 3,
              background: { r: color[0]!, g: color[1]!, b: color[2]! },
            },
          })
            .png()
            .toBuffer();
    return {
      artifact: {
        bytes,
        mediaType: "image/png",
        hash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
        dimensions,
      },
      dimensions,
      ...(this.mode === "mapped-frame"
        ? {
            frameMapping: {
              source: [0, 0, source.w, source.h] as [number, number, number, number],
              output: [1, 1, samplingDimensions.w, samplingDimensions.h] as [
                number,
                number,
                number,
                number,
              ],
            },
          }
        : {}),
      provenance: {
        adapter: this.id,
        adapterVersion: this.version,
        service: "fake",
        model: this.id,
        modelVersion: this.version,
        requestId: `fake_${createHash("sha256").update(bytes).digest("hex")}`,
        seed: input.seed ?? null,
        durationMs: 0,
        costUsd: 0,
        nativeTiling: this.nativeTiling ? { tiles: 4, overlapPx: 32 } : null,
      },
    };
  }

  private largestValidScale(requested: number, source: { w: number; h: number }): number {
    const choices = this.supportedScales.filter(
      (scale) =>
        scale <= requested &&
        source.w * scale <= this.limits.maxOutputEdge &&
        source.h * scale <= this.limits.maxOutputEdge &&
        source.w * source.h * scale * scale <= this.limits.maxOutputPixels,
    );
    const scale = choices.at(-1);
    if (!scale) throw new Error("Fake upscaler cannot produce a valid scale for this input");
    return scale;
  }
}
