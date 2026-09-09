import { PhotoctlError, type Warning } from "@photoctl/protocol";
import {
  runProviderImageAttempt,
  imageAttemptRequestDetails,
} from "../provider-images/attempts.js";
import { executeRetainedUpscale } from "../provider-images/upscale.js";
import { transformMaskPixels } from "@photoctl/img";
import {
  normalizeArtifact,
  publishArtifact,
  readArtifactImage,
  readArtifactMask,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { loadBaseProjection } from "../graph/projection.js";
import { planPhotographicOutput } from "../graph/output.js";
import { parseRenderFrame } from "../graph/frame.js";
import { prepareOutpaintPixels } from "./outpaint.js";
import {
  composeTransformMatrices,
  invertTransformMatrix,
  isIdentityMatrix,
} from "../transforms.js";
import { prepareFillMask } from "./mask.js";
import { readReferenceArtifact } from "./reference.js";
import { planRefreshedFillCrop } from "./crop.js";
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
  publishDeterministicGraph,
  type NodeReference,
  type PreparedNodeExecution,
} from "../graph/store.js";
import type { ExternalExecutionProvenance, JsonValue } from "../graph/types.js";
import { layerDraft, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { describeFillBranch, type FillBranchDescriptor } from "./branch.js";
import { fillProviderInputs, decodeExternalImage, image16Png } from "./external-pixels.js";
import { normalizeGeneratedImage } from "../provider-images/normalization.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./pipeline.js";
import { rebuildFillBranch } from "./rebuild.js";
import { fillPlacementDimensions, planOutputDensity } from "./density.js";
import { appendWarnings, executeGenerationDensity } from "./generation.js";
import { resolveUpscalePolicy } from "./upscale-policy.js";

export interface RefreshFillRequest {
  photoId: string;
  layer: string;
  from?: string;
  source: EvaluateGraphNodeRequest["source"];
  sourceContext: { tier: string; pixelScale: number; resolutionLimited: boolean };
  dependencies: FillGenerationDependencies;
  upscaleModel: string;
  upscaleAdapter?: FillUpscaleDependencies["adapter"];
}

export async function refreshFillLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: RefreshFillRequest,
) {
  const document = await loadActiveDocument(database, request.photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  let branch = await describeFillBranch(database, request.photoId, selected);
  if (!branch) throw new Error("Layer does not contain a refreshable fill branch");
  const target = resolveFillRefreshTarget(branch, request.from);
  const nodes: NodeDraft[] = [];
  const artifacts: Awaited<ReturnType<typeof publishArtifact>>[] = [];
  const executions: PreparedNodeExecution[] = [];
  const warnings: Warning[] = [];

  let generationReference: NodeReference = { nodeId: branch.generation.id };
  let generationNodeId = branch.generation.id as `node_${string}`;
  let generationProvider = branch.generationProvider;
  let generationArtifact: { artifact: PublishedArtifact } | undefined;
  let generationRefreshed = false;
  let refreshedMask: Awaited<ReturnType<typeof prepareFillMask>> | undefined;
  if (target.kind === "generate") {
    let inputNodeId = document.roots.base;
    if (branch.outpaint) {
      const membership = new Set(branch.outpaint.predecessor_layer_ids);
      const plan = await planPhotographicOutput(database, {
        photoId: request.photoId,
        baseNodeId: document.roots.base,
        layers: document.layers.filter((layer) => membership.has(layer.id)),
        fixedInputCheckpointNodeId: selected.authoredCheckpointNodeId!,
      });
      inputNodeId = await publishDeterministicGraph(database, {
        photoId: request.photoId,
        nodes: plan.nodes,
        output: plan.rootUpdates.find((root) => root.root === "output")!.node,
      });
    }
    const refreshed = await executeGenerationRefresh(
      database,
      libraryPath,
      request,
      branch,
      branch.crop,
      inputNodeId,
      branch.permanentMaskNodeId,
    );
    nodes.push(refreshed.node);
    refreshedMask = refreshed.effectiveMask;
    if (refreshedMask) nodes.push(...refreshedMask.nodes);
    artifacts.push(refreshed.artifact);
    executions.push(refreshed.execution);
    appendWarnings(warnings, refreshed.warnings);
    generationReference = { localKey: refreshed.node.localKey };
    generationNodeId = refreshed.nodeId;
    generationProvider = refreshed.execution.provider;
    generationArtifact = {
      artifact: refreshed.artifact,
    };
    branch = {
      ...branch,
      crop: refreshed.crop,
      generationDimensions: { w: refreshed.artifact.w, h: refreshed.artifact.h },
      generationPlacementMatrix: composeTransformMatrices(
        invertTransformMatrix(branch.generationInputMatrix),
        [
          refreshed.crop.w / refreshed.artifact.w,
          0,
          0,
          refreshed.crop.h / refreshed.artifact.h,
          refreshed.crop.x,
          refreshed.crop.y,
        ],
      ),
    };
    generationRefreshed = true;
  } else {
    generationArtifact = await evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: branch.generation.id,
      source: request.source,
    });
  }

  let placementReference = generationReference;
  let placementArtifact: PublishedArtifact = generationArtifact.artifact;
  let upscaleNodeId: `node_${string}` | null = null;
  let upscaleProvider: ExternalExecutionProvenance | undefined;
  let upscaleReused = false;
  const densityTarget = fillPlacementDimensions(branch);
  const shouldRefreshUpscale = target.kind === "upscale" || (generationRefreshed && branch.upscale);
  const identity = branch.upscaleIdentity;
  if (generationRefreshed && !branch.upscale && identity) {
    const adapter = request.upscaleAdapter;
    const storedGeneration = objectParameters(branch.generation.parameters, "generation");
    const seed = numberOrUndefined(
      objectParameters(storedGeneration.request, "generation request").seed,
      "generation seed",
    );
    const density = await executeGenerationDensity(database, libraryPath, {
      generation: {
        nodeId: generationNodeId,
        reference: generationReference,
        provider: generationProvider,
        image: await readArtifactImage(placementArtifact.path, placementArtifact.artifactHash),
        artifact: placementArtifact,
        returnedDimensions: branch.generationDimensions,
        warnings: [],
        nodes: [],
        artifacts: [],
        executions: [],
      },
      target: { kind: "base_space_provider_crop", dimensionsIncludingPad: densityTarget },
      targetDimensions: densityTarget,
      sourceContext: request.sourceContext,
      upscale: {
        policy: resolveUpscalePolicy({
          releaseDefaultModel: identity.model,
          availableAdapterIds: adapter ? [identity.model] : [],
          flag: identity.enabled ? "upscale" : "no-upscale",
          settings: {
            providers: { upscale: { [identity.model]: { configured: Boolean(adapter) } } },
          },
          sourceContext: request.sourceContext,
        }),
        prompt: {
          id: identity.promptId,
          version: identity.promptVersion,
          original: identity.originalPrompt,
          derived: identity.derivedPrompt,
        },
        ...(adapter ? { adapter } : {}),
      },
      ...(seed === undefined ? {} : { seed }),
    });
    nodes.push(...density.nodes);
    artifacts.push(...density.artifacts);
    executions.push(...density.executions);
    appendWarnings(warnings, density.warnings);
    placementReference = density.output;
    placementArtifact = density.outputArtifact;
    upscaleNodeId = density.upscale.nodeId;
    upscaleProvider = density.upscale.provider;
  } else if (shouldRefreshUpscale) {
    if (!branch.upscale) throw new Error("Layer does not contain an upscale node");
    if (!request.upscaleAdapter) {
      if (target.kind === "upscale") throw new Error("The fill upscaler is not configured");
      warnings.push({
        code: "upscale_unconfigured",
        message: "Generation refreshed without rerunning its unconfigured upscaler",
      });
    } else {
      const refreshed = await executeUpscaleRefresh(
        database,
        libraryPath,
        request,
        branch,
        generationNodeId,
        generationReference,
        generationArtifact.artifact,
      );
      appendWarnings(warnings, refreshed.warnings);
      if (refreshed.ok) {
        nodes.push(refreshed.node);
        artifacts.push(refreshed.artifact);
        executions.push(refreshed.execution);
        placementReference = { localKey: refreshed.node.localKey };
        placementArtifact = refreshed.artifact;
        upscaleNodeId = refreshed.nodeId;
        upscaleProvider = refreshed.execution.provider;
      } else if (target.kind === "upscale") {
        placementReference = { nodeId: branch.upscale.id };
        upscaleNodeId = branch.upscale.id as `node_${string}`;
        upscaleProvider = branch.upscaleProvider;
        upscaleReused = true;
        placementArtifact = (
          await evaluateGraphNode({
            database,
            libraryPath,
            photoId: request.photoId,
            nodeId: branch.upscale.id,
            source: request.source,
          })
        ).artifact;
      }
    }
  } else if (branch.upscale) {
    placementReference = { nodeId: branch.upscale.id };
    upscaleNodeId = branch.upscale.id as `node_${string}`;
    upscaleProvider = branch.upscaleProvider;
    upscaleReused = true;
    placementArtifact = (
      await evaluateGraphNode({
        database,
        libraryPath,
        photoId: request.photoId,
        nodeId: branch.upscale.id,
        source: request.source,
      })
    ).artifact;
  }

  const rebuilt = rebuildFillBranch({
    branch,
    ...(refreshedMask ? { effectiveMask: { localKey: "effective-mask" } } : {}),
    key: "refresh",
    frame: branch.frame,
    baseNodeId: generationRefreshed && !branch.outpaint ? document.roots.base : branch.baseNodeId,
    placement: placementReference,
    placementDimensions: { w: placementArtifact.w, h: placementArtifact.h },
    generationDimensions: branch.generationDimensions,
    matrix: branch.currentMatrix,
    preserveCompensations: !generationRefreshed,
  });
  nodes.push(...rebuilt.nodes);
  const layers: RevisionLayerDraft[] = document.layers.map((layer) =>
    layer.id === layerId
      ? layerDraft(layer, layer.z, rebuilt.content, rebuilt.mask)
      : layerDraft(layer, layer.z),
  );
  const committed = await commitRevision(database, {
    outputPlan: "photographic",
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    nodes,
    rootUpdates: [],
    layers,
    artifacts,
    executions,
  });
  if (!committed.renderHash) throw new Error("A fill refresh must commit a render hash");
  const sourceContext = generationRefreshed ? request.sourceContext : branch.sourceContext;
  if (sourceContext.resolutionLimited) {
    appendWarnings(warnings, [
      {
        code: "source_resolution_limited",
        message: `Generation used resolution-limited ${sourceContext.tier} source pixels`,
      },
    ]);
  }
  return {
    graph: {
      revision: committed.revisionId,
      layer: layerId,
      outputNode: committed.roots.output! as `node_${string}`,
      renderHash: committed.renderHash as `r_${string}`,
    },
    refreshed: {
      kind: target.kind,
      fromNode: target.id,
      node: target.kind === "generate" ? generationNodeId : upscaleNodeId!,
    },
    generation: {
      node: generationNodeId,
      provider: generationProvider,
      returned: { w: generationArtifact.artifact.w, h: generationArtifact.artifact.h },
      reused: !generationRefreshed,
    },
    sourceContext,
    upscale: {
      enabled: identity?.enabled ?? Boolean(branch.upscale),
      executed: upscaleNodeId !== null,
      node: upscaleNodeId,
      provider: upscaleProvider,
      model: upscaleProvider?.model ?? request.upscaleModel,
      input: { w: generationArtifact.artifact.w, h: generationArtifact.artifact.h },
      target: densityTarget,
      generated: { w: placementArtifact.w, h: placementArtifact.h },
      final: densityTarget,
      densitySatisfied:
        placementArtifact.w >= densityTarget.w && placementArtifact.h >= densityTarget.h,
      warnings: warnings.filter(({ code }) => code.startsWith("upscale_")),
      reused: upscaleReused,
    },
    compositeNode: (rebuilt.compositeKey
      ? committed.nodes[rebuilt.compositeKey]!.id
      : committed.roots.output!) as `node_${string}`,
    executions: [
      {
        kind: "generate" as const,
        node: generationNodeId,
        provider: generationProvider,
        reused: !generationRefreshed,
      },
      ...(upscaleProvider && upscaleNodeId
        ? [
            {
              kind: "upscale" as const,
              node: upscaleNodeId,
              provider: upscaleProvider,
              reused: upscaleReused,
            },
          ]
        : []),
    ],
    warnings,
  };
}

