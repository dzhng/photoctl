import type { Warning } from "@photoctl/protocol";
import { readArtifactImage, type PublishedArtifact } from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { inspectGraphNode } from "../graph/inspection.js";
import type { GraphDatabase } from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import type { Image16 } from "../source-render.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./pipeline.js";

interface ReusableExternalNode {
  nodeId: `node_${string}`;
  image: Image16;
  artifact: PublishedArtifact;
  provider: ExternalExecutionProvenance;
}

export interface ReusableFillLineage extends ReusableExternalNode {
  baseNodeId: string;
  sourceContext: { tier: string; pixelScale: number; resolutionLimited: boolean };
  cachedUpscale?: ReusableExternalNode;
}

/** Recognizes only the immediate canonical fill branch; this is not a general ancestry search. */
export async function findReusableFillLineage(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    prompt: string;
    promptVersion: number;
    operation: "remove" | "prompt";
    seed?: number;
    source: EvaluateGraphNodeRequest["source"];
    dependencies: FillGenerationDependencies;
    upscale: FillUpscaleDependencies;
  },
  selected: { contentNodeId: string; maskNodeId: string },
  crop: { x: number; y: number; w: number; h: number },
  frame: { w: number; h: number },
): Promise<ReusableFillLineage | undefined> {
  const composite = await inspectGraphNode(database, {
    photoId: request.photoId,
    nodeId: selected.contentNodeId,
  });
  if (
    composite.kind !== "mask_composite" ||
    composite.inputNodeIds.length !== 3 ||
    composite.inputNodeIds[2] !== selected.maskNodeId ||
    (composite.parameters as { feather?: unknown }).feather !== 0
  )
    return undefined;
  const resample = await inspectGraphNode(database, {
    photoId: request.photoId,
    nodeId: composite.inputNodeIds[1]!,
  });
  if (resample.kind !== "resample" || resample.inputNodeIds.length !== 1) return undefined;
  const parameters = resample.parameters as {
    w?: unknown;
    h?: unknown;
    kernel?: unknown;
    target?: { x?: unknown; y?: unknown; w?: unknown; h?: unknown };
  };
  if (
    parameters.w !== frame.w ||
    parameters.h !== frame.h ||
    parameters.kernel !== "lanczos3" ||
    parameters.target?.x !== crop.x ||
    parameters.target.y !== crop.y ||
    parameters.target.w !== crop.w ||
    parameters.target.h !== crop.h
  )
    return undefined;
  const placement = await inspectGraphNode(database, {
    photoId: request.photoId,
    nodeId: resample.inputNodeIds[0]!,
  });
  let cachedUpscale: ReusableExternalNode | undefined;
  let generation = placement;
  if (placement.kind === "upscale") {
    if (placement.inputNodeIds.length !== 1) return undefined;
    const upscaleParameters = placement.parameters as {
      adapter?: unknown;
      adapter_version?: unknown;
      model?: unknown;
      controls?: {
        prompt_id?: unknown;
        prompt_version?: unknown;
        original_prompt?: unknown;
        derived_prompt?: unknown;
      };
      request?: { execution_id?: unknown };
    };
    const cacheMatches =
      request.upscale.adapter &&
      upscaleParameters.adapter === request.upscale.adapter.id &&
      upscaleParameters.adapter_version === request.upscale.adapter.version &&
      upscaleParameters.model === request.upscale.policy.upscale.model &&
      upscaleParameters.controls?.prompt_id === request.upscale.prompt.id &&
      upscaleParameters.controls.prompt_version === request.upscale.prompt.version &&
      upscaleParameters.controls.original_prompt === request.upscale.prompt.original &&
      upscaleParameters.controls.derived_prompt === request.upscale.prompt.derived &&
      typeof upscaleParameters.request?.execution_id === "string";
    if (cacheMatches) {
      const upscaleExecution = placement.executions.find(
        ({ executionId }) => executionId === upscaleParameters.request!.execution_id,
      );
      const upscaleProvider = upscaleExecution?.providerProvenance as
        | Record<string, unknown>
        | null
        | undefined;
      if (upscaleExecution?.artifactAvailable && upscaleProvider) {
        cachedUpscale = await loadExternalNode(
          database,
          libraryPath,
          request.photoId,
          placement.id,
          request.source,
          upscaleProvider,
        );
      }
    }
    generation = await inspectGraphNode(database, {
      photoId: request.photoId,
      nodeId: placement.inputNodeIds[0]!,
    });
  }
  if (generation.kind !== "generate" || generation.inputNodeIds.length !== 1) return undefined;
  const generationParameters = generation.parameters as {
    adapter?: unknown;
    adapter_version?: unknown;
    model?: unknown;
    prompt?: unknown;
    prompt_version?: unknown;
    request?: {
      execution_id?: unknown;
      operation?: unknown;
      crop?: unknown;
      seed?: unknown;
      source_context?: unknown;
    };
  };
  if (
    generationParameters.adapter !== request.dependencies.adapter.id ||
    generationParameters.adapter_version !== request.dependencies.adapter.version ||
    generationParameters.model !== request.dependencies.model ||
    generationParameters.prompt !== request.prompt ||
    generationParameters.prompt_version !== request.promptVersion ||
    generationParameters.request?.operation !== request.operation ||
    JSON.stringify(generationParameters.request.crop) !==
      JSON.stringify([crop.x, crop.y, crop.w, crop.h]) ||
    generationParameters.request.seed !== request.seed ||
    typeof generationParameters.request.execution_id !== "string"
  )
    return undefined;
  const execution = generation.executions.find(
    ({ executionId }) => executionId === generationParameters.request!.execution_id,
  );
  const rawProvider = execution?.providerProvenance as Record<string, unknown> | null | undefined;
  if (!execution?.artifactAvailable || !rawProvider) return undefined;
  const sourceContext = parseSourceContext(generationParameters.request.source_context);
  if (!sourceContext) return undefined;
  return {
    ...(await loadExternalNode(
      database,
      libraryPath,
      request.photoId,
      generation.id,
      request.source,
      rawProvider,
    )),
    baseNodeId: composite.inputNodeIds[0]!,
    sourceContext,
    ...(cachedUpscale ? { cachedUpscale } : {}),
  };
}

