import type { Warning } from "@photoctl/protocol";

export interface PixelDimensions {
  w: number;
  h: number;
}

export interface DensityArtifact {
  id: string;
  dimensions: PixelDimensions;
}

export interface CachedUpscaleArtifact extends DensityArtifact {
  sourceArtifactId: string;
}

export interface SourceContextDensity {
  tier: string;
  pixelScale: number;
  resolutionLimited: boolean;
}

export interface DensityLimits {
  maxInputPixels: number;
  maxOutputPixels: number;
  maxOutputEdge: number;
}

export type DensityTarget =
  | { kind: "oriented_full_frame"; dimensions: PixelDimensions }
  | { kind: "base_space_provider_crop"; dimensionsIncludingPad: PixelDimensions };

export interface DensityPlanInput {
  target: DensityTarget;
  generated: DensityArtifact;
  cachedUpscales: readonly CachedUpscaleArtifact[];
  supportedScales: readonly number[];
  limits: DensityLimits;
  sourceContext: SourceContextDensity;
}

export type DensityWarning = Warning & { code: "upscale_resolution_limited" };

export type DensityOperation =
  | { kind: "upscale"; scale: number; expectedDimensions: PixelDimensions }
  | { kind: "resize"; dimensions: PixelDimensions };

export interface DensityExecutionPlan {
  inputArtifactId: string;
  generated: PixelDimensions;
  final: PixelDimensions;
  densitySatisfied: boolean;
  operations: DensityOperation[];
  warnings: DensityWarning[];
}

export interface OutputDensityPlan {
  requiredScale: number;
  sourceContext: SourceContextDensity;
  upscale: DensityExecutionPlan;
}

export function planOutputDensity(input: DensityPlanInput): OutputDensityPlan {
  const target = targetDimensions(input.target);
  validateArtifact("generated", input.generated);
  for (const artifact of input.cachedUpscales) {
    validateArtifact("cached upscale", artifact);
    if (artifact.sourceArtifactId !== input.generated.id) {
      throw new Error("cached upscale must originate from the generation artifact");
    }
  }
  validateSourceContext(input.sourceContext);
  const supportedScales = validateScales(input.supportedScales);
  validateLimits(input.limits);

  const requiredScale = Math.max(
    target.w / input.generated.dimensions.w,
    target.h / input.generated.dimensions.h,
  );
  const generationCovers = covers(input.generated.dimensions, target);
  const sufficient = generationCovers
    ? input.generated
    : input.cachedUpscales
        .filter(({ dimensions }) => covers(dimensions, target))
        .toSorted(
          (left, right) =>
            pixelCount(left.dimensions) - pixelCount(right.dimensions) ||
            left.id.localeCompare(right.id),
        )[0];
  if (!sufficient) {
    const validScales = supportedScales.filter(
      (scale) =>
        pixelCount(input.generated.dimensions) <= input.limits.maxInputPixels &&
        withinOutputLimits(scaledDimensions(input.generated.dimensions, scale), input.limits),
    );
    const scale = validScales.find((candidate) => candidate >= requiredScale) ?? validScales.at(-1);
    if (!scale) {
      return {
        requiredScale,
        sourceContext: { ...input.sourceContext },
        upscale: {
          inputArtifactId: input.generated.id,
          generated: { ...input.generated.dimensions },
          final: { ...target },
          densitySatisfied: false,
          operations: [{ kind: "resize", dimensions: { ...target } }],
          warnings: [resolutionLimitedWarning()],
        },
      };
    }
    const generated = scaledDimensions(input.generated.dimensions, scale);
    const densitySatisfied = generated.w >= target.w && generated.h >= target.h;
    return {
      requiredScale,
      sourceContext: { ...input.sourceContext },
      upscale: {
        inputArtifactId: input.generated.id,
        generated,
        final: { ...target },
        densitySatisfied,
        operations: [
          { kind: "upscale", scale, expectedDimensions: { ...generated } },
          { kind: "resize", dimensions: { ...target } },
        ],
        warnings: densitySatisfied ? [] : [resolutionLimitedWarning()],
      },
    };
  }

  return {
    requiredScale,
    sourceContext: { ...input.sourceContext },
    upscale: {
      inputArtifactId: sufficient.id,
      generated: { ...sufficient.dimensions },
      final: { ...target },
      densitySatisfied: true,
      operations: [{ kind: "resize", dimensions: { ...target } }],
      warnings: [],
    },
  };
}

