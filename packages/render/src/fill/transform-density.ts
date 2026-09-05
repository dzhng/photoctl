import type { Warning } from "@photoctl/protocol";
import { normalizeArtifact, publishArtifact, readArtifactImage } from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import {
  canonicalNodeRecipe,
  evaluationHash,
  logicalNodeId,
  newExecutionId,
  recipeHash,
} from "../graph/recipes.js";
import {
  commitRevision,
  loadActiveDocument,
  type GraphDatabase,
  type NodeDraft,
  type NodeReference,
  type PreparedNodeExecution,
} from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { maskCentroid } from "../layers/operations.js";
import { resolveTransformMatrix, transformPoint, type Transform } from "../transforms.js";
import { describeFillBranch, directUpscaleChildren } from "./branch.js";
import { planOutputDensity } from "./density.js";
import { cropMappedExternalImage, decodeExternalImage, image16Png } from "./external-pixels.js";
import type { FillUpscaleDependencies } from "./pipeline.js";
import { rebuildFillBranch } from "./rebuild.js";

export interface TransformFillRequest {
  photoId: string;
  layer: string;
  transform: Transform;
  relative: boolean;
  frame: { w: number; h: number };
  source: EvaluateGraphNodeRequest["source"];
  upscaleAdapter?: FillUpscaleDependencies["adapter"];
}

