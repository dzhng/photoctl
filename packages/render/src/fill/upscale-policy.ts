import type { Warning } from "@photoctl/protocol";
import type { SourceContextDensity } from "./density.js";

export interface UpscalePolicySettings {
  models?: { upscale?: string };
  generation?: { upscale?: "auto" | "off" };
  providers?: { upscale?: Record<string, { configured: boolean }> };
}

export interface UpscalePolicyInput {
  releaseDefaultModel: string;
  availableAdapterIds: readonly string[];
  settings?: UpscalePolicySettings;
  flag?: "upscale" | "no-upscale";
  modelOverride?: string;
  sourceContext: SourceContextDensity;
}

export interface ResolvedUpscalePolicy {
  sourceContext: SourceContextDensity;
  sourceWarnings: Warning[];
  upscale: {
    enabled: boolean;
    action: "upscale" | "preserve_generation";
    model: string;
    configured: boolean;
    warnings: Warning[];
  };
}

export function resolveUpscalePolicy(input: UpscalePolicyInput): ResolvedUpscalePolicy {
  const settings = input.settings ?? {};
  const model = input.modelOverride ?? settings.models?.upscale ?? input.releaseDefaultModel;
  const enabled =
    input.modelOverride !== undefined ||
    input.flag === "upscale" ||
    (input.flag !== "no-upscale" && (settings.generation?.upscale ?? "auto") === "auto");
  const configured =
    input.availableAdapterIds.includes(model) &&
    settings.providers?.upscale?.[model]?.configured === true;
  const warnings: Warning[] =
    enabled && !configured
      ? [
          {
            code: "upscale_unconfigured",
            message: `Upscaler ${model} is not explicitly configured`,
          },
        ]
      : [];
  return {
    sourceContext: { ...input.sourceContext },
    sourceWarnings: input.sourceContext.resolutionLimited
      ? [
          {
            code: "source_resolution_limited",
            message: `Generation used resolution-limited ${input.sourceContext.tier} source pixels`,
          },
        ]
      : [],
    upscale: {
      enabled,
      action: enabled && configured ? "upscale" : "preserve_generation",
      model,
      configured,
      warnings,
    },
  };
}
