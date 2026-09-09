import { describeFullFrameBranch } from "./full-frame-branch.js";
import {
  commitRevision,
  loadActiveDocument,
  publishDeterministicGraph,
  type GraphDatabase,
  type NodeDraft,
  type NodeReference,
} from "./graph/store.js";
import { layerDraft, resolveLayerId } from "./layers/model.js";
import { resolveFillRefreshTarget, type RefreshFillRequest } from "./fill/refresh.js";
import { planPhotographicOutput } from "./graph/output.js";
import { frameAtRaster, parseRenderFrame, savedRenderFrame } from "./graph/frame.js";
import { evaluateGraphNode, type EvaluatedNode } from "./graph/evaluator.js";
import { loadBaseProjection, loadLogicalFrame } from "./graph/projection.js";
import { isDeepStrictEqual } from "node:util";
import { readArtifactImage } from "./artifacts/publication.js";
import { executeFreshGeneration, executeGenerationDensity } from "./fill/generation.js";
import { image16Png } from "./fill/external-pixels.js";
import { resolveUpscalePolicy } from "./fill/upscale-policy.js";
import { failProviderImageAttempts } from "./provider-images/attempts.js";
import type { JsonValue } from "./graph/types.js";

export async function prepareFullFrameRefresh(
  database: GraphDatabase,
  photoId: string,
  layer: string,
  from?: string,
) {
  const document = await loadActiveDocument(database, photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(database, photoId, layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error("Layer is not present in the active revision");
  const branch = await describeFullFrameBranch(database, photoId, selected);
  if (!branch) return undefined;
  const target = resolveFillRefreshTarget(branch, from);
  let inputNodeId = branch.generation.inputNodeIds[0]!;
  if (target.kind === "generate") {
    const membership = new Set(branch.parameters.request.full_frame.predecessor_layer_ids);
    const layers = document.layers.filter(({ id }) => membership.has(id) && id !== layerId);
    const currentPlan = await planPhotographicOutput(database, {
      photoId,
      baseNodeId: document.roots.base!,
      geometryNodeId: selected.authoredCheckpointNodeId ?? undefined,
      layers,
    });
    const currentInput = await publishDeterministicGraph(database, {
      photoId,
      nodes: currentPlan.nodes,
      output: currentPlan.rootUpdates.find(({ root }) => root === "output")!.node,
    });
    const currentFrame = await loadLogicalFrame(database, photoId, currentInput);
    const authoredFrame = parseRenderFrame(branch.parameters.request.full_frame.authored_frame);
    // Keep the ordinary recipe when it already names this viewport, including its retained pixels.
    if (
      isDeepStrictEqual(currentFrame.raster, authoredFrame.raster) &&
      isDeepStrictEqual(currentFrame.baseToRaster, authoredFrame.baseToRaster)
    ) {
      return { document, selected, branch, target, inputNodeId: currentInput };
    }
    const plan = await planPhotographicOutput(database, {
      photoId,
      baseNodeId: document.roots.base!,
      geometryNodeId: selected.authoredCheckpointNodeId ?? undefined,
      layers,
      fixedViewportFrame: parseRenderFrame(branch.parameters.request.full_frame.authored_frame),
    });
    inputNodeId = await publishDeterministicGraph(database, {
      photoId,
      nodes: plan.nodes,
      output: plan.rootUpdates.find(({ root }) => root === "output")!.node,
    });
  }
  return { document, selected, branch, target, inputNodeId };
}

export async function refreshFullFrameLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: RefreshFillRequest & {
    prepared: NonNullable<Awaited<ReturnType<typeof prepareFullFrameRefresh>>>;
    inputEvaluation?: EvaluatedNode;
  },
) {
  const { document, selected, branch, target, inputNodeId } = request.prepared;
  if (
    target.kind === "generate" &&
    (branch.parameters.adapter !== request.dependencies.adapter.id ||
      branch.parameters.model !== request.dependencies.model)
  )
    throw new Error("Configured generator does not match the stored full-frame recipe");
  if (target.kind === "upscale" && branch.upscaleIdentity.adapter !== request.upscaleAdapter?.id)
    throw new Error("Configured upscaler does not match the stored full-frame recipe");
  const authored = parseRenderFrame(branch.parameters.request.full_frame.authored_frame);
  const evaluated =
    request.inputEvaluation ??
    (await evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: target.kind === "generate" ? inputNodeId : branch.generation.id,
      source: request.source,
    }));
  const pixels = await readArtifactImage(evaluated.artifact.path, evaluated.artifact.artifactHash);
  const inputFrame = await loadBaseProjection(database, request.photoId, evaluated);
  const generation =
    target.kind === "generate"
      ? await executeFreshGeneration(database, libraryPath, {
          inputNodeId,
          inputArtifactHash: evaluated.artifact.artifactHash,
          prompt: branch.parameters.prompt,
          promptVersion: branch.parameters.prompt_version,
          dependencies: request.dependencies,
          buildRequest: async () =>
            request.dependencies.adapter.buildFullFrameEdit(
              { png: await image16Png(pixels), w: pixels.w, h: pixels.h },
              branch.parameters.request.provider_prompt,
            ),
          request: (executionId, returned) =>
            ({
              ...branch.parameters.request,
              execution_id: executionId,
              returned: [returned.w, returned.h],
              full_frame: {
                ...branch.parameters.request.full_frame,
                input_frame: savedRenderFrame(inputFrame),
                input_execution_id: evaluated.executionId,
              },
              source_context: {
                tier: request.sourceContext.tier,
                pixel_scale: request.sourceContext.pixelScale,
                resolution_limited: request.sourceContext.resolutionLimited,
              },
            }) as JsonValue,
        })
      : {
          nodeId: branch.generation.id as `node_${string}`,
          reference: { nodeId: branch.generation.id },
          provider: branch.generationProvider,
          image: pixels,
          artifact: evaluated.artifact,
          returnedDimensions: { w: pixels.w, h: pixels.h },
          warnings: [],
          nodes: [],
          artifacts: [],
          executions: [],
        };
  const identity = branch.upscaleIdentity;
  const sourceContext = target.kind === "generate" ? request.sourceContext : branch.sourceContext;
  let density = await executeGenerationDensity(database, libraryPath, {
    generation,
    target: { kind: "oriented_full_frame", dimensions: authored.raster },
    targetDimensions: authored.raster,
    sourceContext,
    upscale: {
      policy: resolveUpscalePolicy({
        releaseDefaultModel: identity.model,
        availableAdapterIds: request.upscaleAdapter ? [identity.model] : [],
        flag: identity.enabled ? "upscale" : "no-upscale",
        settings: {
          providers: {
            upscale: { [identity.model]: { configured: Boolean(request.upscaleAdapter) } },
          },
        },
        sourceContext,
      }),
      prompt: {
        id: identity.promptId,
        version: identity.promptVersion,
        original: identity.originalPrompt,
        derived: identity.derivedPrompt,
      },
      ...(request.upscaleAdapter ? { adapter: request.upscaleAdapter } : {}),
    },
  });
  const upscaleReused = target.kind === "upscale" && !density.upscale.nodeId;
  if (upscaleReused) {
    if (!branch.upscale || !branch.upscaleProvider)
      throw new Error("The prior upscale is unavailable");
    const retained = await evaluateGraphNode({
      database,
      libraryPath,
      photoId: request.photoId,
      nodeId: branch.upscale.id,
    });
    density = {
      ...density,
      output: { nodeId: branch.upscale.id },
      outputArtifact: retained.artifact,
      upscale: {
        ...density.upscale,
        nodeId: branch.upscale.id as `node_${string}`,
        provider: branch.upscaleProvider,
        generated: { w: retained.artifact.w, h: retained.artifact.h },
        executed: true,
        densitySatisfied:
          retained.artifact.w >= authored.raster.w && retained.artifact.h >= authored.raster.h,
      },
    };
  }
  try {
    const nodes: NodeDraft[] = [...density.nodes];
    let content: NodeReference = density.output;
    for (const [index, node] of branch.descendants.toReversed().entries()) {
      if (node.kind === "delta" && target.kind === "generate") continue;
      const parameters = node.parameters as Record<string, JsonValue>;
      const localKey = `refresh-placement-${index}`;
      nodes.push({
        localKey,
        kind: node.kind,
        recipeVersion: node.recipeVersion,
        parameters:
          node.kind === "transform" && node.recipeVersion === 2
            ? {
                ...parameters,
                frame: savedRenderFrame(
                  frameAtRaster(parseRenderFrame(parameters.frame), density.upscale.generated),
                ),
              }
            : parameters,
        inputs: [content],
      });
      content = { localKey };
    }
    const committed = await commitRevision(database, {
      photoId: request.photoId,
      expectedRevisionId: document.revisionId,
      outputPlan: "photographic",
      nodes,
      rootUpdates: [],
      artifacts: density.artifacts,
      executions: density.executions,
      layers: document.layers.map((layer) =>
        layer.id === selected.id ? layerDraft(layer, layer.z, content) : layerDraft(layer, layer.z),
      ),
    });
    const upscale = density.upscale;
    return {
      graph: {
        revision: committed.revisionId,
        layer: selected.id,
        outputNode: committed.roots.output! as `node_${string}`,
        renderHash: committed.renderHash! as `r_${string}`,
      },
      refreshed: {
        kind: target.kind,
        fromNode: target.id,
        node: target.kind === "generate" ? generation.nodeId : upscale.nodeId!,
      },
      generation: {
        node: generation.nodeId,
        provider: generation.provider,
        returned: generation.returnedDimensions,
        reused: target.kind !== "generate",
      },
      sourceContext,
      upscale: {
        ...upscale,
        node: upscale.nodeId,
        provider: upscale.provider,
        reused: upscaleReused,
      },
      compositeNode: committed.roots.output! as `node_${string}`,
      executions: [
        {
          kind: "generate" as const,
          node: generation.nodeId,
          provider: generation.provider,
          reused: target.kind !== "generate",
        },
        ...(upscale.nodeId && upscale.provider
          ? [
              {
                kind: "upscale" as const,
                node: upscale.nodeId,
                provider: upscale.provider,
                reused: upscaleReused,
              },
            ]
          : []),
      ],
      warnings: density.warnings,
    };
  } catch (error) {
    try {
      await failProviderImageAttempts(
        database,
        density.executions.flatMap((e) =>
          e.providerImageAttemptId ? [e.providerImageAttemptId] : [],
        ),
        error,
      );
    } catch {
      /* Preserve the publication error if attempt marking also fails. */
    }
    throw error;
  }
}