export async function transformFillLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: TransformFillRequest,
) {
  const document = await loadActiveDocument(database, request.photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  const branch = await describeFillBranch(database, request.photoId, selected.contentNodeId);
  if (!branch) return undefined;

  const centroid = await maskCentroid(
    database,
    libraryPath,
    request.photoId,
    branch.permanentMaskNodeId,
  );
  const anchor =
    request.relative && request.transform.anchor === "centroid"
      ? transformPoint(branch.currentMatrix, centroid)
      : centroid;
  const matrix = resolveTransformMatrix(
    branch.currentMatrix,
    request.transform,
    request.relative,
    anchor,
  );
  const scale = Math.hypot(matrix[0], matrix[1]);
  const generationInputScale = Math.hypot(
    branch.generationInputMatrix[0],
    branch.generationInputMatrix[1],
  );
  const target = {
    w: Math.max(1, Math.ceil((branch.crop.w * scale) / generationInputScale)),
    h: Math.max(1, Math.ceil((branch.crop.h * scale) / generationInputScale)),
  };
  const generationEvaluation = await evaluateGraphNode({
    database,
    libraryPath,
    photoId: request.photoId,
    nodeId: branch.generation.id,
    source: request.source,
  });
  const generationImage = await readArtifactImage(
    generationEvaluation.artifact.path,
    generationEvaluation.artifact.artifactHash,
  );
  const identity = branch.upscaleIdentity;
  const adapter = identity?.enabled ? request.upscaleAdapter : undefined;
  const cacheIdentity =
    identity && adapter
      ? { ...identity, adapter: adapter.id, adapterVersion: adapter.version }
      : identity;
  const candidates = cacheIdentity
    ? await directUpscaleChildren(database, request.photoId, branch.generation.id, cacheIdentity)
    : [];
  const loadedCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const evaluated = await evaluateGraphNode({
        database,
        libraryPath,
        photoId: request.photoId,
        nodeId: candidate.node.id,
        source: request.source,
      });
      return {
        node: candidate.node,
        execution: candidate.execution,
        provider: candidate.provider,
        artifact: evaluated.artifact,
        image: await readArtifactImage(evaluated.artifact.path, evaluated.artifact.artifactHash),
      };
    }),
  );

  const density = adapter
    ? planOutputDensity({
        target: { kind: "base_space_provider_crop", dimensionsIncludingPad: target },
        generated: {
          id: generationEvaluation.artifact.artifactHash,
          dimensions: { w: generationImage.w, h: generationImage.h },
        },
        cachedUpscales: loadedCandidates.map(({ artifact, image }) => ({
          id: artifact.artifactHash,
          sourceArtifactId: generationEvaluation.artifact.artifactHash,
          dimensions: { w: image.w, h: image.h },
        })),
        supportedScales: adapter.supportedScales,
        limits: adapter.limits,
        sourceContext: branch.sourceContext,
      })
    : undefined;

  const warnings: Warning[] = [];
  if (density) appendWarnings(warnings, density.upscale.warnings);
  const nodes: NodeDraft[] = [];
  const artifacts = [];
  const executions: PreparedNodeExecution[] = [];
  let chosen: {
    reference: NodeReference;
    nodeId: `node_${string}` | null;
    artifact: typeof generationEvaluation.artifact;
    provider?: ExternalExecutionProvenance;
    reused: boolean;
  } = {
    reference: { nodeId: branch.generation.id },
    nodeId: null,
    artifact: generationEvaluation.artifact,
    reused: true,
  };
  const bestPrior = loadedCandidates.toSorted(
    (left, right) =>
      right.image.w * right.image.h - left.image.w * left.image.h ||
      left.node.id.localeCompare(right.node.id),
  )[0];
  if (bestPrior) {
    chosen = {
      reference: { nodeId: bestPrior.node.id },
      nodeId: bestPrior.node.id as `node_${string}`,
      artifact: bestPrior.artifact,
      provider: bestPrior.provider,
      reused: true,
    };
  }
  let densitySatisfied = generationImage.w >= target.w && generationImage.h >= target.h;
  const selectedCached = density
    ? loadedCandidates.find(
        ({ artifact }) => artifact.artifactHash === density.upscale.inputArtifactId,
      )
    : loadedCandidates
        .filter(({ image }) => image.w >= target.w && image.h >= target.h)
        .toSorted(
          (left, right) =>
            left.image.w * left.image.h - right.image.w * right.image.h ||
            left.node.id.localeCompare(right.node.id),
        )[0];
  if (selectedCached) {
    chosen = {
      reference: { nodeId: selectedCached.node.id },
      nodeId: selectedCached.node.id as `node_${string}`,
      artifact: selectedCached.artifact,
      provider: selectedCached.provider,
      reused: true,
    };
    densitySatisfied = selectedCached.image.w >= target.w && selectedCached.image.h >= target.h;
  } else if (
    density &&
    !density.upscale.operations.some(({ kind }) => kind === "upscale") &&
    density.upscale.inputArtifactId === generationEvaluation.artifact.artifactHash
  ) {
    chosen = {
      reference: { nodeId: branch.generation.id },
      nodeId: null,
      artifact: generationEvaluation.artifact,
      reused: true,
    };
    densitySatisfied = density.upscale.densitySatisfied;
  }

  const operation = density?.upscale.operations.find(
    (item): item is Extract<(typeof density.upscale.operations)[number], { kind: "upscale" }> =>
      item.kind === "upscale",
  );
  if (adapter && identity && operation) {
    const result = await adapter.execute({
      artifact: {
        bytes: await image16Png(generationImage),
        mediaType: "image/png",
        hash: generationEvaluation.artifact.artifactHash,
        dimensions: { w: generationImage.w, h: generationImage.h },
      },
      scale: operation.scale,
      prompt: identity.derivedPrompt,
      ...seedFromGeneration(branch.generation.parameters),
    });
    appendWarnings(warnings, result.warnings);
    if (result.ok) {
      try {
        const bytes = result.value.frameMapping
          ? await cropMappedExternalImage(
              result.value.artifact.bytes,
              result.value.frameMapping.output,
            )
          : result.value.artifact.bytes;
        const image = await decodeExternalImage(bytes, result.samplingDimensions);
        const artifact = await publishArtifact(libraryPath, await normalizeArtifact(image));
        const executionId = newExecutionId();
        const parameters = {
          adapter: adapter.id,
          adapter_version: adapter.version,
          model: identity.model,
          model_version: result.value.provenance.modelVersion,
          scale: operation.scale,
          controls: {
            prompt_id: identity.promptId,
            prompt_version: identity.promptVersion,
            original_prompt: identity.originalPrompt,
            derived_prompt: identity.derivedPrompt,
          },
          request: {
            execution_id: executionId,
            ...seedFromGeneration(branch.generation.parameters),
          },
        };
        const recipe = recipeHash(
          canonicalNodeRecipe({
            kind: "upscale",
            recipeVersion: 1,
            parameters,
            inputNodeIds: [branch.generation.id],
          }),
        );
        const nodeId = logicalNodeId(recipe);
        const provider = providerFromResult(result, generationImage, target);
        nodes.push({
          localKey: "density-upscale",
          kind: "upscale",
          recipeVersion: 1,
          parameters,
          inputs: [{ nodeId: branch.generation.id }],
        });
        artifacts.push(artifact);
        executions.push({
          node: { localKey: "density-upscale" },
          executionId,
          evaluationHash: evaluationHash({
            nodeRecipeHash: recipe,
            kind: "upscale",
            recipeVersion: 1,
            inputArtifactHashes: [generationEvaluation.artifact.artifactHash],
          }),
          outputArtifactHash: artifact.artifactHash,
          inputArtifactHashes: [generationEvaluation.artifact.artifactHash],
          provider,
        });
        chosen = {
          reference: { localKey: "density-upscale" },
          nodeId,
          artifact,
          provider,
          reused: false,
        };
        densitySatisfied =
          result.samplingDimensions.w >= target.w && result.samplingDimensions.h >= target.h;
      } catch (error) {
        appendWarnings(warnings, [
          {
            code: "upscale_failed",
            message: error instanceof Error ? error.message : "Upscaler returned unreadable pixels",
          },
        ]);
        densitySatisfied = false;
      }
    } else {
      appendWarnings(warnings, result.warnings);
      densitySatisfied = false;
    }
  }
  if (!adapter && identity?.enabled && !densitySatisfied) {
    appendWarnings(warnings, [
      {
        code: "upscale_unconfigured",
        message: "The generated layer needs more density but its upscaler is not configured",
      },
    ]);
  }

  const chosenDimensions = { w: chosen.artifact.w, h: chosen.artifact.h };
  const rebuilt = rebuildFillBranch({
    branch,
    key: "density",
    frame: request.frame,
    baseNodeId: document.roots.base,
    placement: chosen.reference,
    placementDimensions: chosenDimensions,
    generationDimensions: branch.generationDimensions,
    matrix,
    preserveCompensations: true,
  });
  nodes.push(...rebuilt.nodes);
  const layers: RevisionLayerDraft[] = document.layers.map((layer) => ({
    layer: { layerId: layer.id },
    name: layer.name,
    z: layer.z,
    contentNode: layer.id === layerId ? rebuilt.content : { nodeId: layer.contentNodeId },
    maskNode: layer.id === layerId ? rebuilt.mask : { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  }));
  const output = compositeV2Projection({ nodeId: document.roots.base }, layers);
  nodes.push({
    localKey: "density-document-composite",
    kind: "composite",
    recipeVersion: 2,
    ...output,
  });
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    nodes,
    artifacts,
    executions,
    rootUpdates: [{ root: "output", node: { localKey: "density-document-composite" } }],
    layers,
  });
  if (!committed.renderHash) throw new Error("A layer transform must commit a render hash");
  const layer = committed.layers.find(({ id }) => id === layerId)!;
  return {
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    matrix,
    layer,
    warnings,
    upscale: identity
      ? {
          enabled: identity.enabled,
          executed: chosen.nodeId !== null,
          nodeId: chosen.nodeId,
          adapter: chosen.provider?.adapter ?? null,
          model: identity.model,
          input: { w: generationImage.w, h: generationImage.h },
          target,
          generated: chosenDimensions,
          final: target,
          densitySatisfied,
          warnings: warnings.filter(({ code }) => code.startsWith("upscale_")),
          reused: chosen.reused,
        }
      : null,
  };
}

