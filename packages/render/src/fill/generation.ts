import type { Warning } from "@photoctl/protocol";
import { normalizeArtifact, publishArtifact } from "../artifacts/publication.js";
import {
  canonicalNodeRecipe,
  evaluationHash,
  logicalNodeId,
  newExecutionId,
  recipeHash,
} from "../graph/recipes.js";
import type { NodeDraft, NodeReference, PreparedNodeExecution } from "../graph/store.js";
import type { ExternalExecutionProvenance, JsonValue } from "../graph/types.js";
import type { Image16 } from "../source-render.js";
import { planOutputDensity, type DensityTarget, type SourceContextDensity } from "./density.js";
import { cropMappedExternalImage, decodeExternalImage, image16Png } from "./external-pixels.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./pipeline.js";

export interface PreparedGeneration {
  nodeId: `node_${string}`;
  reference: NodeReference;
  provider: ExternalExecutionProvenance;
  image: Image16;
  artifact: Awaited<ReturnType<typeof publishArtifact>>;
  returnedDimensions: { w: number; h: number };
  warnings: Warning[];
  nodes: NodeDraft[];
  artifacts: Array<Awaited<ReturnType<typeof publishArtifact>>>;
  executions: PreparedNodeExecution[];
}

export async function executeFreshGeneration(
  libraryPath: string,
  input: {
    inputNodeId: string;
    inputArtifactHash: `a_${string}`;
    sentDimensions: { w: number; h: number };
    prompt: string;
    promptVersion: number;
    seed?: number;
    dependencies: FillGenerationDependencies;
    request: (executionId: `exec_${string}`, returned: { w: number; h: number }) => JsonValue;
    buildRequest: () => FormData;
    validate?: (response: {
      wholeFrame: boolean;
      returnedDimensions: { w: number; h: number };
    }) => void;
    targetPixels: number;
  },
): Promise<PreparedGeneration> {
  const executionId = newExecutionId();
  const started = (input.dependencies.now ?? Date.now)();
  const response = await input.dependencies.gateway.imageEdits(input.buildRequest());
  const normalized = await input.dependencies.adapter.normalize(
    response.data,
    input.sentDimensions,
  );
  input.validate?.(normalized);
  const image = await decodeExternalImage(normalized.png, normalized.returnedDimensions);
  const artifact = await publishArtifact(libraryPath, await normalizeArtifact(image));
  const parameters = {
    adapter: input.dependencies.adapter.id,
    adapter_version: input.dependencies.adapter.version,
    model: input.dependencies.model,
    model_version: null,
    prompt: input.prompt,
    prompt_version: input.promptVersion,
    request: input.request(executionId, normalized.returnedDimensions),
  } as const;
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: "generate",
      recipeVersion: 1,
      parameters,
      inputNodeIds: [input.inputNodeId],
    }),
  );
  const nodeId = logicalNodeId(recipe) as `node_${string}`;
  const provider: ExternalExecutionProvenance = {
    adapter: input.dependencies.adapter.id,
    adapterVersion: input.dependencies.adapter.version,
    service: input.dependencies.service ?? "gateway",
    model: input.dependencies.model,
    modelVersion: null,
    providerRequestId: response.requestId,
    seed: input.seed ?? null,
    durationMs: Math.max(0, (input.dependencies.now ?? Date.now)() - started),
    costUsd: 0,
    inputPx: input.sentDimensions.w * input.sentDimensions.h,
    targetPx: input.targetPixels,
    attempt: response.attempts,
    densityVerdict: "not-applicable",
    warnings: normalized.warnings,
  };
  return {
    nodeId,
    reference: { localKey: "generation" },
    provider,
    image,
    artifact,
    returnedDimensions: normalized.returnedDimensions,
    warnings: normalized.warnings,
    nodes: [
      {
        localKey: "generation",
        kind: "generate",
        recipeVersion: 1,
        parameters,
        inputs: [{ nodeId: input.inputNodeId }],
      },
    ],
    artifacts: [artifact],
    executions: [
      {
        node: { localKey: "generation" },
        executionId,
        evaluationHash: evaluationHash({
          nodeRecipeHash: recipe,
          kind: "generate",
          recipeVersion: 1,
          inputArtifactHashes: [input.inputArtifactHash],
        }),
        outputArtifactHash: artifact.artifactHash,
        inputArtifactHashes: [input.inputArtifactHash],
        provider,
      },
    ],
  };
}

