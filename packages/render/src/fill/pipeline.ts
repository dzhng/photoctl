import { PhotoctlError, type Warning } from "@photoctl/protocol";
import {
  normalizeArtifact,
  publishArtifact,
  readArtifactImage,
  readArtifactMask,
} from "../artifacts/publication.js";
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
import type { ExternalExecutionProvenance } from "../graph/types.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import type { Image16 } from "../source-render.js";
import { planFillCrop } from "./crop.js";
import { planOutputDensity, type SourceContextDensity } from "./density.js";
import { strictEffectiveMask } from "./fit.js";
import { findReusableFillLineage } from "./reuse.js";
import type { ResolvedUpscalePolicy } from "./upscale-policy.js";
import {
  cropImagePng,
  cropMappedExternalImage,
  cropMaskPng,
  decodeExternalImage,
  image16Png,
} from "./external-pixels.js";

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
  if (selected.role === "vacancy") throw new Error("A vacancy layer cannot be filled directly");

  const baseEvaluation = await evaluateGraphNode({
    database,
    libraryPath,
    photoId: request.photoId,
    nodeId: selected.contentNodeId,
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
  const reusable = await findReusableFillLineage(database, libraryPath, request, selected, crop, {
    w: base.w,
    h: base.h,
  });
  const strictBaseNodeId = reusable?.baseNodeId ?? selected.contentNodeId;
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
  } else {
    const cropPng = await cropImagePng(base, crop);
    const maskPng = await cropMaskPng(mask, crop);
    const executionId = newExecutionId();
    const form = request.dependencies.adapter.buildEdit(
      request.operation,
      { png: cropPng, w: crop.w, h: crop.h },
      maskPng,
      request.prompt,
      request.seed,
    );
    const started = (request.dependencies.now ?? Date.now)();
    const response = await request.dependencies.gateway.imageEdits(form);
    const responseImage = await request.dependencies.adapter.normalize(response.data, {
      w: crop.w,
      h: crop.h,
    });
    if (responseImage.wholeFrame) {
      throw new PhotoctlError(
        "provider_whole_frame",
        "Strict fill refused a provider result that edited the whole frame",
        { id: request.photoId, layer: layerId },
      );
    }
    normalized = responseImage;
    generated = await decodeExternalImage(normalized.png, normalized.returnedDimensions);
    generatedPublished = await publishArtifact(libraryPath, await normalizeArtifact(generated));
    const generationParameters = {
      adapter: request.dependencies.adapter.id,
      adapter_version: request.dependencies.adapter.version,
      model: request.dependencies.model,
      model_version: null,
      prompt: request.prompt,
      prompt_version: request.promptVersion,
      request: {
        execution_id: executionId,
        operation: request.operation,
        crop: [crop.x, crop.y, crop.w, crop.h],
        returned: [normalized.returnedDimensions.w, normalized.returnedDimensions.h],
        source_context: {
          tier: request.sourceContext.tier,
          pixel_scale: request.sourceContext.pixelScale,
          resolution_limited: request.sourceContext.resolutionLimited,
        },
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      },
    };
    const generationRecipe = recipeHash(
      canonicalNodeRecipe({
        kind: "generate",
        recipeVersion: 1,
        parameters: generationParameters,
        inputNodeIds: [selected.contentNodeId],
      }),
    );
    generationNodeId = logicalNodeId(generationRecipe) as `node_${string}`;
    provider = {
      adapter: request.dependencies.adapter.id,
      adapterVersion: request.dependencies.adapter.version,
      service: request.dependencies.service ?? "gateway",
      model: request.dependencies.model,
      modelVersion: null,
      providerRequestId: response.requestId,
      seed: request.seed ?? null,
      durationMs: Math.max(0, (request.dependencies.now ?? Date.now)() - started),
      costUsd: 0,
      inputPx: crop.w * crop.h,
      targetPx: crop.w * crop.h,
      attempt: response.attempts,
      densityVerdict: "not-applicable",
      warnings: normalized.warnings,
    };
    generationDraft = {
      localKey: "generation",
      kind: "generate",
      recipeVersion: 1,
      parameters: generationParameters,
      inputs: [{ nodeId: selected.contentNodeId }],
    };
    generationExecution = {
      node: { localKey: "generation" },
      executionId,
      evaluationHash: evaluationHash({
        nodeRecipeHash: generationRecipe,
        kind: "generate",
        recipeVersion: 1,
        inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
      }),
      outputArtifactHash: generatedPublished.artifactHash,
      inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
      provider,
    };
  }
  const warnings = [
    ...normalized.warnings,
    ...(sourceContext.resolutionLimited
      ? [
          {
            code: "source_resolution_limited" as const,
            message: `Generation used resolution-limited ${sourceContext.tier} source pixels`,
          },
        ]
      : []),
    ...request.upscale.policy.upscale.warnings,
  ];
  const generationReference: NodeReference = generationDraft
    ? { localKey: "generation" }
    : { nodeId: generationNodeId };
  const nodes: NodeDraft[] = generationDraft ? [generationDraft] : [];
  const artifacts = generationDraft ? [generatedPublished] : [];
  const executions: import("../graph/store.js").PreparedNodeExecution[] = generationExecution
    ? [generationExecution]
    : [];
  let placementInput: NodeReference = generationReference;
  let upscaleNodeId: `node_${string}` | null = null;
  let upscaleExecuted = false;
  let upscaleGenerated = { ...normalized.returnedDimensions };
  let densitySatisfied =
    normalized.returnedDimensions.w >= crop.w && normalized.returnedDimensions.h >= crop.h;
  let upscaleProvider: ExternalExecutionProvenance | undefined;
  const cachedUpscale = reusable?.cachedUpscale;
  const densityPlan = request.upscale.adapter
    ? planOutputDensity({
        target: {
          kind: "base_space_provider_crop",
          dimensionsIncludingPad: { w: crop.w, h: crop.h },
        },
        generated: {
          id: generatedPublished.artifactHash,
          dimensions: { ...normalized.returnedDimensions },
        },
        cachedUpscales: cachedUpscale
          ? [
              {
                id: cachedUpscale.artifact.artifactHash,
                sourceArtifactId: generatedPublished.artifactHash,
                dimensions: { w: cachedUpscale.image.w, h: cachedUpscale.image.h },
              },
            ]
          : [],
        supportedScales: request.upscale.adapter.supportedScales,
        limits: request.upscale.adapter.limits,
        sourceContext,
      })
    : undefined;
  if (densityPlan && request.upscale.policy.upscale.action === "upscale") {
    appendWarnings(warnings, densityPlan.upscale.warnings);
  }
  const upscaleOperation = densityPlan?.upscale.operations.find(
    (
      operation,
    ): operation is Extract<(typeof densityPlan.upscale.operations)[number], { kind: "upscale" }> =>
      operation.kind === "upscale",
  );
  if (
    request.upscale.policy.upscale.action === "upscale" &&
    cachedUpscale &&
    densityPlan?.upscale.inputArtifactId === cachedUpscale.artifact.artifactHash
  ) {
    placementInput = { nodeId: cachedUpscale.nodeId };
    upscaleNodeId = cachedUpscale.nodeId;
    upscaleGenerated = { w: cachedUpscale.image.w, h: cachedUpscale.image.h };
    upscaleProvider = cachedUpscale.provider;
    densitySatisfied = densityPlan.upscale.densitySatisfied;
  }
  if (
    request.upscale.policy.upscale.action === "upscale" &&
    request.upscale.adapter &&
    upscaleOperation
  ) {
    const upscaleExecutionId = newExecutionId();
    const upscaleResult = await request.upscale.adapter.execute({
      artifact: {
        bytes: await image16Png(generated),
        mediaType: "image/png",
        hash: generatedPublished.artifactHash,
        dimensions: { ...normalized.returnedDimensions },
      },
      scale: upscaleOperation.scale,
      prompt: request.upscale.prompt.derived,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
    });
    appendWarnings(warnings, upscaleResult.warnings);
    if (upscaleResult.ok) {
      let upscaledImage: Image16 | undefined;
      let normalizedUpscale: Awaited<ReturnType<typeof normalizeArtifact>> | undefined;
      try {
        const mappedBytes = upscaleResult.value.frameMapping
          ? await cropMappedExternalImage(
              upscaleResult.value.artifact.bytes,
              upscaleResult.value.frameMapping.output,
            )
          : upscaleResult.value.artifact.bytes;
        upscaledImage = await decodeExternalImage(mappedBytes, upscaleResult.samplingDimensions);
        normalizedUpscale = await normalizeArtifact(upscaledImage);
      } catch (error) {
        appendWarnings(warnings, [
          {
            code: "upscale_failed",
            message: error instanceof Error ? error.message : "Upscaler returned unreadable pixels",
          },
        ]);
        densitySatisfied = false;
      }
      if (upscaledImage && normalizedUpscale) {
        const upscaledPublished = await publishArtifact(libraryPath, normalizedUpscale);
        const upscaleParameters = {
          adapter: request.upscale.adapter.id,
          adapter_version: request.upscale.adapter.version,
          model: request.upscale.policy.upscale.model,
          model_version: upscaleResult.value.provenance.modelVersion,
          scale: upscaleOperation.scale,
          controls: {
            prompt_id: request.upscale.prompt.id,
            prompt_version: request.upscale.prompt.version,
            original_prompt: request.upscale.prompt.original,
            derived_prompt: request.upscale.prompt.derived,
          },
          request: { execution_id: upscaleExecutionId },
        };
        const upscaleRecipe = recipeHash(
          canonicalNodeRecipe({
            kind: "upscale",
            recipeVersion: 1,
            parameters: upscaleParameters,
            inputNodeIds: [generationNodeId],
          }),
        );
        upscaleNodeId = logicalNodeId(upscaleRecipe) as `node_${string}`;
        nodes.push({
          localKey: "upscale",
          kind: "upscale",
          recipeVersion: 1,
          parameters: upscaleParameters,
          inputs: [generationReference],
        });
        artifacts.push(upscaledPublished);
        upscaleProvider = {
          adapter: upscaleResult.value.provenance.adapter,
          adapterVersion: upscaleResult.value.provenance.adapterVersion,
          service: upscaleResult.value.provenance.service,
          model: upscaleResult.value.provenance.model,
          modelVersion: upscaleResult.value.provenance.modelVersion,
          providerRequestId: upscaleResult.value.provenance.requestId,
          seed: upscaleResult.value.provenance.seed,
          durationMs: upscaleResult.value.provenance.durationMs,
          costUsd: upscaleResult.value.provenance.costUsd,
          inputPx: generated.w * generated.h,
          targetPx: crop.w * crop.h,
          attempt: 1,
          densityVerdict: upscaleResult.densitySatisfied ? "satisfied" : "limited",
          warnings: upscaleResult.warnings,
        };
        executions.push({
          node: { localKey: "upscale" },
          executionId: upscaleExecutionId,
          evaluationHash: evaluationHash({
            nodeRecipeHash: upscaleRecipe,
            kind: "upscale",
            recipeVersion: 1,
            inputArtifactHashes: [generatedPublished.artifactHash],
          }),
          outputArtifactHash: upscaledPublished.artifactHash,
          inputArtifactHashes: [generatedPublished.artifactHash],
          provider: upscaleProvider,
        });
        placementInput = { localKey: "upscale" };
        upscaleExecuted = true;
        upscaleGenerated = { ...upscaleResult.samplingDimensions };
        densitySatisfied =
          upscaleResult.samplingDimensions.w >= crop.w &&
          upscaleResult.samplingDimensions.h >= crop.h;
      }
    } else {
      densitySatisfied = false;
    }
  } else if (densityPlan && request.upscale.policy.upscale.action === "upscale") {
    densitySatisfied = densityPlan.upscale.densitySatisfied;
  }
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
      enabled: request.upscale.policy.upscale.enabled,
      executed: upscaleNodeId !== null,
      nodeId: upscaleNodeId,
      adapter: upscaleNodeId
        ? (upscaleProvider?.adapter ?? request.upscale.adapter?.id ?? null)
        : null,
      model: request.upscale.policy.upscale.model,
      input: { ...normalized.returnedDimensions },
      target: { w: crop.w, h: crop.h },
      generated: upscaleGenerated,
      final: { w: crop.w, h: crop.h },
      densitySatisfied,
      warnings: warnings.filter(({ code }) => code.startsWith("upscale_")),
    },
    executions: [
      { kind: "generate" as const, nodeId: generationNodeId, provider, reused: Boolean(reusable) },
      ...(upscaleProvider && upscaleNodeId
        ? [
            {
              kind: "upscale" as const,
              nodeId: upscaleNodeId,
              provider: upscaleProvider,
              reused: !upscaleExecuted,
            },
          ]
        : []),
    ],
    crop,
    warnings,
  };
}

function appendWarnings(target: Warning[], additions: readonly Warning[]): void {
  for (const warning of additions) {
    if (!target.some(({ code, message }) => code === warning.code && message === warning.message)) {
      target.push(warning);
    }
  }
}
