import { describe, expect, test } from "vitest";
import { planOutputDensity, type DensityPlanInput } from "./density.js";

const defaults: DensityPlanInput = {
  target: { kind: "oriented_full_frame", dimensions: { w: 2_000, h: 1_500 } },
  generated: { id: "generation", dimensions: { w: 1_000, h: 750 } },
  cachedUpscales: [],
  supportedScales: [2, 4],
  limits: {
    maxInputPixels: 16_000_000,
    maxOutputPixels: 64_000_000,
    maxOutputEdge: 16_384,
  },
  sourceContext: { tier: "native", pixelScale: 1, resolutionLimited: false },
};

function input(overrides: Partial<DensityPlanInput> = {}): DensityPlanInput {
  return { ...defaults, ...overrides };
}

describe("planOutputDensity", () => {
  test("reuses generated pixels that already cover both target axes", () => {
    expect(
      planOutputDensity(
        input({
          generated: { id: "generation", dimensions: { w: 2_048, h: 1_536 } },
          sourceContext: { tier: "pinned", pixelScale: 0.5, resolutionLimited: true },
        }),
      ),
    ).toEqual({
      requiredScale: 2_000 / 2_048,
      sourceContext: { tier: "pinned", pixelScale: 0.5, resolutionLimited: true },
      upscale: {
        inputArtifactId: "generation",
        generated: { w: 2_048, h: 1_536 },
        final: { w: 2_000, h: 1_500 },
        densitySatisfied: true,
        operations: [{ kind: "resize", dimensions: { w: 2_000, h: 1_500 } }],
        warnings: [],
      },
    });
  });

  test("reuses a cached pre-exact-resize upscale instead of planning a paid call", () => {
    const plan = planOutputDensity(
      input({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: 3_000, h: 2_000 },
        },
        generated: { id: "generation", dimensions: { w: 1_024, h: 768 } },
        cachedUpscales: [
          {
            id: "cached-2x",
            sourceArtifactId: "generation",
            dimensions: { w: 2_048, h: 1_536 },
          },
          {
            id: "cached-4x",
            sourceArtifactId: "generation",
            dimensions: { w: 4_096, h: 3_072 },
          },
        ],
      }),
    );
    expect(plan.upscale).toMatchObject({
      inputArtifactId: "cached-4x",
      generated: { w: 4_096, h: 3_072 },
      final: { w: 3_000, h: 2_000 },
      densitySatisfied: true,
      operations: [{ kind: "resize", dimensions: { w: 3_000, h: 2_000 } }],
      warnings: [],
    });
  });

  test("chooses the smallest sufficient cached artifact independent of cache order", () => {
    const plan = planOutputDensity(
      input({
        target: { kind: "oriented_full_frame", dimensions: { w: 1_900, h: 1_400 } },
        cachedUpscales: [
          {
            id: "cached-4x",
            sourceArtifactId: "generation",
            dimensions: { w: 4_000, h: 3_000 },
          },
          {
            id: "cached-2x",
            sourceArtifactId: "generation",
            dimensions: { w: 2_000, h: 1_500 },
          },
        ],
      }),
    );
    expect(plan.upscale.inputArtifactId).toBe("cached-2x");
  });

  test("selects the smallest supported uniform scale covering both axes", () => {
    const plan = planOutputDensity(
      input({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: 3_000, h: 2_200 },
        },
        generated: { id: "generation", dimensions: { w: 1_024, h: 600 } },
        supportedScales: [4, 2],
      }),
    );
    expect(plan.requiredScale).toBeCloseTo(2_200 / 600);
    expect(plan.upscale).toEqual({
      inputArtifactId: "generation",
      generated: { w: 4_096, h: 2_400 },
      final: { w: 3_000, h: 2_200 },
      densitySatisfied: true,
      operations: [
        { kind: "upscale", scale: 4, expectedDimensions: { w: 4_096, h: 2_400 } },
        { kind: "resize", dimensions: { w: 3_000, h: 2_200 } },
      ],
      warnings: [],
    });
  });

  test("does not reuse an artifact that covers only one target axis", () => {
    const plan = planOutputDensity(
      input({
        target: { kind: "oriented_full_frame", dimensions: { w: 2_000, h: 2_000 } },
        generated: { id: "generation", dimensions: { w: 2_100, h: 1_000 } },
      }),
    );
    expect(plan.upscale.operations).toEqual([
      { kind: "upscale", scale: 2, expectedDimensions: { w: 4_200, h: 2_000 } },
      { kind: "resize", dimensions: { w: 2_000, h: 2_000 } },
    ]);
  });

  test("accepts a fractional advertised scale when it produces whole-pixel dimensions", () => {
    const plan = planOutputDensity(
      input({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: 1_400, h: 1_000 },
        },
        generated: { id: "generation", dimensions: { w: 1_000, h: 800 } },
        supportedScales: [1.5, 2],
      }),
    );
    expect(plan.upscale.operations[0]).toEqual({
      kind: "upscale",
      scale: 1.5,
      expectedDimensions: { w: 1_500, h: 1_200 },
    });
  });

  test("uses the largest valid output and reports an honest density limit", () => {
    const plan = planOutputDensity(
      input({
        target: { kind: "oriented_full_frame", dimensions: { w: 5_000, h: 4_000 } },
        generated: { id: "generation", dimensions: { w: 1_000, h: 800 } },
        supportedScales: [2, 4, 8],
        limits: { ...defaults.limits, maxOutputPixels: 20_000_000, maxOutputEdge: 4_500 },
      }),
    );
    expect(plan.upscale).toEqual({
      inputArtifactId: "generation",
      generated: { w: 4_000, h: 3_200 },
      final: { w: 5_000, h: 4_000 },
      densitySatisfied: false,
      operations: [
        { kind: "upscale", scale: 4, expectedDimensions: { w: 4_000, h: 3_200 } },
        { kind: "resize", dimensions: { w: 5_000, h: 4_000 } },
      ],
      warnings: [
        {
          code: "upscale_resolution_limited",
          message: "The upscaler's largest valid output is below the target density",
        },
      ],
    });
  });

  test("falls back to the generation artifact when adapter limits allow no output", () => {
    const plan = planOutputDensity(
      input({
        target: { kind: "oriented_full_frame", dimensions: { w: 4_000, h: 3_000 } },
        generated: { id: "generation", dimensions: { w: 2_000, h: 1_500 } },
        limits: { ...defaults.limits, maxOutputPixels: 10_000_000, maxOutputEdge: 3_000 },
        sourceContext: { tier: "pinned", pixelScale: 0.5, resolutionLimited: true },
      }),
    );
    expect(plan.upscale).toMatchObject({
      inputArtifactId: "generation",
      generated: { w: 2_000, h: 1_500 },
      final: { w: 4_000, h: 3_000 },
      densitySatisfied: false,
      operations: [{ kind: "resize", dimensions: { w: 4_000, h: 3_000 } }],
      warnings: [{ code: "upscale_resolution_limited" }],
    });
  });

  test("rejects invalid geometry, scale tables, and cross-generation cache entries", () => {
    expect(() =>
      planOutputDensity(
        input({ target: { kind: "oriented_full_frame", dimensions: { w: 0, h: 1 } } }),
      ),
    ).toThrow(/positive integer dimensions/);
    expect(() => planOutputDensity(input({ supportedScales: [0.5] }))).toThrow(
      /scale factors of at least one/,
    );
    expect(() => planOutputDensity(input({ supportedScales: [2, 2] }))).toThrow(/unique/);
    expect(() =>
      planOutputDensity(
        input({
          cachedUpscales: [
            {
              id: "stale-cache",
              sourceArtifactId: "another-generation",
              dimensions: { w: 4_000, h: 3_000 },
            },
          ],
        }),
      ),
    ).toThrow(/originate from the generation artifact/);
    expect(() =>
      planOutputDensity(
        input({ sourceContext: { tier: "native", pixelScale: 0, resolutionLimited: false } }),
      ),
    ).toThrow(/pixel scale/);
  });
});
