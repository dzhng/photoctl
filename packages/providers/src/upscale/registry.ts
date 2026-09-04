import type { Warning } from "@photoctl/protocol";
import type { UpscaleAdapter, UpscaleInput, UpscaleResult } from "./adapter.js";

export interface UpscaleSettings {
  models?: { upscale?: string };
  generation?: { upscale?: "auto" | "off" };
  providers?: { upscale?: Record<string, { configured: boolean }> };
}

export type UpscaleSelection =
  | { enabled: false; model: string | null; adapter: null; warnings: Warning[] }
  | { enabled: true; model: string; adapter: UpscaleAdapter; warnings: Warning[] };

export type UpscaleExecutionResult =
  | { ok: true; value: UpscaleResult; densitySatisfied: boolean; warnings: Warning[] }
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

  select(input: {
    settings?: UpscaleSettings;
    flag?: "upscale" | "no-upscale";
    modelOverride?: string;
  }): UpscaleSelection {
    const settings = input.settings ?? {};
    const model = input.modelOverride ?? settings.models?.upscale ?? this.releaseDefault;
    const enabled =
      input.modelOverride !== undefined ||
      input.flag === "upscale" ||
      (input.flag !== "no-upscale" && (settings.generation?.upscale ?? "auto") === "auto");
    if (!enabled) return { enabled: false, model, adapter: null, warnings: [] };
    const adapter = this.adapters.get(model);
    const configured = settings.providers?.upscale?.[model]?.configured === true;
    if (!adapter || !configured) {
      return {
        enabled: false,
        model,
        adapter: null,
        warnings: [
          {
            code: "upscale_unconfigured",
            message: `Upscaler ${model} is not explicitly configured`,
          },
        ],
      };
    }
    return { enabled: true, model, adapter, warnings: [] };
  }

  async execute(adapter: UpscaleAdapter, input: UpscaleInput): Promise<UpscaleExecutionResult> {
    try {
      const value = await adapter.upscale(input);
      const source = input.artifact.dimensions;
      const output = value.dimensions;
      if (output.w !== value.artifact.dimensions.w || output.h !== value.artifact.dimensions.h) {
        return failure("Upscaler dimensions do not match its returned artifact");
      }
      if (output.w < source.w || output.h < source.h) {
        return failure("Upscaler returned an image smaller than its input");
      }
      if (!value.frameMapping && source.w * output.h !== source.h * output.w) {
        return failure("Upscaler returned an unexplained aspect ratio change");
      }
      const densitySatisfied =
        output.w >= source.w * input.scale && output.h >= source.h * input.scale;
      return {
        ok: true,
        value,
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

function failure(message: string): UpscaleExecutionResult {
  return {
    ok: false,
    code: "upscale_failed",
    message,
    warnings: [{ code: "upscale_failed", message }],
  };
}
