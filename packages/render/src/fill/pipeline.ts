import { PhotoctlError } from "@photoctl/protocol";
import type {
  ImageInit,
  ImageModelAdapter,
  SentImage,
  UpscaleExecutionAdapter,
} from "@photoctl/providers";
import { prepareReferenceArtifact } from "./reference.js";
import { readArtifactImage } from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { loadBaseProjection } from "../graph/projection.js";
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
} from "../graph/store.js";
import type { JsonValue } from "../graph/types.js";
import { resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { unfilledVacancyLayerIds } from "../layers/status.js";
import { planFillCrop } from "./crop.js";
import type { SourceContextDensity } from "./density.js";
import { resolveFillFit } from "./fit.js";
import type { FillFit } from "../mask-operations.js";
import { prepareFillMask } from "./mask.js";
import { findReusableFillLineage } from "./reuse.js";
import { describeFillBranch } from "./branch.js";
import type { ResolvedUpscalePolicy } from "./upscale-policy.js";
import { fillProviderInputs } from "./external-pixels.js";
import {
  executeFreshGeneration,
  executeGenerationDensity,
  type PreparedGeneration,
} from "./generation.js";

export interface FillGenerationDependencies {
  adapter: Pick<
    ImageModelAdapter,
    "id" | "version" | "buildEdit" | "buildFullFrameEdit" | "normalize"
  >;
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
  adapter?: UpscaleExecutionAdapter;
}

export async function fillLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: {
    photoId: string;
    layer: string;
    prompt: string;
    promptVersion: number;
    operation: "remove" | "prompt";
    fit?: FillFit;
    pad?: number;
    fullResolution?: boolean;
    init?: ImageInit;
    referenceImage?: SentImage;
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
  if (
    (await describeFillBranch(database, request.photoId, selected.contentNodeId))?.composite
      .recipeVersion === 2
  ) {
    throw new PhotoctlError("usage", "Outpaint layer retry is not yet supported");
  }
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
  const base = await readArtifactImage(
    baseEvaluation.artifact.path,
    baseEvaluation.artifact.artifactHash,
  );
  const fit = request.fit ?? resolveFillFit(request.operation);
  const projection = await loadBaseProjection(database, request.photoId, baseEvaluation);
  const baseToInput = projection.baseToRaster;
  const effective = await prepareFillMask(database, libraryPath, request, selected, fit, {
    matrix: [...baseToInput],
    w: base.w,
    h: base.h,
  });
  const mask = effective.mask;
  if (!mask.data.some((value) => value > 0))
    throw new PhotoctlError("usage", "The effective selection is not visible in the current frame");
  const crop = planFillCrop(mask, request.pad);
  const reference = request.referenceImage
    ? await prepareReferenceArtifact(libraryPath, request.referenceImage)
    : undefined;
  const reusable = fillingVacancy
    ? undefined
    : await findReusableFillLineage(
        database,
        libraryPath,
        {
          ...request,
          effectiveMaskNodeId: effective.effectiveNodeId,
          referenceEncodedArtifactHash: reference?.encodedArtifact.artifactHash,
        },
        selected,
        crop,
        {
          w: mask.w,
          h: mask.h,
        },
      );
  const strictBaseNodeId = reusable?.baseNodeId ?? fillBaseNodeId;
  const { generation, density, sourceContext } = await prepareFillGeneration(
    database,
    libraryPath,
    request,
    {
      base,
      mask,
      crop,
      fit,
      baseToInput,
      inputNodeId: fillBaseNodeId,
      inputArtifactHash: baseEvaluation.artifact.artifactHash,
      layerId,
      reusable,
      reference,
    },
  );
  const { nodeId: generationNodeId, provider } = generation;
  const { nodes, artifacts, executions, warnings } = density;
  if (effective.clippedPixels > 0)
    warnings.push({
      code: "mask_clipped",
      message:
        "Fill coverage was clipped to the current visible frame; the original selection is unchanged",
    });
  const placementInput = density.output;
  nodes.push(
    ...effective.nodes,
    {
      localKey: "fill-support",
      kind: "mask",
      recipeVersion: 2,
      parameters: { operation: "support" },
      inputs: [{ localKey: "effective-mask" }],
    },
    {
      localKey: "resample",
      kind: "resample",
      recipeVersion: 1,
      parameters: {
        w: mask.w,
        h: mask.h,
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
        { localKey: "effective-mask" },
      ],
    },
  );
  const layers: RevisionLayerDraft[] = document.layers.map((layer) => ({
    layer: { layerId: layer.id },
    name: layer.name,
    z: layer.z,
    contentNode:
      layer.id === selected.id ? { localKey: "strict-composite" } : { nodeId: layer.contentNodeId },
    maskNode:
      layer.id === selected.id ? { localKey: "fill-support" } : { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  }));
  const committed = await commitRevision(database, {
    outputPlan: "photographic",
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    artifacts,
    executions,
    nodes,
    rootUpdates: [],
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
    returnedDimensions: generation.returnedDimensions,
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

/** Paid image preparation is shared by selected fills and new canvas borders. */
export async function prepareFillGeneration(
  database: GraphDatabase,
  libraryPath: string,
  request: Omit<Parameters<typeof fillLayer>[2], "layer">,
  plan: {
    base: import("../source-render.js").Image16;
    mask: import("../mask-tiff.js").MaskImage;
    crop: { x: number; y: number; w: number; h: number };
    fit: FillFit;
    baseToInput?: import("../transforms.js").TransformMatrix;
    inputNodeId: string;
    inputReference?: import("../graph/store.js").NodeReference;
    inputArtifactHash: `a_${string}`;
    layerId?: string;
    reusable?: Awaited<ReturnType<typeof findReusableFillLineage>>;
    reference?: Awaited<ReturnType<typeof prepareReferenceArtifact>>;
    intent?: Record<string, JsonValue>;
  },
) {
  const {
    base,
    mask,
    crop,
    fit,
    baseToInput,
    inputNodeId,
    inputArtifactHash,
    layerId,
    reusable,
    reference,
    intent,
  } = plan;
  const sourceContext = reusable?.sourceContext ?? request.sourceContext;
  let generation: PreparedGeneration;
  if (reusable) {
    generation = {
      nodeId: reusable.nodeId,
      reference: { nodeId: reusable.nodeId },
      provider: reusable.provider,
      image: reusable.image,
      artifact: reusable.artifact,
      returnedDimensions: { w: reusable.image.w, h: reusable.image.h },
      warnings: [...reusable.provider.warnings],
      nodes: [],
      artifacts: [],
      executions: [],
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
      const generationDraft: NodeDraft = {
        localKey: "generation",
        kind: "generate",
        recipeVersion: reusable.generationRecipe.recipeVersion,
        parameters,
        inputs: reusable.generationRecipe.inputNodeIds.map((nodeId) => ({ nodeId })),
      };
      const recipe = recipeHash(
        canonicalNodeRecipe({
          kind: "generate",
          recipeVersion: generationDraft.recipeVersion,
          parameters,
          inputNodeIds: reusable.generationRecipe.inputNodeIds,
        }),
      );
      generation.nodeId = logicalNodeId(recipe) as `node_${string}`;
      generation.reference = { localKey: "generation" };
      generation.nodes = [generationDraft];
      generation.artifacts = [reusable.artifact];
      generation.executions = [
        {
          node: { localKey: "generation" },
          ...(reusable.generationRecipe.providerImageAttemptId
            ? { providerImageAttemptId: reusable.generationRecipe.providerImageAttemptId }
            : {}),
          executionId,
          evaluationHash: evaluationHash({
            nodeRecipeHash: recipe,
            kind: "generate",
            recipeVersion: generationDraft.recipeVersion,
            inputArtifactHashes: reusable.generationRecipe.inputArtifactHashes,
          }),
          outputArtifactHash: reusable.artifact.artifactHash,
          inputArtifactHashes: reusable.generationRecipe.inputArtifactHashes,
          provider: reusable.provider,
        },
      ];
    }
  } else {
    const sent = await fillProviderInputs(base, mask, crop, request.fullResolution, baseToInput);
    generation = await executeFreshGeneration(database, libraryPath, {
      inputNodeId: inputNodeId,
      inputReference: plan.inputReference,
      inputArtifactHash,
      ...(reference ? { reference } : {}),
      requestedInit: request.init,
      sentDimensions: sent.image,
      prompt: request.prompt,
      promptVersion: request.promptVersion,
      ...(request.seed === undefined ? {} : { seed: request.seed }),
      dependencies: request.dependencies,
      buildRequest: () =>
        request.dependencies.adapter.buildEdit(
          request.operation,
          sent.image,
          sent.mask,
          request.prompt,
          request.seed,
          {
            init: request.init,
            ...(request.referenceImage ? { reference: request.referenceImage } : {}),
          },
        ),
      validate: ({ wholeFrame }) => {
        if (wholeFrame && fit.mode === "strict")
          throw new PhotoctlError(
            "provider_whole_frame",
            "Strict fill refused a provider result that edited the whole frame",
            { id: request.photoId, layer: layerId },
          );
      },
      request: (executionId, returned) => ({
        execution_id: executionId,
        operation: request.operation,
        fit,
        crop: [crop.x, crop.y, crop.w, crop.h],
        sent: [sent.image.w, sent.image.h],
        full_res: request.fullResolution ?? false,
        pad: request.pad ?? 64,
        sampling: {
          base_to_input: [...(baseToInput ?? [1, 0, 0, 1, 0, 0])],
          input_dimensions: [base.w, base.h],
          outside_visible: "black-protected",
        },
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
        ...intent,
      }),
      targetPixels: crop.w * crop.h,
    });
  }
  const cachedUpscale = reusable?.cachedUpscale;
  const density = await executeGenerationDensity(database, libraryPath, {
    generation,
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
  return { generation, density, sourceContext };
}
