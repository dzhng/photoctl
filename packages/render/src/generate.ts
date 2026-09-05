import { resampleDisplaySrgb } from "@photoctl/img";
import { normalizeArtifact, publishArtifact } from "./artifacts/publication.js";
import { executeGenerationDensity, executeStandaloneGeneration } from "./fill/generation.js";
import type { FillUpscaleDependencies } from "./fill/pipeline.js";
import type { NodeDraft, NodeReference, PreparedNodeExecution } from "./graph/store.js";

export async function prepareStandaloneGeneratedPhoto(
  libraryPath: string,
  request: Parameters<typeof executeStandaloneGeneration>[1] & {
    upscale?: FillUpscaleDependencies;
  },
) {
  const generation = await executeStandaloneGeneration(libraryPath, request);
  let nodes: NodeDraft[] = [...generation.nodes];
  let artifacts = [...generation.artifacts];
  let executions: PreparedNodeExecution[] = [...generation.executions];
  let output: NodeReference = generation.reference;
  let finalArtifact = generation.artifact;
  let warnings = [...generation.warnings];
  let upscale = {
    enabled: request.upscale?.policy.upscale.enabled ?? false,
    executed: false,
    nodeId: null as `node_${string}` | null,
    adapter: null as string | null,
    model: request.upscale?.policy.upscale.model ?? "none",
    input: generation.returnedDimensions,
    target: request.dimensions,
    generated: generation.returnedDimensions,
    final: generation.returnedDimensions,
    densitySatisfied:
      generation.returnedDimensions.w >= request.dimensions.w &&
      generation.returnedDimensions.h >= request.dimensions.h,
    warnings: [] as typeof warnings,
    provider: undefined as (typeof generation)["provider"] | undefined,
  };

  const needsRequestedPixels =
    request.upscale?.policy.upscale.action === "upscale" &&
    (generation.returnedDimensions.w < request.dimensions.w ||
      generation.returnedDimensions.h < request.dimensions.h);
  if (needsRequestedPixels && request.upscale) {
    const density = await executeGenerationDensity(libraryPath, {
      generation,
      target: { kind: "oriented_full_frame", dimensions: request.dimensions },
      targetDimensions: request.dimensions,
      sourceContext: { tier: "standalone", pixelScale: 1, resolutionLimited: false },
      upscale: request.upscale,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
    nodes = density.nodes;
    artifacts = density.artifacts;
    executions = density.executions;
    output = density.output;
    warnings = density.warnings;
    upscale = { ...density.upscale, final: { w: density.outputImage.w, h: density.outputImage.h } };
    if (density.upscale.executed) {
      if (
        density.outputImage.w !== request.dimensions.w ||
        density.outputImage.h !== request.dimensions.h
      ) {
        const resized = {
          ...density.outputImage,
          w: request.dimensions.w,
          h: request.dimensions.h,
          data: resampleDisplaySrgb(
            density.outputImage.data,
            density.outputImage.w,
            density.outputImage.h,
            request.dimensions.w,
            request.dimensions.h,
          ),
        };
        finalArtifact = await publishArtifact(libraryPath, await normalizeArtifact(resized));
        artifacts.push(finalArtifact);
        nodes.push({
          localKey: "standalone-resample",
          kind: "resample",
          recipeVersion: 1,
          parameters: { w: request.dimensions.w, h: request.dimensions.h, kernel: "lanczos3" },
          inputs: [output],
        });
        output = { localKey: "standalone-resample" };
      } else {
        finalArtifact = density.artifacts.at(-1)!;
      }
      upscale.final = { ...request.dimensions };
    }
  } else if (request.upscale) {
    warnings.push(...request.upscale.policy.upscale.warnings);
    upscale.warnings = [...request.upscale.policy.upscale.warnings];
  }

  nodes.push({
    localKey: "standalone-output",
    kind: "output",
    recipeVersion: 1,
    parameters: { format: "display-rgb", color_space: "srgb" },
    inputs: [output],
  });
  output = { localKey: "standalone-output" };
  return { generation, nodes, artifacts, executions, output, finalArtifact, warnings, upscale };
}