function parseSourceContext(
  value: unknown,
): { tier: string; pixelScale: number; resolutionLimited: boolean } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const context = value as Record<string, unknown>;
  if (
    typeof context.tier !== "string" ||
    typeof context.pixel_scale !== "number" ||
    typeof context.resolution_limited !== "boolean"
  )
    return undefined;
  return {
    tier: context.tier,
    pixelScale: context.pixel_scale,
    resolutionLimited: context.resolution_limited,
  };
}

async function loadExternalNode(
  database: GraphDatabase,
  libraryPath: string,
  photoId: string,
  nodeId: string,
  source: EvaluateGraphNodeRequest["source"],
  provider: Record<string, unknown>,
): Promise<ReusableExternalNode> {
  const evaluated = await evaluateGraphNode({ database, libraryPath, photoId, nodeId, source });
  return {
    nodeId: nodeId as `node_${string}`,
    image: await readArtifactImage(evaluated.artifact.path, evaluated.artifact.artifactHash),
    artifact: evaluated.artifact,
    provider: providerFromInspection(provider),
  };
}

function providerFromInspection(value: Record<string, unknown>): ExternalExecutionProvenance {
  return {
    adapter: String(value.adapter),
    adapterVersion: typeof value.adapter_version === "string" ? value.adapter_version : null,
    service: String(value.service),
    model: String(value.model),
    modelVersion: typeof value.model_version === "string" ? value.model_version : null,
    providerRequestId:
      typeof value.provider_request_id === "string" ? value.provider_request_id : null,
    seed: typeof value.seed === "number" ? value.seed : null,
    durationMs: Number(value.duration_ms),
    costUsd: Number(value.cost_usd),
    inputPx: Number(value.input_px),
    targetPx: Number(value.target_px),
    attempt: Number(value.attempt),
    densityVerdict:
      value.density_verdict === "satisfied" || value.density_verdict === "limited"
        ? value.density_verdict
        : "not-applicable",
    warnings: Array.isArray(value.warnings) ? (value.warnings as Warning[]) : [],
  };
}
