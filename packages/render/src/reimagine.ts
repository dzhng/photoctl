import {
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactImage,
} from "./artifacts/publication.js";
import { readActiveDevelopState } from "./develop/state.js";
import { loadBaseProjection, loadLogicalFrame } from "./graph/projection.js";
import { frameAtRaster, savedRenderFrame } from "./graph/frame.js";
import { failProviderImageAttempts } from "./provider-images/attempts.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "./graph/evaluator.js";
import { commitRevision, type GraphDatabase, type NodeDraft } from "./graph/store.js";
import { executeFreshGeneration, executeGenerationDensity } from "./fill/generation.js";
import { image16Png } from "./fill/external-pixels.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./fill/pipeline.js";
import type { SourceContextDensity } from "./fill/density.js";
import { layerDraft, type RevisionLayerDraft } from "./layers/model.js";

export type ReimagineDependencies = FillGenerationDependencies;

export async function createReimagineLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    orientation: number;
    prompt: string;
    providerPrompt: string;
    promptVersion: number;
    strength: number;
    layerName: string;
    source: EvaluateGraphNodeRequest["source"];
    sourceContext: SourceContextDensity;
    dependencies: ReimagineDependencies;
    upscale: FillUpscaleDependencies;
    state?: Awaited<ReturnType<typeof readActiveDevelopState>>;
    inputEvaluation?: import("./graph/evaluator.js").EvaluatedNode;
  },
) {
  const state =
    request.state ??
    (await readActiveDevelopState(database, {
      photoId: request.photoId,
      orientation: request.orientation,
    }));
  const inputEvaluation =
    request.inputEvaluation ??
    (await evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: state.pixelOutputNodeId,
      source: request.source,
    }));
  const input = await readArtifactImage(
    inputEvaluation.artifact.path,
    inputEvaluation.artifact.artifactHash,
  );
  const inputFrame = await loadBaseProjection(database, request.photoId, inputEvaluation);
  const logicalFrame = await loadLogicalFrame(database, request.photoId, state.pixelOutputNodeId);
  const authoredFrame = frameAtRaster(inputFrame, logicalFrame.raster);
  const targetDimensions = authoredFrame.raster;
  const inputPng = await image16Png(input);
  const generation = await executeFreshGeneration(database, libraryPath, {
    inputNodeId: state.pixelOutputNodeId,
    inputArtifactHash: inputEvaluation.artifact.artifactHash,
    prompt: request.prompt,
    promptVersion: request.promptVersion,
    dependencies: request.dependencies,
    buildRequest: () =>
      request.dependencies.adapter.buildFullFrameEdit(
        { png: inputPng, w: input.w, h: input.h },
        request.providerPrompt,
      ),
    request: (executionId, returned) => ({
      execution_id: executionId,
      scope: "full-frame",
      drift: "full-frame",
      returned: [returned.w, returned.h],
      strength: request.strength,
      blend_coverage: request.strength,
      provider_prompt: request.providerPrompt,
      full_frame: {
        input_policy: "photographic-composite",
        input_frame: savedRenderFrame(inputFrame),
        authored_frame: savedRenderFrame(authoredFrame),
        input_execution_id: inputEvaluation.executionId,
        predecessor_layer_ids: state.layers.map(({ id }) => id),
      },
      source_context: {
        tier: request.sourceContext.tier,
        pixel_scale: request.sourceContext.pixelScale,
        resolution_limited: request.sourceContext.resolutionLimited,
      },
      upscale: {
        enabled: request.upscale.policy.upscale.enabled,
        adapter: request.upscale.adapter?.id ?? null,
        adapter_version: request.upscale.adapter?.version ?? null,
        model: request.upscale.policy.upscale.model,
        prompt_id: request.upscale.prompt.id,
        prompt_version: request.upscale.prompt.version,
        original_prompt: request.upscale.prompt.original,
        derived_prompt: request.upscale.prompt.derived,
      },
    }),
  });
  const density = await executeGenerationDensity(database, libraryPath, {
    generation,
    target: { kind: "oriented_full_frame", dimensions: targetDimensions },
    targetDimensions,
    sourceContext: request.sourceContext,
    upscale: request.upscale,
  });
  try {
    const mask = await publishArtifact(
      libraryPath,
      await normalizeMaskArtifact({
        w: targetDimensions.w,
        h: targetDimensions.h,
        data: new Float32Array(targetDimensions.w * targetDimensions.h).fill(request.strength),
      }),
    );
    const nodes: NodeDraft[] = [
      ...density.nodes,
      {
        localKey: "mask",
        kind: "mask",
        recipeVersion: 1,
        parameters: { artifact_hash: mask.artifactHash },
        inputs: [],
      },
      ...(
        [
          ["content-placement", density.output, density.upscale.generated],
          ["mask-placement", { localKey: "mask" }, targetDimensions],
        ] as const
      ).map(([localKey, input, raster]) => ({
        localKey,
        kind: "transform" as const,
        recipeVersion: 2,
        parameters: {
          matrix: [1, 0, 0, 1, 0, 0],
          frame: savedRenderFrame(frameAtRaster(authoredFrame, raster)),
        },
        inputs: [input],
      })),
    ];
    const layers: RevisionLayerDraft[] = [
      ...state.layers.map((layer) => layerDraft(layer, layer.z)),
      {
        layer: { localKey: "reimagine-layer" },
        name: `${request.layerName} ${state.layers.length + 1}`,
        z: Math.max(-1, ...state.layers.map(({ z }) => z)) + 1,
        contentNode: { localKey: "content-placement" },
        maskNode: { localKey: "mask-placement" },
        opacity: 1,
        blend: "normal",
        enabled: true,
      },
    ];
    const committed = await commitRevision(database, {
      outputPlan: "photographic",
      photoId: request.photoId,
      expectedRevisionId: state.revisionId,
      artifacts: [...density.artifacts, mask],
      executions: density.executions,
      nodes,
      newLayers: [{ localKey: "reimagine-layer", role: "reimagine" }],
      layers,
      rootUpdates: [],
    });
    if (!committed.renderHash) throw new Error("A reimagine revision must have a render hash");
    return {
      layerId: committed.newLayers["reimagine-layer"]!,
      revisionId: committed.revisionId,
      outputNodeId: committed.roots.output! as `node_${string}`,
      renderHash: committed.renderHash as `r_${string}`,
      generationNodeId: generation.nodeId,
      returnedDimensions: generation.returnedDimensions,
      sourceContext: request.sourceContext,
      warnings: density.warnings,
      upscale: density.upscale,
      executions: [
        { kind: "generate" as const, nodeId: generation.nodeId, provider: generation.provider },
        ...(density.upscale.nodeId && density.upscale.provider
          ? [
              {
                kind: "upscale" as const,
                nodeId: density.upscale.nodeId,
                provider: density.upscale.provider,
              },
            ]
          : []),
      ],
    };
  } catch (error) {
    try {
      await failProviderImageAttempts(
        database,
        density.executions.flatMap((execution) =>
          execution.providerImageAttemptId ? [execution.providerImageAttemptId] : [],
        ),
        error,
      );
    } catch {
      /* Keep the publication diagnostic when the catalog is unavailable. */
    }
    throw error;
  }
}