function seedFromGeneration(parameters: unknown): { seed?: number } {
  const request = (parameters as { request?: { seed?: unknown } } | null)?.request;
  return typeof request?.seed === "number" ? { seed: request.seed } : {};
}

function providerFromResult(
  result: Extract<
    Awaited<ReturnType<NonNullable<FillUpscaleDependencies["adapter"]>["execute"]>>,
    { ok: true }
  >,
  generation: { w: number; h: number },
  target: { w: number; h: number },
): ExternalExecutionProvenance {
  const value = result.value.provenance;
  return {
    adapter: value.adapter,
    adapterVersion: value.adapterVersion,
    service: value.service,
    model: value.model,
    modelVersion: value.modelVersion,
    providerRequestId: value.requestId,
    seed: value.seed,
    durationMs: value.durationMs,
    costUsd: value.costUsd,
    inputPx: generation.w * generation.h,
    targetPx: target.w * target.h,
    attempt: 1,
    densityVerdict: result.densitySatisfied ? "satisfied" : "limited",
    warnings: result.warnings,
  };
}

function appendWarnings(target: Warning[], additions: readonly Warning[]): void {
  for (const warning of additions) {
    if (!target.some(({ code, message }) => code === warning.code && message === warning.message)) {
      target.push(warning);
    }
  }
}
