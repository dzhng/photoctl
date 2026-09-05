import { PhotoctlError } from "@photoctl/protocol";
import sharp from "sharp";
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
} from "../graph/store.js";
import type { ExternalExecutionProvenance } from "../graph/types.js";
import { compositeV2Projection, resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import type { Image16 } from "../source-render.js";
import { planFillCrop } from "./crop.js";
import { strictEffectiveMask } from "./fit.js";

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
      resampled: boolean;
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
  const normalized = await request.dependencies.adapter.normalize(response.data, {
    w: crop.w,
    h: crop.h,
  });
  if (normalized.wholeFrame) {
    throw new PhotoctlError(
      "provider_whole_frame",
      "Strict fill refused a provider result that edited the whole frame",
      { id: request.photoId, layer: layerId },
    );
  }
  const generated = await placeCrop(base, normalized.png, crop);
  const published = await publishArtifact(libraryPath, await normalizeArtifact(generated));
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
      resampled: normalized.resampled,
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
  const generationNodeId = logicalNodeId(generationRecipe);
  const provider: ExternalExecutionProvenance = {
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
  const nodes: NodeDraft[] = [
    {
      localKey: "generation",
      kind: "generate",
      recipeVersion: 1,
      parameters: generationParameters,
      inputs: [{ nodeId: selected.contentNodeId }],
    },
    {
      localKey: "resample",
      kind: "resample",
      recipeVersion: 1,
      parameters: { w: base.w, h: base.h, kernel: "lanczos3" },
      inputs: [{ localKey: "generation" }],
    },
    {
      localKey: "strict-composite",
      kind: "mask_composite",
      recipeVersion: 1,
      parameters: { feather: 0 },
      inputs: [
        { nodeId: selected.contentNodeId },
        { localKey: "resample" },
        { nodeId: selected.maskNodeId },
      ],
    },
  ];
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
    artifacts: [published],
    executions: [
      {
        node: { localKey: "generation" },
        executionId,
        evaluationHash: evaluationHash({
          nodeRecipeHash: generationRecipe,
          kind: "generate",
          recipeVersion: 1,
          inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
        }),
        outputArtifactHash: published.artifactHash,
        inputArtifactHashes: [baseEvaluation.artifact.artifactHash],
        provider,
      },
    ],
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
    resampled: normalized.resampled,
    returnedDimensions: normalized.returnedDimensions,
    crop,
    warnings: normalized.warnings,
  };
}

async function cropImagePng(base: Image16, crop: { x: number; y: number; w: number; h: number }) {
  const display8 = Buffer.allocUnsafe(base.data.length);
  for (let index = 0; index < base.data.length; index += 1) {
    display8[index] = Math.round(base.data[index]! / 257);
  }
  return await sharp(display8, {
    raw: { width: base.w, height: base.h, channels: 3 },
  })
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .png()
    .toBuffer();
}

async function cropMaskPng(
  mask: { w: number; h: number; data: Float32Array },
  crop: { x: number; y: number; w: number; h: number },
) {
  const pixels = Buffer.alloc(mask.w * mask.h);
  for (let index = 0; index < pixels.length; index += 1)
    pixels[index] = Math.round(mask.data[index]! * 255);
  return await sharp(pixels, { raw: { width: mask.w, height: mask.h, channels: 1 } })
    .extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    .png()
    .toBuffer();
}

async function placeCrop(
  base: Image16,
  png: Buffer,
  crop: { x: number; y: number; w: number; h: number },
): Promise<Image16> {
  const decoded = await sharp(png)
    .removeAlpha()
    .toColourspace("srgb")
    .raw({ depth: "ushort" })
    .toBuffer();
  const data = new Uint16Array(base.data);
  for (let y = 0; y < crop.h; y += 1) {
    for (let x = 0; x < crop.w; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const source = (y * crop.w + x) * 3 + channel;
        const target = ((crop.y + y) * base.w + crop.x + x) * 3 + channel;
        data[target] = decoded.readUInt16LE(source * 2);
      }
    }
  }
  return { ...base, data };
}
