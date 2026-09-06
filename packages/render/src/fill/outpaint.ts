import { PhotoctlError } from "@photoctl/protocol";
import { resampleDisplaySrgbRegion } from "@photoctl/img";
import { evaluateGraphNode } from "../graph/evaluator.js";
import { loadBaseProjection } from "../graph/projection.js";
import { developFrame, savedRenderFrame, type RenderFrame } from "../graph/frame.js";
import {
  canvasExteriorMask,
  commitCanvasExpansion,
  prepareCanvasExpansion,
} from "../graph/canvas.js";
import { composeTransformMatrices, invertTransformMatrix } from "../transforms.js";
import {
  readArtifactImage,
  normalizeArtifact,
  normalizeMaskArtifact,
  publishArtifact,
} from "../artifacts/publication.js";
import { markupFreeOutputNode } from "../markup/graph.js";
import { prepareFillGeneration } from "./pipeline.js";
import type { GraphDatabase, NodeDraft } from "../graph/store.js";
import { prepareReferenceArtifact } from "./reference.js";
import { resolveFillFit } from "./fit.js";
import { renderSourceExecution, type Image16 } from "../source-render.js";
import { failProviderImageAttempts } from "../provider-images/attempts.js";

export async function outpaintCanvas(
  database: GraphDatabase,
  libraryPath: string,
  request: Parameters<typeof prepareFillGeneration>[2] & {
    prepared: Awaited<ReturnType<typeof prepareCanvasExpansion>>;
  },
) {
  const { prepared } = request;
  if (!prepared.changed)
    throw new PhotoctlError("usage", "Outpaint generation requires an expanded frame");
  const inputNodeId = prepared.document
    ? await markupFreeOutputNode(database, request.photoId, prepared.document.roots.output)
    : prepared.sourceDocument!.outputNodeId;
  const inputReference = prepared.sourceDocument?.output ?? { nodeId: inputNodeId };
  const evaluated = prepared.document
    ? await evaluateGraphNode({
        database,
        libraryPath,
        photoId: request.photoId,
        nodeId: inputNodeId,
        source: request.source,
      })
    : undefined;
  const inputArtifact =
    evaluated?.artifact ??
    (await (async () => {
      if (!request.source) throw new Error("Outpaint requires a photographic source");
      const produced =
        typeof request.source === "function"
          ? await request.source()
          : await renderSourceExecution(
              request.source.orientation,
              request.source.imageSource,
              request.source.locator,
            );
      return await publishArtifact(libraryPath, await normalizeArtifact(produced.image));
    })());
  const input = await readArtifactImage(inputArtifact.path, inputArtifact.artifactHash);
  const inputFrame = evaluated
    ? await loadBaseProjection(database, request.photoId, evaluated)
    : developFrame(prepared.inputFrame.catalog, input);
  const { base, outputToInput } = prepareOutpaintPixels(input, inputFrame, prepared.frame);
  const { w, h } = prepared.frame.raster;
  const mask = canvasExteriorMask(prepared);
  const crop = { x: 0, y: 0, w, h };
  const reference = request.referenceImage
    ? await prepareReferenceArtifact(libraryPath, request.referenceImage)
    : undefined;
  const { generation, density, sourceContext } = await prepareFillGeneration(
    database,
    libraryPath,
    request,
    {
      base,
      mask,
      crop,
      fit: resolveFillFit("prompt", "strict"),
      inputNodeId,
      inputReference,
      inputArtifactHash: inputArtifact.artifactHash,
      reference,
      intent: {
        outpaint: {
          input_frame: savedRenderFrame(prepared.inputFrame),
          output_frame: savedRenderFrame(prepared.frame),
          input_stages: prepared.inputStages,
          predecessor_layer_ids: prepared.document?.layers.map(({ id }) => id) ?? [],
        },
      },
    },
  );
  try {
    const permanentMask = await publishArtifact(libraryPath, await normalizeMaskArtifact(mask));
    const nodes: NodeDraft[] = [
      ...density.nodes,
      {
        localKey: "outpaint-mask",
        kind: "mask",
        recipeVersion: 1,
        parameters: { artifact_hash: permanentMask.artifactHash },
        inputs: [],
      },
      {
        localKey: "outpaint-base",
        kind: "resample",
        recipeVersion: 2,
        parameters: { w, h, kernel: "lanczos3", matrix: [...invertTransformMatrix(outputToInput)] },
        inputs: [inputReference],
      },
      {
        localKey: "outpaint-resample",
        kind: "resample",
        recipeVersion: 1,
        parameters: { w, h, kernel: "lanczos3", target: crop },
        inputs: [density.output],
      },
      {
        localKey: "outpaint-composite",
        kind: "mask_composite",
        recipeVersion: 2,
        parameters: { feather: 0, mask_space: "intrinsic" },
        inputs: [
          { localKey: "outpaint-base" },
          { localKey: "outpaint-resample" },
          { localKey: "outpaint-mask" },
        ],
      },
    ];
    const committed = await commitCanvasExpansion(database, libraryPath, {
      prepared,
      content: { localKey: "outpaint-composite" },
      nodes,
      artifacts: [...density.artifacts, ...(!evaluated ? [inputArtifact] : [])],
      exteriorMask: permanentMask,
      executions: density.executions,
    });
    if (!committed.changed) throw new Error("Prepared expansion unexpectedly became a no-op");
    return {
      revisionId: committed.revisionId,
      layerId: committed.layerId,
      outputNodeId: committed.outputNodeId,
      renderHash: committed.renderHash,
      generationNodeId: generation.nodeId,
      compositeNodeId: committed.contentNodeId,
      returnedDimensions: generation.returnedDimensions,
      sourceContext,
      upscale: density.upscale,
      crop,
      warnings: density.warnings,
      executions: [
        {
          kind: "generate" as const,
          nodeId: generation.nodeId,
          provider: generation.provider,
          reused: false,
        },
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
    };
  } catch (error) {
    try {
      await failProviderImageAttempts(
        database,
        density.executions.flatMap((execution) =>
          execution.providerImageAttemptId ? [execution.providerImageAttemptId] : [],
        ),
        error,
      );
    } catch {
      /* Preserve the primary diagnostic when the catalog is unavailable. */
    }
    throw error;
  }
}

export function prepareOutpaintPixels(
  input: Image16,
  inputFrame: RenderFrame,
  outputFrame: RenderFrame,
) {
  const outputToInput = composeTransformMatrices(inputFrame.baseToRaster, outputFrame.rasterToBase);
  const { w, h } = outputFrame.raster;
  return {
    outputToInput,
    base: {
      ...input,
      w,
      h,
      data: resampleDisplaySrgbRegion(
        input.data,
        input.w,
        input.h,
        0,
        0,
        w,
        h,
        w,
        h,
        outputToInput,
      ),
    },
  };
}