export function resolveFillRefreshTarget(
  branch: Pick<FillBranchDescriptor, "generation" | "upscale">,
  from: string | undefined,
): { id: string; kind: "generate" | "upscale" } {
  const candidates = [branch.generation, ...(branch.upscale ? [branch.upscale] : [])];
  if (!from) return { id: branch.generation.id, kind: "generate" };
  const matches = candidates.filter(({ id }) => id === from || id.startsWith(from));
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? "--from must name the generation or upscale node in this layer"
        : `Ambiguous refresh node prefix: ${from}`,
    );
  }
  const match = matches[0]!;
  return { id: match.id, kind: match.kind as "generate" | "upscale" };
}

async function executeGenerationRefresh(
  database: GraphDatabase,
  libraryPath: string,
  request: RefreshFillRequest,
  branch: FillBranchDescriptor,
  cropRect: FillBranchDescriptor["crop"],
  baseNodeId: string,
  maskNodeId: string,
) {
  const generation = branch.generation;
  const parameters = objectParameters(generation.parameters, "generate");
  const storedRequest = objectParameters(parameters.request, "generate request");
  const operation = storedRequest.operation;
  if (operation !== "remove" && operation !== "prompt") {
    throw new Error("Generate recipe has an invalid operation");
  }
  const prompt = stringValue(parameters.prompt, "generate prompt");
  const seed = numberOrUndefined(storedRequest.seed, "generate seed");
  const storedControls =
    storedRequest.controls === undefined
      ? {}
      : objectParameters(storedRequest.controls, "generate controls");
  const init = storedControls.requested_init ?? "original";
  if (init !== "original" && init !== "fill" && init !== "noise" && init !== "empty")
    throw new Error("Generate recipe has an invalid initialization");
  const referenceNodeId = generation.recipeVersion === 3 ? generation.inputNodeIds[1] : undefined;
  const reference = referenceNodeId
    ? await readReferenceArtifact(database, libraryPath, request.photoId, referenceNodeId)
    : undefined;
  assertGenerationAdapter(parameters, request.dependencies);
  const [baseEvaluation, maskEvaluation] = await Promise.all([
    evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: baseNodeId,
      source: request.source,
    }),
    evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: maskNodeId,
      source: request.source,
    }),
  ]);
  let base = await readArtifactImage(
    baseEvaluation.artifact.path,
    baseEvaluation.artifact.artifactHash,
  );
  let mask = await readArtifactMask(
    maskEvaluation.artifact.path,
    maskEvaluation.artifact.artifactHash,
  );
  const projection = await loadBaseProjection(database, request.photoId, baseEvaluation);
  if (branch.outpaint)
    base = prepareOutpaintPixels(base, projection, parseRenderFrame(branch.outpaint.output_frame));
  const baseToInput = branch.outpaint
    ? ([1, 0, 0, 1, 0, 0] as const)
    : composeTransformMatrices(
        projection.baseToRaster,
        invertTransformMatrix(branch.generationInputMatrix),
      );
  let effectiveMask: Awaited<ReturnType<typeof prepareFillMask>> | undefined;
  if (branch.fit && branch.selectionNodeId) {
    const { visible: _previousVisible, ...fit } = branch.fit;
    effectiveMask = await prepareFillMask(
      database,
      libraryPath,
      request,
      { contentNodeId: branch.generation.id, maskNodeId: branch.selectionNodeId },
      fit,
      { matrix: [...baseToInput], w: base.w, h: base.h },
    );
    mask = effectiveMask.mask;
  } else if (!isIdentityMatrix(branch.generationInputMatrix)) {
    mask = {
      ...mask,
      data: await transformMaskPixels(
        mask.data,
        mask.w,
        mask.h,
        mask.w,
        mask.h,
        branch.generationInputMatrix,
      ),
    };
  }
  if (!mask.data.some((value) => value > 0))
    throw new PhotoctlError("usage", "The effective selection is not visible in the current frame");
  cropRect = branch.outpaint
    ? branch.crop
    : planRefreshedFillCrop(mask, cropRect, numberOrUndefined(storedRequest.pad, "generate pad"));
  const sent = await fillProviderInputs(
    base,
    mask,
    cropRect,
    storedRequest.full_res !== false,
    branch.outpaint ? undefined : baseToInput,
  );
  const prepared = await request.dependencies.adapter.buildEdit(
    operation,
    sent.image,
    sent.mask,
    prompt,
    seed,
    { init, ...(reference ? { reference } : {}) },
  );
  const started = (request.dependencies.now ?? Date.now)();
  return (
    await runProviderImageAttempt(
      database,
      libraryPath,
      {
        operation: "edit",
        adapter: request.dependencies.adapter.id,
        adapter_version: request.dependencies.adapter.version,
        ...imageAttemptRequestDetails(prepared),
        model: request.dependencies.model,
        prompt,
        dimensions: prepared.outputDimensions,
        input_artifact_hashes: [
          baseEvaluation.artifact.artifactHash,
          ...(reference ? [reference.workingArtifactHash] : []),
        ],
        ...(seed === undefined ? {} : { seed }),
      },
      async (attempt) => {
        const response = await request.dependencies.gateway.imageEdits(prepared.body);
        const normalized = await normalizeGeneratedImage(
          request.dependencies.adapter,
          response.data,
          prepared,
          async (bytes) =>
            await attempt.retain(bytes, {
              request_id: response.requestId,
              transport_attempts: response.attempts,
              cost_usd: null,
            }),
        );
        normalized.warnings.unshift(...prepared.warnings);
        if (effectiveMask && effectiveMask.clippedPixels > 0)
          normalized.warnings.push({
            code: "mask_clipped",
            message:
              "Refreshed fill coverage was clipped to the current visible frame; the original selection is unchanged",
          });
        if (normalized.wholeFrame && (!branch.fit || branch.fit.mode === "strict")) {
          throw new PhotoctlError(
            "provider_whole_frame",
            "Refresh refused a provider result that edited the whole frame",
            {
              id: request.photoId,
            },
          );
        }
        const image = await decodeExternalImage(normalized.png, normalized.returnedDimensions);
        const artifact = await publishArtifact(libraryPath, await normalizeArtifact(image));
        const executionId = newExecutionId();
        const nextParameters = {
          ...parameters,
          adapter_version: request.dependencies.adapter.version,
          request: {
            ...storedRequest,
            controls: {
              requested_init: init,
              applied_init: prepared.appliedControls.init,
              reference_used: prepared.appliedControls.reference,
            },
            execution_id: executionId,
            returned: [normalized.returnedDimensions.w, normalized.returnedDimensions.h],
            sent: [prepared.outputDimensions.w, prepared.outputDimensions.h],
            provider_output: { ...prepared.outputDimensions },
            frame_mapping: prepared.frameMapping ? { ...prepared.frameMapping } : null,
            full_res: storedRequest.full_res !== false,
            crop: [cropRect.x, cropRect.y, cropRect.w, cropRect.h],
            sampling: {
              base_to_input: [...baseToInput],
              input_dimensions: [base.w, base.h],
              outside_visible: "black-protected",
            },
            source_context: {
              tier: request.sourceContext.tier,
              pixel_scale: request.sourceContext.pixelScale,
              resolution_limited: request.sourceContext.resolutionLimited,
            },
            ...(!isIdentityMatrix(branch.generationInputMatrix)
              ? { input_matrix: [...branch.generationInputMatrix] }
              : {}),
          },
        } as JsonValue;
        const node: NodeDraft = {
          localKey: "refresh-generation",
          kind: "generate",
          recipeVersion: generation.recipeVersion,
          parameters: nextParameters,
          inputs: [
            { nodeId: baseNodeId },
            ...(referenceNodeId ? [{ nodeId: referenceNodeId }] : []),
          ],
        };
        const recipe = recipeHash(
          canonicalNodeRecipe({
            kind: node.kind,
            recipeVersion: node.recipeVersion,
            parameters: node.parameters,
            inputNodeIds: [baseNodeId, ...(referenceNodeId ? [referenceNodeId] : [])],
          }),
        );
        const provider: ExternalExecutionProvenance = {
          adapter: request.dependencies.adapter.id,
          adapterVersion: request.dependencies.adapter.version,
          service: request.dependencies.service ?? "gateway",
          model: request.dependencies.model,
          modelVersion: null,
          providerRequestId: response.requestId,
          seed: seed ?? null,
          durationMs: Math.max(0, (request.dependencies.now ?? Date.now)() - started),
          costUsd: 0,
          inputPx:
            prepared.outputDimensions.w * prepared.outputDimensions.h +
            (reference && prepared.appliedControls.reference ? reference.w * reference.h : 0),
          targetPx: prepared.outputDimensions.w * prepared.outputDimensions.h,
          attempt: response.attempts,
          densityVerdict: "not-applicable",
          warnings: normalized.warnings,
        };
        const execution: PreparedNodeExecution = {
          providerImageAttemptId: attempt.id,
          node: { localKey: node.localKey },
          executionId,
          evaluationHash: evaluationHash({
            nodeRecipeHash: recipe,
            kind: node.kind,
            recipeVersion: node.recipeVersion,
            inputArtifactHashes: [
              baseEvaluation.artifact.artifactHash,
              ...(reference ? [reference.workingArtifactHash] : []),
            ],
          }),
          outputArtifactHash: artifact.artifactHash,
          inputArtifactHashes: [
            baseEvaluation.artifact.artifactHash,
            ...(reference ? [reference.workingArtifactHash] : []),
          ],
          provider,
        };
        return {
          node,
          nodeId: logicalNodeId(recipe),
          artifact,
          execution,
          warnings: normalized.warnings,
          effectiveMask,
          crop: cropRect,
        };
      },
    )
  ).value;
}

