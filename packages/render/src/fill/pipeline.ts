import { PhotoctlError, type Warning } from "@photoctl/protocol";
import { publishArtifact, readArtifactImage, readArtifactMask } from "../artifacts/publication.js";
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
} from "../graph/store.js";
import type { ExternalExecutionProvenance, JsonValue } from "../graph/types.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { unfilledVacancyLayerIds } from "../layers/status.js";
import type { Image16 } from "../source-render.js";
import { planFillCrop } from "./crop.js";
import type { SourceContextDensity } from "./density.js";
import { strictEffectiveMask } from "./fit.js";
import { findReusableFillLineage } from "./reuse.js";
import type { ResolvedUpscalePolicy } from "./upscale-policy.js";
import { cropImagePng, cropMaskPng, image16Png } from "./external-pixels.js";
import {
  executeFreshGeneration,
  executeGenerationDensity,
  type PreparedGeneration,
} from "./generation.js";

export interface FillGenerationDependencies {
  adapter: {
    readonly id: string;
    readonly version: string | null;
    buildEdit(
      operation: string,
      crop: { png: Buffer; w: number; h: number },
      mask: Buffer,
      prompt: string,
      seed?: number,
    ): FormData;
    buildFullFrameEdit(
      crop: { png: Buffer; w: number; h: number },
      prompt: string,
      seed?: number,
    ): FormData;
    normalize(
      response: unknown,
      sentDimensions: { w: number; h: number },
    ): Promise<{
      png: Buffer;
      returnedDimensions: { w: number; h: number };
      wholeFrame: boolean;
      warnings: Array<{ code: import("@photoctl/protocol").WarningCode; message: string }>;
    }>;
  };
  gateway: {
    imageEdits(body: FormData): Promise<{
      data: unknown;
      requestId: string | null;
      attempts: number;
    }>;
  };
  model: string;
  service?: string;
  now?: () => number;
}

export interface FillUpscaleDependencies {
  policy: ResolvedUpscalePolicy;
  prompt: { id: string; version: number; original: string; derived: string };
  adapter?: {
    readonly id: string;
    readonly version: string | null;
    readonly supportedScales: readonly number[];
    readonly limits: {
      maxInputPixels: number;
      maxOutputPixels: number;
      maxOutputEdge: number;
    };
    execute(input: {
      artifact: {
        bytes: Buffer;
        mediaType: "image/png";
        hash: `a_${string}`;
        dimensions: { w: number; h: number };
      };
      scale: number;
      prompt: string;
      seed?: number;
    }): Promise<
      | {
          ok: true;
          value: {
            artifact: { bytes: Buffer; dimensions: { w: number; h: number } };
            dimensions: { w: number; h: number };
            frameMapping?: {
              source: [number, number, number, number];
              output: [number, number, number, number];
            };
            provenance: {
              adapter: string;
              adapterVersion: string | null;
              service: string;
              model: string;
              modelVersion: string | null;
              requestId: string | null;
              seed: number | null;
              durationMs: number;
              costUsd: number;
            };
          };
          samplingDimensions: { w: number; h: number };
          densitySatisfied: boolean;
          warnings: Warning[];
        }
      | { ok: false; code: "upscale_failed"; message: string; warnings: Warning[] }
    >;
  };
}

