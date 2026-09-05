import { describe, expect, test } from "vitest";
import { resolveUpscalePolicy } from "./upscale-policy.js";

describe("resolveUpscalePolicy", () => {
  test("defaults to auto and preserves generation when the release model is unconfigured", () => {
    expect(
      resolveUpscalePolicy({
        releaseDefaultModel: "release/upscale",
        availableAdapterIds: ["release/upscale"],
        sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
      }),
    ).toEqual({
      sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
      sourceWarnings: [],
      upscale: {
        enabled: true,
        action: "preserve_generation",
        model: "release/upscale",
        configured: false,
        warnings: [
          {
            code: "upscale_unconfigured",
            message: "Upscaler release/upscale is not explicitly configured",
          },
        ],
      },
    });
  });

  test("a command model wins every default and implies enabled", () => {
    const result = resolveUpscalePolicy({
      releaseDefaultModel: "release/upscale",
      availableAdapterIds: ["command/upscale"],
      settings: {
        models: { upscale: "library/upscale" },
        generation: { upscale: "off" },
        providers: { upscale: { "command/upscale": { configured: true } } },
      },
      flag: "no-upscale",
      modelOverride: "command/upscale",
      sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
    });

    expect(result.upscale).toEqual({
      enabled: true,
      action: "upscale",
      model: "command/upscale",
      configured: true,
      warnings: [],
    });
  });

  test("reports limited source context without changing output-density policy", () => {
    const result = resolveUpscalePolicy({
      releaseDefaultModel: "release/upscale",
      availableAdapterIds: ["release/upscale"],
      settings: {
        providers: { upscale: { "release/upscale": { configured: true } } },
      },
      sourceContext: { tier: "pinned", pixelScale: 0.4, resolutionLimited: true },
    });

    expect(result).toMatchObject({
      sourceContext: { tier: "pinned", pixelScale: 0.4, resolutionLimited: true },
      sourceWarnings: [
        {
          code: "source_resolution_limited",
          message: "Generation used resolution-limited pinned source pixels",
        },
      ],
      upscale: { action: "upscale", configured: true },
    });
  });

  test("command flags override the library setting", () => {
    const common = {
      releaseDefaultModel: "release/upscale",
      availableAdapterIds: ["library/upscale"],
      settings: {
        models: { upscale: "library/upscale" },
        providers: { upscale: { "library/upscale": { configured: true } } },
      },
      sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
    } as const;

    expect(
      resolveUpscalePolicy({
        ...common,
        settings: { ...common.settings, generation: { upscale: "off" } },
        flag: "upscale",
      }).upscale,
    ).toMatchObject({ enabled: true, action: "upscale", model: "library/upscale" });
    expect(
      resolveUpscalePolicy({
        ...common,
        settings: { ...common.settings, generation: { upscale: "auto" } },
        flag: "no-upscale",
      }).upscale,
    ).toMatchObject({
      enabled: false,
      action: "preserve_generation",
      model: "library/upscale",
      warnings: [],
    });
  });

  test("configuration cannot consent to an adapter that is unavailable", () => {
    const result = resolveUpscalePolicy({
      releaseDefaultModel: "release/upscale",
      availableAdapterIds: [],
      settings: {
        providers: { upscale: { "release/upscale": { configured: true } } },
      },
      sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
    });

    expect(result.upscale).toMatchObject({
      enabled: true,
      action: "preserve_generation",
      configured: false,
      warnings: [{ code: "upscale_unconfigured" }],
    });
  });

  test("the off setting preserves generation without an availability warning", () => {
    const result = resolveUpscalePolicy({
      releaseDefaultModel: "release/upscale",
      availableAdapterIds: [],
      settings: { generation: { upscale: "off" } },
      sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
    });

    expect(result.upscale).toEqual({
      enabled: false,
      action: "preserve_generation",
      model: "release/upscale",
      configured: false,
      warnings: [],
    });
  });
});