async function executeUpscaleRefresh(
  database: GraphDatabase,
  libraryPath: string,
  request: RefreshFillRequest,
  branch: FillBranchDescriptor,
  generationNodeId: string,
  generationReference: NodeReference,
  generationArtifact: Awaited<ReturnType<typeof publishArtifact>>,
) {
  const upscale = branch.upscale;
  if (!upscale) throw new Error("Layer does not contain an upscale node");
  const parameters = objectParameters(upscale.parameters, "upscale");
  const adapter = request.upscaleAdapter!;
  if (parameters.adapter !== adapter.id) {
    throw new Error("Configured upscaler does not match the stored fill recipe");
  }
  const controls = objectParameters(parameters.controls, "upscale controls");
  const prompt = stringValue(controls.derived_prompt, "upscale derived prompt");
  const storedScale = numberValue(parameters.scale, "upscale scale");
  const storedRequest = objectParameters(parameters.request, "upscale request");
  const seed = numberOrUndefined(storedRequest.seed, "upscale seed");
  const generationImage = await readArtifactImage(
    generationArtifact.path,
    generationArtifact.artifactHash,
  );
  const target = fillPlacementDimensions(branch);
  const density = planOutputDensity({
    target: { kind: "base_space_provider_crop", dimensionsIncludingPad: target },
    generated: {
      id: generationArtifact.artifactHash,
      dimensions: { w: generationImage.w, h: generationImage.h },
    },
    cachedUpscales: [],
    supportedScales: adapter.supportedScales,
    limits: adapter.limits,
    sourceContext: branch.sourceContext,
  });
  const operation = density.upscale.operations.find((candidate) => candidate.kind === "upscale");
  if (!operation && !density.upscale.densitySatisfied)
    return { ok: false as const, warnings: density.upscale.warnings };
  // Explicit refresh still reruns an existing upscale when generation already covers placement.
  const scale = operation?.scale ?? storedScale;
  const result = await executeRetainedUpscale(database, libraryPath, adapter, {
    artifact: {
      bytes: await image16Png(generationImage),
      mediaType: "image/png",
      hash: generationArtifact.artifactHash,
      dimensions: { w: generationImage.w, h: generationImage.h },
    },
    scale,
    prompt,
    ...(seed === undefined ? {} : { seed }),
  });
  if (!result.ok) return { ok: false as const, warnings: result.warnings };
  const artifact = result.artifact;
  const executionId = newExecutionId();
  const provenance = result.value.provenance;
  const nextParameters = {
    ...parameters,
    scale,
    adapter_version: adapter.version,
    model_version: provenance.modelVersion,
    request: { ...storedRequest, execution_id: executionId },
  } as JsonValue;
  const node: NodeDraft = {
    localKey: "refresh-upscale",
    kind: "upscale",
    recipeVersion: upscale.recipeVersion,
    parameters: nextParameters,
    inputs: [generationReference],
  };
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: node.kind,
      recipeVersion: node.recipeVersion,
      parameters: node.parameters,
      inputNodeIds: [generationNodeId],
    }),
  );
  const provider: ExternalExecutionProvenance = {
    adapter: provenance.adapter,
    adapterVersion: provenance.adapterVersion,
    service: provenance.service,
    model: provenance.model,
    modelVersion: provenance.modelVersion,
    providerRequestId: provenance.requestId,
    seed: provenance.seed,
    durationMs: provenance.durationMs,
    costUsd: provenance.costUsd,
    inputPx: generationImage.w * generationImage.h,
    targetPx: result.samplingDimensions.w * result.samplingDimensions.h,
    attempt: 1,
    densityVerdict: artifact.w >= target.w && artifact.h >= target.h ? "satisfied" : "limited",
    warnings: [...density.upscale.warnings, ...result.warnings],
  };
  const execution: PreparedNodeExecution = {
    providerImageAttemptId: result.attemptId,
    node: { localKey: node.localKey },
    executionId,
    evaluationHash: evaluationHash({
      nodeRecipeHash: recipe,
      kind: node.kind,
      recipeVersion: node.recipeVersion,
      inputArtifactHashes: [generationArtifact.artifactHash],
    }),
    outputArtifactHash: artifact.artifactHash,
    inputArtifactHashes: [generationArtifact.artifactHash],
    provider,
  };
  return {
    ok: true as const,
    node,
    nodeId: logicalNodeId(recipe),
    artifact,
    execution,
    provider,
    warnings: provider.warnings,
  };
}

function objectParameters(value: unknown, name: string): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} parameters are invalid`);
  }
  return value as Record<string, JsonValue>;
}

function stringValue(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} is invalid`);
  return value;
}

function numberValue(value: JsonValue | undefined, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} is invalid`);
  return value;
}

function numberOrUndefined(value: JsonValue | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  return numberValue(value, name);
}

function assertGenerationAdapter(
  parameters: Record<string, JsonValue>,
  dependencies: FillGenerationDependencies,
): void {
  if (parameters.adapter !== dependencies.adapter.id || parameters.model !== dependencies.model) {
    throw new Error("Configured generator does not match the stored fill recipe");
  }
}
