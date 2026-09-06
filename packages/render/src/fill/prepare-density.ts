import type { Warning } from "@photoctl/protocol";
import { readArtifactImage } from "../artifacts/publication.js";
import { executeRetainedUpscale } from "../provider-images/upscale.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import {
  canonicalNodeRecipe,
  evaluationHash,
  logicalNodeId,
  newExecutionId,
  recipeHash,
} from "../graph/recipes.js";
import type {
  GraphDatabase,
  NodeDraft,
  NodeReference,
  PreparedNodeExecution,
} from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import type { TransformMatrix } from "../transforms.js";
import { directUpscaleChildren, type FillBranchDescriptor } from "./branch.js";
import { planOutputDensity, fillPlacementDimensions } from "./density.js";
import { image16Png } from "./external-pixels.js";
import type { FillUpscaleDependencies } from "./pipeline.js";
import { rebuildFillBranch } from "./rebuild.js";

export interface FillDensityRequest {
  photoId: string;
  frame: { w: number; h: number };
  source: EvaluateGraphNodeRequest["source"];
  resolveUpscaleAdapter?: (model: string) => Promise<FillUpscaleDependencies["adapter"]>;
  branch: FillBranchDescriptor;
  matrix: TransformMatrix;
  baseNodeId: string;
}

/** Prepare against the caller's snapshot; only its revision writer activates these pixels. */
export async function prepareFillDensity(
  database: GraphDatabase,
  libraryPath: string,
  request: FillDensityRequest,
) {
  const { branch, matrix } = request;
  const scale = Math.hypot(matrix[0], matrix[1]);
  const demandIncreased =
    scale > Math.hypot(branch.currentMatrix[0], branch.currentMatrix[1]) + 1e-9;
  const target = fillPlacementDimensions(branch, matrix);
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
  const adapter =
    identity?.enabled && demandIncreased
      ? await request.resolveUpscaleAdapter?.(identity.model)
      : undefined;
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
  if (adapter && identity && operation && demandIncreased) {
    const result = await executeRetainedUpscale(database, libraryPath, adapter, {
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
        const { artifact } = result;
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
          providerImageAttemptId: result.attemptId,
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
  if (demandIncreased && !adapter && identity?.enabled && !densitySatisfied) {
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
    baseNodeId: request.baseNodeId,
    placement: chosen.reference,
    placementDimensions: chosenDimensions,
    generationDimensions: branch.generationDimensions,
    matrix,
    preserveCompensations: true,
  });
  nodes.push(...rebuilt.nodes);
  return {
    nodes,
    artifacts,
    executions,
    content: rebuilt.content,
    mask: rebuilt.mask,
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