export async function fillLayerStrict(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    layer: string;
    prompt: string;
    promptVersion: number;
    operation: "remove" | "prompt";
    pad?: number;
    seed?: number;
    source: EvaluateGraphNodeRequest["source"];
    dependencies: FillGenerationDependencies;
    sourceContext: SourceContextDensity;
    upscale: FillUpscaleDependencies;
  },
) {
  const document = await loadActiveDocument(database, request.photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  const unfilledVacancies = await unfilledVacancyLayerIds(database, request.photoId, [selected]);
  const fillingVacancy = unfilledVacancies.has(selected.id);
  if (selected.role === "vacancy" && (!selected.enabled || !fillingVacancy)) {
    throw new Error("Only an enabled unfilled vacancy layer can be filled directly");
  }
  const fillBaseNodeId = fillingVacancy ? document.roots.base : selected.contentNodeId;

  const baseEvaluation = await evaluateGraphNode({
    database,
    libraryPath,
    photoId: request.photoId,
    nodeId: fillBaseNodeId,
    source: request.source,
  });
  const maskEvaluation = await evaluateGraphNode({
    database,
    libraryPath,
    photoId: request.photoId,
    nodeId: selected.maskNodeId,
    source: request.source,
  });
  const base = await readArtifactImage(
    baseEvaluation.artifact.path,
    baseEvaluation.artifact.artifactHash,
  );
  const mask = strictEffectiveMask(
    await readArtifactMask(maskEvaluation.artifact.path, maskEvaluation.artifact.artifactHash),
  );
  if (base.w !== mask.w || base.h !== mask.h) throw new Error("Fill content and mask disagree");
  const crop = planFillCrop(mask, request.pad);
  const reusable = fillingVacancy
    ? undefined
    : await findReusableFillLineage(database, libraryPath, request, selected, crop, {
        w: base.w,
        h: base.h,
      });
  const strictBaseNodeId = reusable?.baseNodeId ?? fillBaseNodeId;
  const sourceContext = reusable?.sourceContext ?? request.sourceContext;
  let generationNodeId: `node_${string}`;
  let provider: ExternalExecutionProvenance;
  let normalized: {
    png: Buffer;
    returnedDimensions: { w: number; h: number };
    warnings: Warning[];
  };
  let generated: Image16;
  let generatedPublished: Awaited<ReturnType<typeof publishArtifact>>;
  let generationDraft: NodeDraft | undefined;
  let generationExecution: import("../graph/store.js").PreparedNodeExecution | undefined;
  if (reusable) {
    generationNodeId = reusable.nodeId;
    provider = reusable.provider;
    generated = reusable.image;
    generatedPublished = reusable.artifact;
    normalized = {
      png: await image16Png(generated),
      returnedDimensions: { w: generated.w, h: generated.h },
      warnings: [],
    };
    if (!reusable.generationRecipe.intentMatches) {
      const executionId = newExecutionId();
      const stored = reusable.generationRecipe.parameters;
      const storedRequest = stored.request as Record<string, JsonValue>;
      const parameters = {
        ...stored,
        request: {
          ...storedRequest,
          execution_id: executionId,
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
        },
      } as JsonValue;
      generationDraft = {
        localKey: "generation",
        kind: "generate",
        recipeVersion: reusable.generationRecipe.recipeVersion,
        parameters,
        inputs: [{ nodeId: reusable.generationRecipe.inputNodeId }],
      };
      const recipe = recipeHash(
        canonicalNodeRecipe({
          kind: "generate",
          recipeVersion: generationDraft.recipeVersion,
          parameters,
          inputNodeIds: [reusable.generationRecipe.inputNodeId],
        }),
      );
      generationNodeId = logicalNodeId(recipe) as `node_${string}`;
      generationExecution = {
        node: { localKey: "generation" },
        executionId,
        evaluationHash: evaluationHash({
          nodeRecipeHash: recipe,
          kind: "generate",
          recipeVersion: generationDraft.recipeVersion,
          inputArtifactHashes: reusable.generationRecipe.inputArtifactHashes,
        }),
        outputArtifactHash: reusable.artifact.artifactHash,
        inputArtifactHashes: reusable.generationRecipe.inputArtifactHashes,
        provider,
      };
    }
  } else {
    const cropPng = await cropImagePng(base, crop);
    const maskPng = await cropMaskPng(mask, crop);
    const prepared = await executeFreshGeneration(libraryPath, {
      inputNodeId: fillBaseNodeId,
      inputArtifactHash: baseEvaluation.artifact.artifactHash,
      sentDimensions: { w: crop.w, h: crop.h },
      prompt: request.prompt,
      promptVersion: request.promptVersion,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      dependencies: request.dependencies,
      buildRequest: () =>
        request.dependencies.adapter.buildEdit(
          request.operation,
          { png: cropPng, w: crop.w, h: crop.h },
          maskPng,
          request.prompt,
          request.seed,
        ),
      validate: ({ wholeFrame }) => {
        if (wholeFrame)
          throw new PhotoctlError(
            "provider_whole_frame",
            "Strict fill refused a provider result that edited the whole frame",
            { id: request.photoId, layer: layerId },
          );
      },
      request: (executionId, returned) => ({
        execution_id: executionId,
        operation: request.operation,
        crop: [crop.x, crop.y, crop.w, crop.h],
        returned: [returned.w, returned.h],
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
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      }),
      targetPixels: crop.w * crop.h,
    });
    generationNodeId = prepared.nodeId;
    provider = prepared.provider;
    generated = prepared.image;
    generatedPublished = prepared.artifact;
    normalized = {
      png: await image16Png(prepared.image),
      returnedDimensions: prepared.returnedDimensions,
      warnings: prepared.warnings,
    };
    generationDraft = prepared.nodes[0];
    generationExecution = prepared.executions[0];
  }
  const generationReference: NodeReference = generationDraft
    ? { localKey: "generation" }
    : { nodeId: generationNodeId };
  const cachedUpscale = reusable?.cachedUpscale;
  const density = await executeGenerationDensity(libraryPath, {
    generation: {
      nodeId: generationNodeId,
      reference: generationReference,
      provider,
      image: generated,
      artifact: generatedPublished,
      returnedDimensions: normalized.returnedDimensions,
      warnings: normalized.warnings,
      nodes: generationDraft ? [generationDraft] : [],
      artifacts: generationDraft ? [generatedPublished] : [],
      executions: generationExecution ? [generationExecution] : [],
    } satisfies PreparedGeneration,
    target: {
      kind: "base_space_provider_crop",
      dimensionsIncludingPad: { w: crop.w, h: crop.h },
    },
    targetDimensions: { w: crop.w, h: crop.h },
    sourceContext,
    upscale: request.upscale,
    ...(request.seed === undefined ? {} : { seed: request.seed }),
    ...(cachedUpscale ? { cachedUpscale } : {}),
  });
  const { nodes, artifacts, executions, warnings } = density;
  const placementInput = density.output;
  nodes.push(
    {
      localKey: "resample",
      kind: "resample",
      recipeVersion: 1,
      parameters: {
        w: base.w,
        h: base.h,
        kernel: "lanczos3",
        target: { x: crop.x, y: crop.y, w: crop.w, h: crop.h },
      },
      inputs: [placementInput],
    },
    {
      localKey: "strict-composite",
      kind: "mask_composite",
      recipeVersion: 1,
      parameters: { feather: 0 },
      inputs: [
        { nodeId: strictBaseNodeId },
        { localKey: "resample" },
        { nodeId: selected.maskNodeId },
      ],
    },
  );
  const layers: RevisionLayerDraft[] = document.layers.map((layer) => ({
    layer: { layerId: layer.id },
    name: layer.name,
    z: layer.z,
    contentNode:
      layer.id === selected.id ? { localKey: "strict-composite" } : { nodeId: layer.contentNodeId },
    maskNode: { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  }));
  const output = compositeV2Projection({ nodeId: document.roots.base }, layers);
  nodes.push({ localKey: "document-composite", kind: "composite", recipeVersion: 2, ...output });
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    artifacts,
    executions,
    nodes,
    rootUpdates: [{ root: "output", node: { localKey: "document-composite" } }],
    layers,
  });
  if (!committed.renderHash) throw new Error("A fill revision must have a render hash");
  return {
    revisionId: committed.revisionId,
    layerId,
    outputNodeId: committed.roots.output! as `node_${string}`,
    renderHash: committed.renderHash as `r_${string}`,
    generationNodeId: generationNodeId as `node_${string}`,
    compositeNodeId: committed.nodes["strict-composite"]!.id as `node_${string}`,
    returnedDimensions: normalized.returnedDimensions,
    sourceContext,
    upscale: {
      enabled: density.upscale.enabled,
      executed: density.upscale.executed,
      nodeId: density.upscale.nodeId,
      adapter: density.upscale.adapter,
      model: density.upscale.model,
      input: density.upscale.input,
      target: density.upscale.target,
      generated: density.upscale.generated,
      final: density.upscale.final,
      densitySatisfied: density.upscale.densitySatisfied,
      warnings: density.upscale.warnings,
    },
    executions: [
      { kind: "generate" as const, nodeId: generationNodeId, provider, reused: Boolean(reusable) },
      ...(density.upscale.provider && density.upscale.nodeId
        ? [
            {
              kind: "upscale" as const,
              nodeId: density.upscale.nodeId,
              provider: density.upscale.provider,
              reused: !density.upscale.executedNow,
            },
          ]
        : []),
    ],
    crop,
    warnings,
  };
}
