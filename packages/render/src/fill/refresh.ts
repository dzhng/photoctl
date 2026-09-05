import { PhotoctlError, type Warning } from "@photoctl/protocol";
import {
  normalizeArtifact,
  publishArtifact,
  readArtifactImage,
  readArtifactMask,
  type PublishedArtifact,
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
  type PreparedNodeExecution,
} from "../graph/store.js";
import type { ExternalExecutionProvenance, JsonValue } from "../graph/types.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { describeFillBranch, type FillBranchDescriptor } from "./branch.js";
import {
  cropImagePng,
  cropMappedExternalImage,
  cropMaskPng,
  decodeExternalImage,
  image16Png,
} from "./external-pixels.js";
import type { FillGenerationDependencies, FillUpscaleDependencies } from "./pipeline.js";

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
  const branch = await describeFillBranch(database, request.photoId, selected.contentNodeId);
  if (!branch) throw new Error("Layer does not contain a refreshable fill branch");
  const target = resolveFillRefreshTarget(branch, request.from);
  if (target.kind === "generate" && branch.baseAncestry.some(({ kind }) => kind === "transform")) {
    throw new Error(
      "Generation refresh cannot rebase a transformed fill input until affine branch rebasing is available",
    );
  }
  const nodes: NodeDraft[] = [];
  const artifacts: Awaited<ReturnType<typeof publishArtifact>>[] = [];
  const executions: PreparedNodeExecution[] = [];
  const warnings: Warning[] = [];

  let generationReference: NodeReference = { nodeId: branch.generation.id };
  let generationNodeId = branch.generation.id as `node_${string}`;
  let generationProvider = branch.generationProvider;
  let generationArtifact: { artifact: PublishedArtifact } | undefined;
  let generationRefreshed = false;
  if (target.kind === "generate") {
    const refreshed = await executeGenerationRefresh(
      database,
      libraryPath,
      request,
      branch.generation,
      branch.crop,
      document.roots.base,
      branch.maskNodeId,
    );
    nodes.push(refreshed.node);
    artifacts.push(refreshed.artifact);
    executions.push(refreshed.execution);
    appendWarnings(warnings, refreshed.warnings);
    generationReference = { localKey: refreshed.node.localKey };
    generationNodeId = refreshed.nodeId;
    generationProvider = refreshed.execution.provider;
    generationArtifact = {
      artifact: refreshed.artifact,
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
  const shouldRefreshUpscale = target.kind === "upscale" || (generationRefreshed && branch.upscale);
  if (shouldRefreshUpscale) {
    if (!branch.upscale) throw new Error("Layer does not contain an upscale node");
    if (!request.upscaleAdapter) {
      if (target.kind === "upscale") throw new Error("The fill upscaler is not configured");
      warnings.push({
        code: "upscale_unconfigured",
        message: "Generation refreshed without rerunning its unconfigured upscaler",
      });
    } else {
      const refreshed = await executeUpscaleRefresh(
        libraryPath,
        request,
        branch.upscale,
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

  const resampleKey = "refresh-resample";
  nodes.push(cloneNode(branch.resample, resampleKey, [placementReference]));
  const compositeKey = "refresh-mask-composite";
  nodes.push(
    cloneNode(branch.composite, compositeKey, [
      { nodeId: generationRefreshed ? document.roots.base : branch.baseNodeId },
      { localKey: resampleKey },
      { nodeId: branch.maskNodeId },
    ]),
  );
  let contentReference: NodeReference = { localKey: compositeKey };
  const descendants = generationRefreshed
    ? branch.descendants.filter(({ kind }) => kind !== "delta")
    : branch.descendants;
  for (const [index, descendant] of descendants.toReversed().entries()) {
    const localKey = `refresh-descendant-${index}`;
    nodes.push(cloneNode(descendant, localKey, [contentReference]));
    contentReference = { localKey };
  }
  const layers: RevisionLayerDraft[] = document.layers.map((layer) => ({
    layer: { layerId: layer.id },
    name: layer.name,
    z: layer.z,
    contentNode: layer.id === layerId ? contentReference : { nodeId: layer.contentNodeId },
    maskNode: { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  }));
  const output = compositeV2Projection({ nodeId: document.roots.base }, layers);
  nodes.push({
    localKey: "refresh-document-composite",
    kind: "composite",
    recipeVersion: 2,
    ...output,
  });
  const committed = await commitRevision(database, {
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    nodes,
    rootUpdates: [{ root: "output", node: { localKey: "refresh-document-composite" } }],
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
      enabled: Boolean(branch.upscale),
      executed: upscaleNodeId !== null,
      node: upscaleNodeId,
      provider: upscaleProvider,
      model: upscaleProvider?.model ?? request.upscaleModel,
      input: { w: generationArtifact.artifact.w, h: generationArtifact.artifact.h },
      target: { w: branch.crop.w, h: branch.crop.h },
      generated: { w: placementArtifact.w, h: placementArtifact.h },
      final: { w: branch.crop.w, h: branch.crop.h },
      densitySatisfied:
        placementArtifact.w >= branch.crop.w && placementArtifact.h >= branch.crop.h,
      warnings: warnings.filter(({ code }) => code.startsWith("upscale_")),
      reused: upscaleReused,
    },
    compositeNode: committed.nodes[compositeKey]!.id as `node_${string}`,
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
  branch: FillBranchDescriptor,
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
  generation: FillBranchDescriptor["generation"],
  cropRect: FillBranchDescriptor["crop"],
  baseNodeId: string,
  maskNodeId: string,
) {
  const parameters = objectParameters(generation.parameters, "generate");
  const storedRequest = objectParameters(parameters.request, "generate request");
  const operation = storedRequest.operation;
  if (operation !== "remove" && operation !== "prompt") {
    throw new Error("Generate recipe has an invalid operation");
  }
  const prompt = stringValue(parameters.prompt, "generate prompt");
  const seed = numberOrUndefined(storedRequest.seed, "generate seed");
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
  const base = await readArtifactImage(
    baseEvaluation.artifact.path,
    baseEvaluation.artifact.artifactHash,
  );
  const mask = await readArtifactMask(
    maskEvaluation.artifact.path,
    maskEvaluation.artifact.artifactHash,
  );
  const form = request.dependencies.adapter.buildEdit(
    operation,
    { png: await cropImagePng(base, cropRect), w: cropRect.w, h: cropRect.h },
    await cropMaskPng(mask, cropRect),
    prompt,
    seed,
  );
  const started = (request.dependencies.now ?? Date.now)();
  const response = await request.dependencies.gateway.imageEdits(form);
  const normalized = await request.dependencies.adapter.normalize(response.data, {
    w: cropRect.w,
    h: cropRect.h,
  });
  if (normalized.wholeFrame) {
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
      execution_id: executionId,
      returned: [normalized.returnedDimensions.w, normalized.returnedDimensions.h],
      source_context: {
        tier: request.sourceContext.tier,
        pixel_scale: request.sourceContext.pixelScale,
        resolution_limited: request.sourceContext.resolutionLimited,
      },
    },
  } as JsonValue;
  const node: NodeDraft = {
    localKey: "refresh-generation",
    kind: "generate",
    recipeVersion: generation.recipeVersion,
    parameters: nextParameters,
    inputs: [{ nodeId: baseNodeId }],
  };
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: node.kind,
      recipeVersion: node.recipeVersion,
      parameters: node.parameters,
      inputNodeIds: [baseNodeId],
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
    inputPx: cropRect.w * cropRect.h,
    targetPx: cropRect.w * cropRect.h,
    attempt: response.attempts,
    densityVerdict: "not-applicable",
    warnings: normalized.warnings,
  };
  const execution: PreparedNodeExecution = {
    node: { localKey: node.localKey },
    executionId,
    evaluationHash: evaluationHash({
      nodeRecipeHash: recipe,
      kind: node.kind,
      recipeVersion: node.recipeVersion,
      inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
    }),
    outputArtifactHash: artifact.artifactHash,
    inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
    provider,
  };
  return {
    node,
    nodeId: logicalNodeId(recipe),
    artifact,
    execution,
    warnings: normalized.warnings,
  };
}

async function executeUpscaleRefresh(
  libraryPath: string,
  request: RefreshFillRequest,
  upscale: NonNullable<FillBranchDescriptor["upscale"]>,
  generationNodeId: string,
  generationReference: NodeReference,
  generationArtifact: Awaited<ReturnType<typeof publishArtifact>>,
) {
  const parameters = objectParameters(upscale.parameters, "upscale");
  const adapter = request.upscaleAdapter!;
  if (parameters.adapter !== adapter.id) {
    throw new Error("Configured upscaler does not match the stored fill recipe");
  }
  const controls = objectParameters(parameters.controls, "upscale controls");
  const prompt = stringValue(controls.derived_prompt, "upscale derived prompt");
  const scale = numberValue(parameters.scale, "upscale scale");
  const storedRequest = objectParameters(parameters.request, "upscale request");
  const seed = numberOrUndefined(storedRequest.seed, "upscale seed");
  const generationImage = await readArtifactImage(
    generationArtifact.path,
    generationArtifact.artifactHash,
  );
  const result = await adapter.execute({
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
  let normalized: Awaited<ReturnType<typeof normalizeArtifact>>;
  try {
    const bytes = result.value.frameMapping
      ? await cropMappedExternalImage(result.value.artifact.bytes, result.value.frameMapping.output)
      : result.value.artifact.bytes;
    const image = await decodeExternalImage(bytes, result.samplingDimensions);
    normalized = await normalizeArtifact(image);
  } catch (error) {
    return {
      ok: false as const,
      warnings: [
        ...result.warnings,
        {
          code: "upscale_failed" as const,
          message: error instanceof Error ? error.message : "Upscaler returned unreadable pixels",
        },
      ],
    };
  }
  const artifact = await publishArtifact(libraryPath, normalized);
  const executionId = newExecutionId();
  const provenance = result.value.provenance;
  const nextParameters = {
    ...parameters,
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
    densityVerdict: result.densitySatisfied ? "satisfied" : "limited",
    warnings: result.warnings,
  };
  const execution: PreparedNodeExecution = {
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
    warnings: result.warnings,
  };
}

function cloneNode(
  node: { kind: NodeDraft["kind"]; recipeVersion: number; parameters: unknown | null },
  localKey: string,
  inputs: NodeReference[],
): NodeDraft {
  if (node.parameters === null) throw new Error("Fill branch parameters are unavailable");
  return {
    localKey,
    kind: node.kind,
    recipeVersion: node.recipeVersion,
    parameters: node.parameters as JsonValue,
    inputs,
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

function appendWarnings(target: Warning[], additions: readonly Warning[]): void {
  for (const warning of additions) {
    if (!target.some(({ code, message }) => code === warning.code && message === warning.message)) {
      target.push(warning);
    }
  }
}
