import {
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactImage,
} from "./artifacts/publication.js";
import { readActiveDevelopState } from "./develop/state.js";
import { hasDevelopGeometry } from "./develop/geometry.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "./graph/evaluator.js";
import { commitRevision, type GraphDatabase, type NodeDraft } from "./graph/store.js";
import { executeFreshGeneration, executeGenerationDensity } from "./fill/generation.js";
import { image16Png } from "./fill/external-pixels.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./fill/pipeline.js";
import type { SourceContextDensity } from "./fill/density.js";
import { compositeV2Projection, type RevisionLayerDraft } from "./layers/model.js";

export type ReimagineDependencies = FillGenerationDependencies;

export async function createReimagineLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    orientation: number;
    dimensions: { w: number; h: number };
    prompt: string;
    providerPrompt: string;
    promptVersion: number;
    strength: number;
    source: EvaluateGraphNodeRequest["source"];
    sourceContext: SourceContextDensity;
    dependencies: ReimagineDependencies;
    upscale: FillUpscaleDependencies;
  },
) {
  const state = await readActiveDevelopState(database, {
    photoId: request.photoId,
    orientation: request.orientation,
  });
  if (hasDevelopGeometry(state.develop)) {
    throw new Error(
      "Reimagine requires the current develop output to retain the oriented base dimensions",
    );
  }
  const baseEvaluation = await evaluateGraphNode({
    database,
    libraryPath,
    photoId: request.photoId,
    nodeId: state.baseNodeId,
    source: request.source,
  });
  const base = await readArtifactImage(
    baseEvaluation.artifact.path,
    baseEvaluation.artifact.artifactHash,
  );
  if (base.w !== request.dimensions.w || base.h !== request.dimensions.h) {
    throw new Error(
      "Reimagine requires the current develop output to retain the oriented base dimensions",
    );
  }
  const inputPng = await image16Png(base);
  const generation = await executeFreshGeneration(libraryPath, {
    inputNodeId: state.baseNodeId,
    inputArtifactHash: baseEvaluation.artifact.artifactHash,
    sentDimensions: { w: base.w, h: base.h },
    prompt: request.prompt,
    promptVersion: request.promptVersion,
    dependencies: request.dependencies,
    buildRequest: () =>
      request.dependencies.adapter.buildFullFrameEdit(
        { png: inputPng, w: base.w, h: base.h },
        request.providerPrompt,
      ),
    request: (executionId, returned) => ({
      execution_id: executionId,
      scope: "full-frame",
      drift: "full-frame",
      sent: [base.w, base.h],
      returned: [returned.w, returned.h],
      strength: request.strength,
      blend_coverage: request.strength,
      provider_prompt: request.providerPrompt,
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
    targetPixels: request.dimensions.w * request.dimensions.h,
  });
  const density = await executeGenerationDensity(libraryPath, {
    generation,
    target: { kind: "oriented_full_frame", dimensions: request.dimensions },
    targetDimensions: request.dimensions,
    sourceContext: request.sourceContext,
    upscale: request.upscale,
  });
  const mask = await publishArtifact(
    libraryPath,
    await normalizeMaskArtifact({
      w: request.dimensions.w,
      h: request.dimensions.h,
      data: new Float32Array(request.dimensions.w * request.dimensions.h).fill(request.strength),
    }),
  );
  const nodes: NodeDraft[] = [
    ...density.nodes,
    {
      localKey: "resample",
      kind: "resample",
      recipeVersion: 1,
      parameters: { w: request.dimensions.w, h: request.dimensions.h, kernel: "lanczos3" },
      inputs: [density.output],
    },
    {
      localKey: "mask",
      kind: "mask",
      recipeVersion: 1,
      parameters: { artifact_hash: mask.artifactHash },
      inputs: [],
    },
  ];
  const layers: RevisionLayerDraft[] = [
    ...state.layers.map((layer) => ({
      layer: { layerId: layer.id },
      name: layer.name,
      z: layer.z,
      contentNode: { nodeId: layer.contentNodeId },
      maskNode: { nodeId: layer.maskNodeId },
      opacity: layer.opacity,
      blend: layer.blend,
      enabled: layer.enabled,
    })),
    {
      layer: { localKey: "reimagine-layer" },
      name: `Reimagine ${state.layers.length + 1}`,
      z: Math.max(-1, ...state.layers.map(({ z }) => z)) + 1,
      contentNode: { localKey: "resample" },
      maskNode: { localKey: "mask" },
      opacity: 1,
      blend: "normal",
      enabled: true,
    },
  ];
  nodes.push({
    localKey: "document-composite",
    kind: "composite",
    recipeVersion: 2,
    ...compositeV2Projection({ nodeId: state.baseNodeId }, layers),
  });
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: state.revisionId,
    artifacts: [...density.artifacts, mask],
    executions: density.executions,
    nodes,
    newLayers: [{ localKey: "reimagine-layer", role: "reimagine" }],
    layers,
    rootUpdates: [{ root: "output", node: { localKey: "document-composite" } }],
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
}
