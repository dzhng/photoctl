import { readArtifactImage, type PublishedArtifact } from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import type { GraphDatabase } from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import type { Image16 } from "../source-render.js";
import { describeFillBranch } from "./branch.js";
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
  generationRecipe: {
    recipeVersion: number;
    parameters: Record<string, unknown>;
    inputNodeId: string;
    inputArtifactHashes: string[];
    intentMatches: boolean;
  };
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
  const branch = await describeFillBranch(database, request.photoId, selected.contentNodeId);
  if (!branch || branch.descendants.length > 0) return undefined;
  const { resample } = branch;
  if (branch.maskNodeId !== selected.maskNodeId) return undefined;
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
  let cachedUpscale: ReusableExternalNode | undefined;
  const generation = branch.generation;
  if (branch.upscale) {
    const placement = branch.upscale;
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
      const upscaleProvider = branch.upscaleProvider;
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
  }
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
      upscale?: unknown;
    };
  };
  const storedUpscale = generationParameters.request
    ? (generationParameters.request.upscale as Record<string, unknown> | undefined)
    : undefined;
  const expectedUpscale = {
    enabled: request.upscale.policy.upscale.enabled,
    model: request.upscale.policy.upscale.model,
    prompt_id: request.upscale.prompt.id,
    prompt_version: request.upscale.prompt.version,
    original_prompt: request.upscale.prompt.original,
    derived_prompt: request.upscale.prompt.derived,
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
  const rawProvider = branch.generationProvider;
  if (!execution?.artifactAvailable || !rawProvider) return undefined;
  const inputs = await database.query<{ input_artifact_hash: string }>(
    `SELECT input_artifact_hash FROM node_execution_inputs
     WHERE photo_id = $1 AND execution_id = $2 ORDER BY input_index`,
    [request.photoId, execution.executionId],
  );
  if (inputs.rows.length !== generation.inputNodeIds.length) return undefined;
  return {
    ...(await loadExternalNode(
      database,
      libraryPath,
      request.photoId,
      generation.id,
      request.source,
      rawProvider,
    )),
    baseNodeId: branch.baseNodeId,
    sourceContext: branch.sourceContext,
    generationRecipe: {
      recipeVersion: generation.recipeVersion,
      parameters: generationParameters,
      inputNodeId: generation.inputNodeIds[0]!,
      inputArtifactHashes: inputs.rows.map(({ input_artifact_hash }) => input_artifact_hash),
      intentMatches:
        storedUpscale !== undefined &&
        !Object.entries(expectedUpscale).some(([key, value]) => storedUpscale[key] !== value),
    },
    ...(cachedUpscale ? { cachedUpscale } : {}),
  };
}

async function loadExternalNode(
  database: GraphDatabase,
  libraryPath: string,
  photoId: string,
  nodeId: string,
  source: EvaluateGraphNodeRequest["source"],
  provider: ExternalExecutionProvenance,
): Promise<ReusableExternalNode> {
  const evaluated = await evaluateGraphNode({ database, libraryPath, photoId, nodeId, source });
  return {
    nodeId: nodeId as `node_${string}`,
    image: await readArtifactImage(evaluated.artifact.path, evaluated.artifact.artifactHash),
    artifact: evaluated.artifact,
    provider,
  };
}