function targetDimensions(target: DensityTarget): PixelDimensions {
  const dimensions =
    target.kind === "oriented_full_frame" ? target.dimensions : target.dimensionsIncludingPad;
  validateDimensions(
    target.kind === "oriented_full_frame"
      ? "oriented full-frame target"
      : "base-space provider crop including pad",
    dimensions,
  );
  return dimensions;
}

function resolutionLimitedWarning(): DensityWarning {
  return {
    code: "upscale_resolution_limited",
    message: "The upscaler's largest valid output is below the target density",
  };
}

function validateScales(scales: readonly number[]): number[] {
  if (scales.length === 0) throw new Error("supported scales must not be empty");
  for (const scale of scales) {
    if (!Number.isFinite(scale) || scale < 1) {
      throw new Error("supported scales must be finite scale factors of at least one");
    }
  }
  if (new Set(scales).size !== scales.length) throw new Error("supported scales must be unique");
  return scales.toSorted((left, right) => left - right);
}

function validateLimits(limits: DensityLimits): void {
  if (!Number.isSafeInteger(limits.maxInputPixels) || limits.maxInputPixels <= 0) {
    throw new Error("maximum input pixels must be a positive integer");
  }
  if (!Number.isSafeInteger(limits.maxOutputPixels) || limits.maxOutputPixels <= 0) {
    throw new Error("maximum output pixels must be a positive integer");
  }
  if (!Number.isSafeInteger(limits.maxOutputEdge) || limits.maxOutputEdge <= 0) {
    throw new Error("maximum output edge must be a positive integer");
  }
}

function scaledDimensions(dimensions: PixelDimensions, scale: number): PixelDimensions {
  const scaled = { w: dimensions.w * scale, h: dimensions.h * scale };
  validateDimensions(`scale ${scale} output`, scaled);
  return scaled;
}

function withinOutputLimits(dimensions: PixelDimensions, limits: DensityLimits): boolean {
  return (
    dimensions.w <= limits.maxOutputEdge &&
    dimensions.h <= limits.maxOutputEdge &&
    dimensions.w * dimensions.h <= limits.maxOutputPixels
  );
}

function covers(candidate: PixelDimensions, target: PixelDimensions): boolean {
  return candidate.w >= target.w && candidate.h >= target.h;
}

function pixelCount(dimensions: PixelDimensions): number {
  return dimensions.w * dimensions.h;
}

function validateArtifact(label: string, artifact: DensityArtifact): void {
  if (artifact.id.length === 0) throw new Error(`${label} artifact id must not be empty`);
  validateDimensions(`${label} dimensions`, artifact.dimensions);
}

function validateDimensions(label: string, dimensions: PixelDimensions): void {
  if (
    !Number.isSafeInteger(dimensions.w) ||
    dimensions.w <= 0 ||
    !Number.isSafeInteger(dimensions.h) ||
    dimensions.h <= 0 ||
    !Number.isSafeInteger(dimensions.w * dimensions.h)
  ) {
    throw new Error(`${label} must contain positive integer dimensions`);
  }
}

function validateSourceContext(sourceContext: SourceContextDensity): void {
  if (sourceContext.tier.length === 0) throw new Error("source context tier must not be empty");
  if (!Number.isFinite(sourceContext.pixelScale) || sourceContext.pixelScale <= 0) {
    throw new Error("source context pixel scale must be positive and finite");
  }
}