export async function executeGenerationDensity(
  libraryPath: string,
  input: {
    generation: PreparedGeneration;
    target: DensityTarget;
    targetDimensions: { w: number; h: number };
    sourceContext: SourceContextDensity;
    upscale: FillUpscaleDependencies;
    seed?: number;
    cachedUpscale?: {
      nodeId: `node_${string}`;
      image: Image16;
      artifact: Awaited<ReturnType<typeof publishArtifact>>;
      provider: ExternalExecutionProvenance;
    };
  },
) {
  const { generation } = input;
  const nodes = [...generation.nodes];
  const artifacts = [...generation.artifacts];
  const executions = [...generation.executions];
  const warnings: Warning[] = [
    ...generation.warnings,
    ...(input.sourceContext.resolutionLimited
      ? [
          {
            code: "source_resolution_limited" as const,
            message: `Generation used resolution-limited ${input.sourceContext.tier} source pixels`,
          },
        ]
      : []),
    ...input.upscale.policy.upscale.warnings,
  ];
  let output: NodeReference = generation.reference;
  let outputImage = generation.image;
  let upscaleNodeId: `node_${string}` | null = null;
  let upscaleExecuted = false;
  let densitySatisfied =
    generation.returnedDimensions.w >= input.targetDimensions.w &&
    generation.returnedDimensions.h >= input.targetDimensions.h;
  let upscaleProvider: ExternalExecutionProvenance | undefined;
  const densityPlan = input.upscale.adapter
    ? planOutputDensity({
        target: input.target,
        generated: {
          id: generation.artifact.artifactHash,
          dimensions: generation.returnedDimensions,
        },
        cachedUpscales: input.cachedUpscale
          ? [
              {
                id: input.cachedUpscale.artifact.artifactHash,
                sourceArtifactId: generation.artifact.artifactHash,
                dimensions: { w: input.cachedUpscale.image.w, h: input.cachedUpscale.image.h },
              },
            ]
          : [],
        supportedScales: input.upscale.adapter.supportedScales,
        limits: input.upscale.adapter.limits,
        sourceContext: input.sourceContext,
      })
    : undefined;
  if (densityPlan && input.upscale.policy.upscale.action === "upscale")
    appendWarnings(warnings, densityPlan.upscale.warnings);
  const upscaleOperation = densityPlan?.upscale.operations.find(
    (
      operation,
    ): operation is Extract<(typeof densityPlan.upscale.operations)[number], { kind: "upscale" }> =>
      operation.kind === "upscale",
  );
  if (
    input.upscale.policy.upscale.action === "upscale" &&
    input.cachedUpscale &&
    densityPlan?.upscale.inputArtifactId === input.cachedUpscale.artifact.artifactHash
  ) {
    output = { nodeId: input.cachedUpscale.nodeId };
    outputImage = input.cachedUpscale.image;
    upscaleNodeId = input.cachedUpscale.nodeId;
    upscaleProvider = input.cachedUpscale.provider;
    densitySatisfied = densityPlan.upscale.densitySatisfied;
  }
  if (
    input.upscale.policy.upscale.action === "upscale" &&
    input.upscale.adapter &&
    upscaleOperation
  ) {
    const executionId = newExecutionId();
    const result = await input.upscale.adapter.execute({
      artifact: {
        bytes: await image16Png(generation.image),
        mediaType: "image/png",
        hash: generation.artifact.artifactHash,
        dimensions: generation.returnedDimensions,
      },
      scale: upscaleOperation.scale,
      prompt: input.upscale.prompt.derived,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
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
        const parameters = {
          adapter: input.upscale.adapter.id,
          adapter_version: input.upscale.adapter.version,
          model: input.upscale.policy.upscale.model,
          model_version: result.value.provenance.modelVersion,
          scale: upscaleOperation.scale,
          controls: {
            prompt_id: input.upscale.prompt.id,
            prompt_version: input.upscale.prompt.version,
            original_prompt: input.upscale.prompt.original,
            derived_prompt: input.upscale.prompt.derived,
          },
          request: { execution_id: executionId },
        };
        const recipe = recipeHash(
          canonicalNodeRecipe({
            kind: "upscale",
            recipeVersion: 1,
            parameters,
            inputNodeIds: [generation.nodeId],
          }),
        );
        upscaleNodeId = logicalNodeId(recipe) as `node_${string}`;
        upscaleProvider = {
          adapter: result.value.provenance.adapter,
          adapterVersion: result.value.provenance.adapterVersion,
          service: result.value.provenance.service,
          model: result.value.provenance.model,
          modelVersion: result.value.provenance.modelVersion,
          providerRequestId: result.value.provenance.requestId,
          seed: result.value.provenance.seed,
          durationMs: result.value.provenance.durationMs,
          costUsd: result.value.provenance.costUsd,
          inputPx: generation.image.w * generation.image.h,
          targetPx: input.targetDimensions.w * input.targetDimensions.h,
          attempt: 1,
          densityVerdict: result.densitySatisfied ? "satisfied" : "limited",
          warnings: result.warnings,
        };
        nodes.push({
          localKey: "upscale",
          kind: "upscale",
          recipeVersion: 1,
          parameters,
          inputs: [generation.reference],
        });
        artifacts.push(artifact);
        executions.push({
          node: { localKey: "upscale" },
          executionId,
          evaluationHash: evaluationHash({
            nodeRecipeHash: recipe,
            kind: "upscale",
            recipeVersion: 1,
            inputArtifactHashes: [generation.artifact.artifactHash],
          }),
          outputArtifactHash: artifact.artifactHash,
          inputArtifactHashes: [generation.artifact.artifactHash],
          provider: upscaleProvider,
        });
        output = { localKey: "upscale" };
        outputImage = image;
        upscaleExecuted = true;
        densitySatisfied =
          result.samplingDimensions.w >= input.targetDimensions.w &&
          result.samplingDimensions.h >= input.targetDimensions.h;
      } catch (error) {
        appendWarnings(warnings, [
          {
            code: "upscale_failed",
            message: error instanceof Error ? error.message : "Upscaler returned unreadable pixels",
          },
        ]);
        densitySatisfied = false;
      }
    } else densitySatisfied = false;
  } else if (densityPlan && input.upscale.policy.upscale.action === "upscale") {
    densitySatisfied = densityPlan.upscale.densitySatisfied;
  }
  return {
    nodes,
    artifacts,
    executions,
    warnings,
    output,
    outputImage,
    upscale: {
      enabled: input.upscale.policy.upscale.enabled,
      executed: upscaleNodeId !== null,
      nodeId: upscaleNodeId,
      adapter: upscaleNodeId
        ? (upscaleProvider?.adapter ?? input.upscale.adapter?.id ?? null)
        : null,
      model: input.upscale.policy.upscale.model,
      input: generation.returnedDimensions,
      target: input.targetDimensions,
      generated: { w: outputImage.w, h: outputImage.h },
      final: input.targetDimensions,
      densitySatisfied,
      warnings: warnings.filter(({ code }) => code.startsWith("upscale_")),
      provider: upscaleProvider,
      executedNow: upscaleExecuted,
    },
  };
}

export function appendWarnings(target: Warning[], additions: readonly Warning[]): void {
  for (const warning of additions)
    if (!target.some(({ code, message }) => code === warning.code && message === warning.message))
      target.push(warning);
}
