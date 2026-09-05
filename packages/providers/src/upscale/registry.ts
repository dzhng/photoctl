import type { Warning } from "@photoctl/protocol";
import type { UpscaleAdapter, UpscaleInput, UpscaleResult } from "./adapter.js";

export type UpscaleExecutionResult =
  | {
      ok: true;
      value: UpscaleResult;
      samplingDimensions: { w: number; h: number };
      densitySatisfied: boolean;
      warnings: Warning[];
    }
  | { ok: false; code: "upscale_failed"; message: string; warnings: Warning[] };

export class UpscaleRegistry {
  private readonly adapters = new Map<string, UpscaleAdapter>();

  constructor(readonly releaseDefault: string) {}

  register(adapter: UpscaleAdapter): void {
    if (this.adapters.has(adapter.id))
      throw new Error(`Upscale adapter already registered: ${adapter.id}`);
    this.adapters.set(adapter.id, adapter);
  }

  list(): UpscaleAdapter[] {
    return [...this.adapters.values()].toSorted((left, right) => left.id.localeCompare(right.id));
  }

  get(model: string): UpscaleAdapter | undefined {
    return this.adapters.get(model);
  }

  async execute(adapter: UpscaleAdapter, input: UpscaleInput): Promise<UpscaleExecutionResult> {
    try {
      const value = await adapter.upscale(input);
      const source = input.artifact.dimensions;
      const output = value.dimensions;
      if (!validDimensions(output) || !validDimensions(value.artifact.dimensions)) {
        return failure("Upscaler returned invalid dimensions");
      }
      if (output.w !== value.artifact.dimensions.w || output.h !== value.artifact.dimensions.h) {
        return failure("Upscaler dimensions do not match its returned artifact");
      }
      if (output.w < source.w || output.h < source.h) {
        return failure("Upscaler returned an image smaller than its input");
      }
      if (!value.frameMapping && source.w * output.h !== source.h * output.w) {
        return failure("Upscaler returned an unexplained aspect ratio change");
      }
      const samplingDimensions = value.frameMapping
        ? validateFrameMapping(value.frameMapping, source, output)
        : output;
      if (!samplingDimensions) return failure("Upscaler returned an invalid frame mapping");
      if (samplingDimensions.w < source.w || samplingDimensions.h < source.h) {
        return failure("Upscaler returned an image smaller than its input");
      }
      const densitySatisfied =
        samplingDimensions.w >= source.w * input.scale &&
        samplingDimensions.h >= source.h * input.scale;
      return {
        ok: true,
        value,
        samplingDimensions,
        densitySatisfied,
        warnings: densitySatisfied
          ? []
          : [
              {
                code: "upscale_resolution_limited",
                message:
                  "The upscaler returned its largest valid result below the requested density",
              },
            ],
      };
    } catch (error) {
      return failure(error instanceof Error ? error.message : "Upscaler failed");
    }
  }
}

function validDimensions(value: { w: number; h: number }): boolean {
  return (
    Number.isSafeInteger(value.w) && Number.isSafeInteger(value.h) && value.w > 0 && value.h > 0
  );
}

function validateFrameMapping(
  mapping: NonNullable<UpscaleResult["frameMapping"]>,
  source: { w: number; h: number },
  output: { w: number; h: number },
): { w: number; h: number } | undefined {
  const [sourceX, sourceY, sourceW, sourceH] = mapping.source;
  const [outputX, outputY, outputW, outputH] = mapping.output;
  if (
    ![...mapping.source, ...mapping.output].every(Number.isSafeInteger) ||
    sourceX !== 0 ||
    sourceY !== 0 ||
    sourceW !== source.w ||
    sourceH !== source.h ||
    outputX < 0 ||
    outputY < 0 ||
    outputW <= 0 ||
    outputH <= 0 ||
    outputX + outputW > output.w ||
    outputY + outputH > output.h ||
    source.w * outputH !== source.h * outputW
  ) {
    return undefined;
  }
  return { w: outputW, h: outputH };
}

function failure(message: string): UpscaleExecutionResult {
  return {
    ok: false,
    code: "upscale_failed",
    message,
    warnings: [{ code: "upscale_failed", message }],
  };
}
