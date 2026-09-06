/* eslint-disable no-await-in-loop -- Ordered execution inputs are registered sequentially in one transaction. */
import { applyEffectiveMask, effectiveMaskParametersSchema } from "../mask-operations.js";
import type { SourceTreatment } from "@photoctl/protocol";
import {
  artifactPath,
  MASK_ARTIFACT_MEDIA_TYPE,
  normalizeArtifact,
  normalizeMaskArtifact,
  normalizeValidatedArtifactBytes,
  publishArtifact,
  registerPublishedArtifact,
  readArtifactBytes,
  readArtifactBytesForNativeDevelop,
  readArtifactLinear,
  readArtifactMask,
  readMaskArtifactBytes,
  type NormalizedArtifact,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import {
  deterministicExecutionId,
  evaluationHash,
  imageNodeRegistry,
  newExecutionId,
  renderHashForNode,
  resampleParametersSchema,
  resampleV1ParametersSchema,
} from "./recipes.js";
import type { ImageNodeKind, JsonValue, SourceExecutionProvenance } from "./types.js";
import type { ExternalExecutionProvenance } from "./types.js";
import { PhotoctlError, warningCodes, type ProviderEvent } from "@photoctl/protocol";
import { z } from "zod";
import { renderSourceExecution } from "../source-render.js";
import type { ExifOrientation } from "../coordinates.js";
import type { ImageSource, LinearImage } from "../decoder.js";
import type { Image16 } from "../source-render.js";
import type { GraphDatabase, GraphTransaction } from "./store.js";
import { applyDevelopArtifact, applyDevelopDeltaArtifact } from "../develop/pixels.js";
import { developDictSchema } from "../develop/dict.js";
import {
  frameForNode,
  savedRenderFrame,
  parseRenderFrame,
  realizeCanvasFrame,
  frameSamplingDensity,
  type RenderFrame,
} from "./frame.js";
import { canvasCompositeSchema, readCanvasPlan } from "./output.js";
import {
  compositeMaskedPixels,
  featherMask,
  healPixels,
  resamplePixels,
  solidRgbPixels,
  transformMaskPixels,
  transformPixels,
} from "@photoctl/img";
import type { MaskImage } from "../mask-tiff.js";
import { drawMarkup, scaleMarkupDocument } from "../markup/flatten.js";
import { markupDocumentSchema } from "@photoctl/protocol";
import {
  loadBaseProjection,
  projectMaskToRender,
  projectRgbToRender,
  projectSupportedRgbToRender,
  projectCoverageBetweenFrames,
  supportCoverage,
  clipCoverageToFrames,
  loadLogicalFrame,
  readFramedMaskInput,
  projectCoverageThroughFrames,
  projectCanvasLayerMask,
} from "./projection.js";

export interface EvaluatedNode {
  artifact: PublishedArtifact;
  evaluationHash: string;
  executionId: string;
  reused: boolean;
  sourceTier?: ImageSource["kind"];
  sourceTreatment: SourceTreatment | null;
}

export class SourceEvaluationError extends Error {
  constructor(cause: unknown) {
    super("Source bytes could not be decoded", { cause });
  }
}

export interface PixelOperationInput {
  artifact: PublishedArtifact;
  evaluationHash: string;
  executionId: string;
}

export interface EvaluateGraphNodeRequest {
  database: GraphDatabase;
  libraryPath: string;
  photoId: string;
  nodeId: string;
  executionId?: string;
  developBaseDimensions?: { w: number; h: number };
  source?:
    | (() => Promise<{ image: LinearImage; provenance: SourceExecutionProvenance }>)
    | {
        orientation: ExifOrientation;
        imageSource: ImageSource;
        locator: SourceExecutionProvenance["locator"];
      };
  operations?: Partial<
    Record<
      Exclude<ImageNodeKind, "source" | "output">,
      (input: {
        nodeId: string;
        parameters: JsonValue;
        inputs: PixelOperationInput[];
      }) => Promise<
        | LinearImage
        | Image16
        | MaskImage
        | { image: LinearImage | Image16; externalExecution: ExternalExecutionProvenance }
      >
    >
  >;
  hooks?: {
    beforePublish?: () => void | Promise<void>;
    beforeCommit?: () => void | Promise<void>;
  };
  emit?: (event: ProviderEvent) => void | Promise<void>;
}

export async function evaluateGraphNode(request: EvaluateGraphNodeRequest): Promise<EvaluatedNode> {
  return await evaluateGraph(request, false);
}

/** Rebuild deterministic descendants from verified retained nodes; no source or provider callbacks. */
export async function evaluateRetainedGraphNode(
  request: Pick<EvaluateGraphNodeRequest, "database" | "libraryPath" | "photoId" | "nodeId">,
): Promise<EvaluatedNode> {
  const { database, libraryPath, photoId, nodeId } = request;
  return await evaluateGraph({ database, libraryPath, photoId, nodeId }, true);
}

async function evaluateGraph(
  request: EvaluateGraphNodeRequest,
  retainedOnly: boolean,
): Promise<EvaluatedNode> {
  const memo = new Map<string, Promise<EvaluatedNode>>();
  const evaluate = async (nodeId: string): Promise<EvaluatedNode> => {
    let pending = memo.get(nodeId);
    if (!pending) {
      pending = evaluateOne(
        request,
        nodeId,
        evaluate,
        nodeId === request.nodeId ? request.executionId : undefined,
        retainedOnly,
      );
      memo.set(nodeId, pending);
    }
    return await pending;
  };
  return await evaluate(request.nodeId);
}

/** Authored photographic support; only deterministic mask caches may be materialized. */
export async function readPhotographicSupport(
  request: Pick<EvaluateGraphNodeRequest, "database" | "libraryPath" | "photoId" | "nodeId">,
): Promise<{ frame: RenderFrame; mask: MaskImage }> {
  const plan = await readCanvasPlan(request.database, request.photoId, request.nodeId);
  const frame = plan
    ? parseRenderFrame(plan.frame)
    : await loadLogicalFrame(request.database, request.photoId, request.nodeId);
  if (!plan)
    return {
      frame,
      mask: { ...frame.raster, data: new Float32Array(frame.raster.w * frame.raster.h).fill(1) },
    };
  const inputs = (
    await request.database.query<{ input_node_id: string }>(
      "SELECT input_node_id FROM image_node_inputs WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index",
      [request.photoId, request.nodeId],
    )
  ).rows;
  const base = await loadLogicalFrame(request.database, request.photoId, inputs[0]!.input_node_id);
  const stages = [...plan.base_stages, ...plan.viewport_stages, plan.frame].map(parseRenderFrame);
  const mask = clipCoverageToFrames(
    await projectCoverageThroughFrames(
      { ...base.raster, data: new Float32Array(base.raster.w * base.raster.h).fill(1) },
      base,
      stages,
    ),
    frame,
    [base, ...stages],
  );
  let uncovered = mask.data.reduce((count, value) => count + Number(value <= 0), 0);
  for (const [index, layer] of plan.layers.entries()) {
    if (!uncovered) break;
    if (layer.opacity <= 0) continue;
    const contentFrame = layer.frame
      ? parseRenderFrame(layer.frame)
      : await loadLogicalFrame(
          request.database,
          request.photoId,
          inputs[1 + index * 2]!.input_node_id,
        );
    const input = await evaluateGraphNode({
      ...request,
      nodeId: inputs[2 + index * 2]!.input_node_id,
    });
    const coverage = await projectCanvasLayerMask(
      request,
      input,
      contentFrame,
      layer,
      plan,
      parseRenderFrame,
    );
    for (let pixel = 0; pixel < mask.data.length; pixel++) {
      if (mask.data[pixel]! <= 0 && coverage.data[pixel]! > 0) {
        mask.data[pixel] = 1;
        uncovered--;
      }
    }
  }
  return { frame, mask };
}

/** The full immutable output recipe fixes intent; each execution owns its realized sampling frame. */
export async function readRetainedGraphOutput(
  request: Pick<EvaluateGraphNodeRequest, "database" | "libraryPath" | "photoId" | "nodeId"> & {
    minimumSource?: { dimensions: RenderFrame["source"]; tier: ImageSource["kind"] };
  },
): Promise<(Omit<EvaluatedNode, "reused"> & { frame: RenderFrame }) | undefined> {
  let cursor: string | null = null;
  for (;;) {
    type RetainedOutput = {
      execution_id: string;
      render_frame: JsonValue;
      catalog_w: number;
      catalog_h: number;
    };
    const rows: RetainedOutput[] = (
      await request.database.query<RetainedOutput>(
        `WITH policy AS (
           SELECT ARRAY['pinned-preview', 'online-jpeg-range', 'online-file']::text[] AS tiers
         ), ranked AS (
         SELECT execution.execution_id, execution.render_frame, artifact.artifact_available,
           photo.w AS catalog_w, photo.h AS catalog_h,
           COALESCE(array_position(policy.tiers, execution.render_source_tier), 0) AS source_priority,
           LEAST($5::numeric / photo.w, $6::numeric / photo.h) AS minimum_density,
           array_position(policy.tiers, $7::text) AS minimum_priority,
           LEAST((execution.render_frame->'source'->>'w')::numeric / photo.w,
                 (execution.render_frame->'source'->>'h')::numeric / photo.h) AS source_density,
           artifact.w::bigint * artifact.h AS raster_pixels
         FROM node_executions execution
         JOIN image_artifacts artifact ON artifact.artifact_hash = execution.output_artifact_hash
         JOIN photos photo ON photo.id = execution.photo_id
         CROSS JOIN policy
         WHERE execution.photo_id = $1 AND execution.node_id = $2
           AND execution.render_frame IS NOT NULL AND artifact.media_type = 'image/tiff'
           AND execution.render_identity = $4
       )
       SELECT execution_id, render_frame, catalog_w, catalog_h FROM ranked
       WHERE artifact_available
         AND ($5::numeric IS NULL OR (source_density, source_priority) >= (minimum_density, minimum_priority))
         AND ($3::text IS NULL OR
         (source_density, source_priority, raster_pixels, execution_id) <
         (SELECT source_density, source_priority, raster_pixels, execution_id FROM ranked WHERE execution_id = $3))
       ORDER BY source_density DESC, source_priority DESC, raster_pixels DESC, execution_id DESC LIMIT 16`,
        [
          request.photoId,
          request.nodeId,
          cursor,
          renderHashForNode(request.nodeId),
          request.minimumSource?.dimensions.w ?? null,
          request.minimumSource?.dimensions.h ?? null,
          request.minimumSource?.tier ?? null,
        ],
      )
    ).rows;
    if (rows.length === 0) return undefined;
    for (const row of rows) {
      cursor = row.execution_id;
      const frame = parseRenderFrame(row.render_frame);
      if (frame.catalog.w !== row.catalog_w || frame.catalog.h !== row.catalog_h) continue;
      const retained = await loadByExecutionId(
        request.database,
        request.libraryPath,
        request.photoId,
        row.execution_id,
        request.nodeId,
      );
      if (
        retained &&
        frame.raster.w === retained.artifact.w &&
        frame.raster.h === retained.artifact.h
      )
        return { ...retained, frame };
    }
  }
}

async function evaluateOne(
  request: EvaluateGraphNodeRequest,
  nodeId: string,
  evaluate: (nodeId: string) => Promise<EvaluatedNode>,
  requestedExecutionId: string | undefined,
  retainedOnly: boolean,
): Promise<EvaluatedNode> {
  const node = await loadNode(request.database, request.photoId, nodeId);
  const deterministic = imageNodeRegistry[node.kind].deterministic;
  if (!deterministic && !requestedExecutionId) {
    const pinnedExecutionId =
      node.parameters &&
      typeof node.parameters === "object" &&
      !Array.isArray(node.parameters) &&
      typeof node.parameters.request === "object" &&
      node.parameters.request !== null &&
      !Array.isArray(node.parameters.request) &&
      typeof node.parameters.request.execution_id === "string"
        ? node.parameters.request.execution_id
        : undefined;
    if (pinnedExecutionId) {
      const pinned = await loadByExecutionId(
        request.database,
        request.libraryPath,
        request.photoId,
        pinnedExecutionId,
        nodeId,
      );
      if (pinned) return { ...pinned, reused: true };
      throw new PhotoctlError(
        "file_offline",
        `Pinned external artifact is unavailable: ${pinnedExecutionId}`,
        {
          id: request.photoId,
          node_id: nodeId,
          execution_id: pinnedExecutionId,
          reason: "retained_artifact_unavailable",
        },
      );
    }
  }
  if (!deterministic && requestedExecutionId) {
    if (!/^exec_[0-9a-f]{64}$/.test(requestedExecutionId)) {
      throw new Error("Expected exec_ followed by a full SHA-256 hash");
    }
    const retry = await loadByExecutionId(
      request.database,
      request.libraryPath,
      request.photoId,
      requestedExecutionId,
      nodeId,
    );
    if (retry) return { ...retry, reused: true };
    const exists = await request.database.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM node_executions WHERE photo_id = $1 AND execution_id = $2
       ) AS exists`,
      [request.photoId, requestedExecutionId],
    );
    if (exists.rows[0]?.exists) {
      throw new PhotoctlError(
        "file_offline",
        `Execution artifact is unavailable: ${requestedExecutionId}`,
        {
          id: request.photoId,
          node_id: nodeId,
          execution_id: requestedExecutionId,
          reason: "retained_artifact_unavailable",
        },
      );
    }
  }
  if (retainedOnly && deterministic) {
    const retained = await readRetainedGraphOutput({ ...request, nodeId });
    if (retained) return { ...retained, reused: true };
    if (node.kind === "source" && node.recipeVersion === 1)
      throw new SourceEvaluationError(
        new Error("No verified retained source execution is available"),
      );
  }
  const inputs = await Promise.all(node.inputNodeIds.map(evaluate));
  let source: { image: LinearImage; provenance: SourceExecutionProvenance } | undefined;
  let normalizedSource: Awaited<ReturnType<typeof normalizeArtifact>> | undefined;
  if (node.kind === "source" && node.recipeVersion === 1) {
    if (!request.source) throw new Error("Source graph evaluation requires a source producer");
    try {
      if (typeof request.source === "function") {
        source = await request.source();
      } else {
        source = await renderSourceExecution(
          request.source.orientation,
          request.source.imageSource,
          request.source.locator,
        );
      }
    } catch (error) {
      throw new SourceEvaluationError(error);
    }
    normalizedSource = await normalizeArtifact(source.image);
  }
  const inputFrames = await Promise.all(
    inputs.map(async (input) => await loadBaseProjection(request.database, request.photoId, input)),
  );
  const evaluation = evaluationHash({
    nodeRecipeHash: node.recipeHash,
    kind: node.kind,
    recipeVersion: node.recipeVersion,
    inputArtifactHashes: inputs.map((input) => input.artifact.artifactHash),
    inputFrames: inputFrames.map((frame) => savedRenderFrame(frame)),
    inputTreatments: inputs.map((input) => input.sourceTreatment),
    source:
      source && normalizedSource
        ? { ...source.provenance, outputArtifactHash: normalizedSource.artifactHash }
        : undefined,
  });
  if (deterministic) {
    const reused = await loadByEvaluation(
      request.database,
      request.libraryPath,
      request.photoId,
      nodeId,
      evaluation,
    );
    if (reused) return { ...reused, reused: true };
  }

  const executionId = deterministic
    ? deterministicExecutionId(evaluation)
    : (requestedExecutionId ?? newExecutionId());
  let artifact: PublishedArtifact;
  let externalExecution: ExternalExecutionProvenance | undefined;
  if (node.kind === "output" || (node.kind === "transform" && node.recipeVersion === 2)) {
    if (inputs.length !== 1)
      throw new Error("Raster-preserving evaluation requires one input artifact");
    artifact = inputs[0].artifact;
  } else if (
    (node.kind === "mask" && node.recipeVersion === 1) ||
    (node.kind === "source" && node.recipeVersion === 2)
  ) {
    artifact = await loadPinnedArtifact(
      request.database,
      request.libraryPath,
      node.parameters,
      node.kind === "mask" ? MASK_ARTIFACT_MEDIA_TYPE : "image/tiff",
    );
  } else {
    const operation =
      node.kind === "source"
        ? undefined
        : await runOperation(
            request,
            node.kind,
            node.recipeVersion,
            nodeId,
            node.parameters,
            inputs,
          );
    externalExecution = operation?.externalExecution;
    if (externalExecution) {
      if (node.kind !== "generate" && node.kind !== "upscale") {
        throw new Error(`Provider execution is not valid for ${node.kind}`);
      }
      await request.emit?.({
        event: "provider",
        execution_id: executionId,
        node_kind: node.kind,
        adapter: externalExecution.adapter,
        service: externalExecution.service,
        model: externalExecution.model,
        input_px: externalExecution.inputPx,
        target_px: externalExecution.targetPx,
        attempt: externalExecution.attempt,
      });
    }
    let normalized: NormalizedArtifact;
    if (node.kind === "source") normalized = normalizedSource!;
    else if (!operation) throw new Error(`Pixel operation did not produce output for ${node.kind}`);
    else if ("artifact" in operation) normalized = operation.artifact;
    else if ("space" in operation.image) normalized = await normalizeArtifact(operation.image);
    else normalized = await normalizeMaskArtifact(operation.image);
    assertOperationArtifactType(node.kind, normalized, inputs);
    await request.hooks?.beforePublish?.();
    artifact = await publishArtifact(request.libraryPath, normalized);
  }
  await request.hooks?.beforeCommit?.();
  const photo = await request.database.query<{ w: number; h: number }>(
    "SELECT w, h FROM photos WHERE id = $1",
    [request.photoId],
  );
  const frame = frameForNode(node.kind, node.parameters, photo.rows[0]!, artifact, inputFrames[0]);
  const inputTier = inputs[0]?.sourceTier;
  const sourceTreatment = source?.provenance.treatment ?? inputs[0]?.sourceTreatment ?? null;
  const stored = await request.database.transaction(async (transaction) => {
    await registerPublishedArtifact(transaction, artifact);
    await transaction.query(
      `INSERT INTO node_executions (
         photo_id, execution_id, node_id, evaluation_hash, deterministic,
         output_artifact_hash, source_locator, source_tier, source_w, source_h,
         decoder_id, decoder_version, provider_execution, render_frame, render_identity, render_source_tier, source_treatment
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16, $17::jsonb)
       ON CONFLICT (photo_id, execution_id) DO NOTHING`,
      [
        request.photoId,
        executionId,
        nodeId,
        evaluation,
        deterministic,
        artifact.artifactHash,
        source ? JSON.stringify(source.provenance.locator) : null,
        source?.provenance.tier ?? null,
        source?.provenance.w ?? null,
        source?.provenance.h ?? null,
        source?.provenance.decoderId ?? null,
        source?.provenance.decoderVersion ?? null,
        externalExecution ? JSON.stringify(storeExternalExecution(externalExecution)) : null,
        JSON.stringify(savedRenderFrame(frame)),
        renderHashForNode(nodeId),
        source?.provenance.tier ?? inputTier ?? null,
        sourceTreatment ? JSON.stringify(sourceTreatment) : null,
      ],
    );
    for (const [index, input] of inputs.entries()) {
      await transaction.query(
        `INSERT INTO node_execution_inputs
           (photo_id, execution_id, input_index, input_artifact_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (photo_id, execution_id, input_index) DO NOTHING`,
        [request.photoId, executionId, index, input.artifact.artifactHash],
      );
    }
    return await loadByExecutionId(
      transaction,
      request.libraryPath,
      request.photoId,
      executionId,
      nodeId,
    );
  });
  if (!stored) throw new Error(`Execution commit failed: ${executionId}`);
  if (
    stored.evaluationHash !== evaluation ||
    stored.artifact.artifactHash !== artifact.artifactHash
  ) {
    throw new Error(`Execution identity collision: ${executionId}`);
  }
  return { ...stored, reused: false };
}

function assertOperationArtifactType(
  kind: ImageNodeKind,
  artifact: NormalizedArtifact,
  inputs: EvaluatedNode[],
): void {
  const expected =
    kind === "transform" || kind === "resample" || kind === "crop" || kind === "mask"
      ? inputs[0]?.artifact.mediaType
      : "image/tiff";
  if (artifact.mediaType !== expected) {
    throw new Error(`${kind} produced an artifact with the wrong pixel media type`);
  }
}

async function runOperation(
  request: EvaluateGraphNodeRequest,
  kind: Exclude<ImageNodeKind, "source" | "output">,
  recipeVersion: number,
  nodeId: string,
  parameters: JsonValue,
  inputs: EvaluatedNode[],
): Promise<
  | { image: LinearImage | Image16 | MaskImage; externalExecution?: ExternalExecutionProvenance }
  | { artifact: NormalizedArtifact; externalExecution?: undefined }
> {
  const operation = request.operations?.[kind];
  if (!operation) {
    if (kind === "mask" && recipeVersion === 2) {
      const input = inputs[0]!.artifact;
      return {
        image: await applyEffectiveMask(
          await readArtifactMask(input.path, input.artifactHash),
          effectiveMaskParametersSchema.parse(parameters),
        ),
      };
    }
    if (kind === "develop" || kind === "delta") {
      if (inputs.length !== 1) throw new Error("Develop evaluation requires one input artifact");
      const input = inputs[0].artifact;
      const bytes = await readArtifactBytesForNativeDevelop(input.path, input.artifactHash, {
        w: input.w,
        h: input.h,
      });
      const parsed = developDictSchema.parse(parameters);
      const authoredDimensions =
        request.developBaseDimensions ??
        (kind === "develop"
          ? (
              await request.database.query<{ w: number; h: number }>(
                "SELECT w, h FROM photos WHERE id = $1",
                [request.photoId],
              )
            ).rows[0]
          : undefined);
      const developed =
        kind === "develop"
          ? await applyDevelopArtifact(
              bytes,
              { w: input.w, h: input.h },
              parsed,
              authoredDimensions,
            )
          : await applyDevelopDeltaArtifact(bytes, { w: input.w, h: input.h }, parsed);
      return {
        artifact: await normalizeValidatedArtifactBytes(developed.bytes, {
          w: developed.w,
          h: developed.h,
        }),
      };
    }
    if (kind === "mask_composite") {
      return { image: await evaluateMaskComposite(request, parameters, inputs) };
    }
    if (kind === "heal") {
      if (inputs.length !== 2) throw new Error("Heal evaluation requires RGB and mask inputs");
      const image = await readRgbInput(inputs[0]!);
      const imageFrame = await loadBaseProjection(request.database, request.photoId, inputs[0]!);
      const maskInput = await readFramedMaskInput(request, inputs[1]!);
      const mask = await projectCoverageBetweenFrames(
        maskInput.mask,
        maskInput.frame,
        imageFrame,
        image,
      );
      const parsed = imageNodeRegistry.heal.parameters.parse(parameters);
      return {
        image: linearImage(
          image,
          await healPixels(
            image.data,
            mask.data,
            image.w,
            image.h,
            parsed.neighborhood_radius as number,
            parsed.refinement_iterations as number,
            parsed.refinement_pixel_budget as number,
          ),
        ),
      };
    }
    if (kind === "markup") {
      if (inputs.length !== 1) throw new Error("Markup evaluation requires one RGB input");
      const image = await readRgbInput(inputs[0]!);
      const parsed = imageNodeRegistry.markup.parameters.parse(parameters);
      const projection = await loadBaseProjection(request.database, request.photoId, inputs[0]!);
      return {
        image: await drawMarkup(
          image,
          scaleMarkupDocument(markupDocumentSchema.parse(parsed.document), projection.catalog, {
            w: projection.source.w,
            h: projection.source.h,
          }),
          projection,
        ),
      };
    }
    if (kind === "solid") {
      return { image: await evaluateSolid(parameters) };
    }
    if (kind === "resample") {
      return { image: await evaluateResample(parameters, inputs, recipeVersion) };
    }
    if (kind === "composite" && recipeVersion === 2) {
      const projection = await loadBaseProjection(request.database, request.photoId, inputs[0]!);
      return { image: await evaluateCompositeV2(request, parameters, inputs, projection) };
    }
    if (kind === "composite" && recipeVersion === 3) {
      return { image: await evaluateCanvasComposite(request, parameters, inputs) };
    }
    if (kind === "transform") {
      if (!inputs[0]) throw new Error("Transform evaluation requires one input artifact");
      return {
        image:
          inputs[0].artifact.mediaType === MASK_ARTIFACT_MEDIA_TYPE
            ? await evaluateMaskTransform(parameters, inputs[0])
            : await evaluateRgbTransform(parameters, inputs[0]),
      };
    }
    throw new Error(`No pixel evaluator is registered for ${kind}`);
  }
  const result = await operation({ nodeId, parameters, inputs });
  if ("image" in result) {
    const externalExecution = externalExecutionSchema.parse(result.externalExecution);
    if (kind === "generate" || kind === "upscale") {
      assertExternalExecutionMatchesRecipe(kind, parameters, externalExecution);
    }
    return {
      image: result.image,
      externalExecution,
    };
  }
  if (kind === "generate" || kind === "upscale") {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)} evaluation requires provider execution provenance`,
    );
  }
  return { image: result };
}

async function evaluateResample(
  parameters: JsonValue,
  inputs: EvaluatedNode[],
  recipeVersion: number,
): Promise<LinearImage> {
  if (inputs.length !== 1) throw new Error("Resample evaluation requires one input artifact");
  const image = await readRgbInput(inputs[0]);
  if (recipeVersion === 2) {
    const parsed = resampleParametersSchema.parse(parameters);
    return {
      ...image,
      w: parsed.w,
      h: parsed.h,
      data: await transformPixels(
        image.data,
        image.w,
        image.h,
        3,
        parsed.w,
        parsed.h,
        parsed.matrix,
        parsed.kernel,
      ),
    };
  }
  const parsed = resampleV1ParametersSchema.parse(parameters);
  if (!parsed.target && image.w === parsed.w && image.h === parsed.h)
    return linearImage(image, new Float32Array(image.data));
  if (parsed.kernel === "nearest" || parsed.kernel === "bicubic") {
    throw new Error(`The ${parsed.kernel} graph resample kernel is not implemented`);
  }
  if (parsed.target) {
    const target = parsed.target;
    return {
      ...image,
      w: parsed.w,
      h: parsed.h,
      data: await transformPixels(
        image.data,
        image.w,
        image.h,
        3,
        parsed.w,
        parsed.h,
        [target.w / image.w, 0, 0, target.h / image.h, target.x, target.y],
        parsed.kernel,
      ),
    };
  }
  return {
    ...image,
    w: parsed.w,
    h: parsed.h,
    data: await resamplePixels(image.data, image.w, image.h, 3, parsed.w, parsed.h, parsed.kernel),
  };
}

async function evaluateSolid(parameters: JsonValue): Promise<LinearImage> {
  const parsed = z
    .object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
      space: z.literal("scene-linear-rec2020"),
      rgb: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    })
    .strict()
    .parse(parameters);
  const data = await solidRgbPixels(parsed.w, parsed.h, parsed.rgb);
  return {
    w: parsed.w,
    h: parsed.h,
    orientationApplied: true,
    space: parsed.space,
    data,
    whiteLevel: 1,
    blackLevel: 0,
    wbPreApplied: true,
  };
}

async function evaluateMaskComposite(
  request: EvaluateGraphNodeRequest,
  parameters: JsonValue,
  inputs: EvaluatedNode[],
): Promise<LinearImage> {
  if (inputs.length !== 3)
    throw new Error("Mask composite evaluation requires base, content, and mask artifacts");
  const base = await readRgbInput(inputs[0]);
  const projection = await loadBaseProjection(request.database, request.photoId, inputs[0]!);
  const contentProjection = await loadBaseProjection(request.database, request.photoId, inputs[1]!);
  const content = await projectRgbToRender(
    await readRgbInput(inputs[1]),
    contentProjection,
    projection,
    base,
  );
  const parsed = imageNodeRegistry.mask_composite.parameters.parse(parameters);
  let mask = await projectMaskToRender(
    await readMaskInput(inputs[2], projection.catalog),
    projection,
    base,
  );
  const feather = parsed.feather as number;
  if (feather > 0) mask = { ...mask, data: await featherMask(mask.data, mask.w, mask.h, feather) };
  return linearImage(
    base,
    await compositeMaskedPixels(base.data, content.data, mask.data, base.w, base.h, 1),
  );
}

async function evaluateCompositeV2(
  request: EvaluateGraphNodeRequest,
  parameters: JsonValue,
  inputs: EvaluatedNode[],
  projection: Awaited<ReturnType<typeof loadBaseProjection>>,
): Promise<LinearImage> {
  const parsed = z
    .object({
      layers: z.array(
        z.object({ opacity: z.number().min(0).max(1), blend: z.literal("normal") }).strict(),
      ),
    })
    .strict()
    .parse(parameters);
  if (inputs.length !== 1 + parsed.layers.length * 2) {
    throw new Error("Composite v2 inputs do not match its ordered layer parameters");
  }
  const base = await readRgbInput(inputs[0]);
  let pixels = base.data;
  for (const [index, layer] of parsed.layers.entries()) {
    const contentInput = inputs[1 + index * 2]!;
    const contentProjection = await loadBaseProjection(
      request.database,
      request.photoId,
      contentInput,
    );
    const content = await projectRgbToRender(
      await readRgbInput(contentInput),
      contentProjection,
      projection,
      base,
    );
    const maskInput = inputs[2 + index * 2]!;
    const coverage = await supportCoverage(request, maskInput);
    const framedMask = await readFramedMaskInput(request, maskInput, coverage);
    const projectedMask = coverage
      ? await projectCoverageBetweenFrames(
          await projectCoverageBetweenFrames(
            framedMask.mask,
            framedMask.frame,
            contentProjection,
            contentInput.artifact,
          ),
          contentProjection,
          projection,
          base,
        )
      : await projectCoverageBetweenFrames(framedMask.mask, framedMask.frame, projection, base);
    const supported = await clipCoverageToFrames(projectedMask, projection, [
      framedMask.frame,
      contentProjection,
    ]);
    const mask = coverage
      ? await applyEffectiveMask(supported, { operation: "support" })
      : supported;
    pixels = await compositeMaskedPixels(
      pixels,
      content.data,
      mask.data,
      base.w,
      base.h,
      layer.opacity,
    );
  }
  return linearImage(base, pixels);
}

async function evaluateCanvasComposite(
  request: EvaluateGraphNodeRequest,
  parameters: JsonValue,
  inputs: EvaluatedNode[],
): Promise<LinearImage> {
  const plan = canvasCompositeSchema.parse(parameters);
  const base = await readRgbInput(inputs[0]!);
  const baseFrame = await loadBaseProjection(request.database, request.photoId, inputs[0]!);
  const layerFrames = await Promise.all(
    plan.layers.map(async (layer, index) =>
      layer.frame
        ? parseRenderFrame(layer.frame)
        : await loadBaseProjection(request.database, request.photoId, inputs[1 + index * 2]!),
    ),
  );
  const sourceFrame = baseFrame;
  const projectLayerMask = async (
    index: number,
    realizeFrame: (saved: typeof plan.frame) => RenderFrame,
  ) => {
    return projectCanvasLayerMask(
      request,
      inputs[2 + index * 2]!,
      layerFrames[index]!,
      plan.layers[index]!,
      plan,
      realizeFrame,
    );
  };
  const authoredOutput = parseRenderFrame(plan.frame);
  const baseDensity = frameSamplingDensity(sourceFrame, authoredOutput);
  const candidates = layerFrames
    .map((frame, index) => ({
      index,
      density: Math.min(1, frameSamplingDensity(frame, authoredOutput)),
    }))
    .filter(({ index, density }) => plan.layers[index]!.opacity > 0 && density > baseDensity)
    .toSorted((left, right) => right.density - left.density);
  let selectedSupply: { index: number; mask: MaskImage } | undefined;
  for (const { index } of candidates) {
    const mask = await projectLayerMask(index, (saved) =>
      realizeCanvasFrame(parseRenderFrame(saved), sourceFrame, [layerFrames[index]!]),
    );
    if (mask.data.some((value) => value > 0)) {
      selectedSupply = { index, mask };
      break;
    }
  }
  const contributingLayers = selectedSupply ? [layerFrames[selectedSupply.index]!] : [];
  const realize = (saved: typeof plan.frame) =>
    realizeCanvasFrame(parseRenderFrame(saved), sourceFrame, contributingLayers);
  const output = realize(plan.frame);
  const baseStages = [...plan.base_stages, ...plan.viewport_stages];
  const projectedBase = await projectSupportedRgbToRender(
    base,
    baseFrame,
    baseStages.map(parseRenderFrame),
    authoredOutput,
    (frame) => realizeCanvasFrame(frame, sourceFrame, contributingLayers),
  );
  let pixels = projectedBase.data;
  for (const [index, layer] of plan.layers.entries()) {
    const contentInput = inputs[1 + index * 2]!;
    let content = await readRgbInput(contentInput);
    let frame: RenderFrame = layerFrames[index]!;
    const stages = [...layer.stages, ...plan.viewport_stages];
    const mask =
      selectedSupply?.index === index
        ? selectedSupply.mask
        : await projectLayerMask(index, realize);
    if (selectedSupply?.index === index) selectedSupply = undefined;
    for (const saved of [...stages, plan.frame]) {
      const target = realize(saved);
      content = await projectRgbToRender(content, frame, target, target.raster);
      frame = target;
    }
    pixels = await compositeMaskedPixels(
      pixels,
      content.data,
      mask.data,
      output.raster.w,
      output.raster.h,
      layer.opacity,
    );
  }
  return linearImage(projectedBase, pixels);
}

async function evaluateMaskTransform(
  parameters: JsonValue,
  input: EvaluatedNode,
): Promise<MaskImage> {
  const matrix = transformMatrix(parameters);
  const mask = await readArtifactMask(input.artifact.path, input.artifact.artifactHash);
  return {
    w: mask.w,
    h: mask.h,
    data: await transformMaskPixels(mask.data, mask.w, mask.h, mask.w, mask.h, matrix),
  };
}

async function evaluateRgbTransform(
  parameters: JsonValue,
  input: EvaluatedNode,
): Promise<LinearImage> {
  const matrix = transformMatrix(parameters);
  const image = await readRgbInput(input);
  return linearImage(
    image,
    await transformPixels(image.data, image.w, image.h, 3, image.w, image.h, matrix, "lanczos3"),
  );
}

function transformMatrix(parameters: JsonValue): [number, number, number, number, number, number] {
  return z
    .object({
      matrix: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
    })
    .strict()
    .parse(parameters).matrix;
}

async function readRgbInput(
  input: EvaluatedNode,
  dimensions?: { w: number; h: number },
): Promise<LinearImage> {
  if (input.artifact.mediaType !== "image/tiff") throw new Error("Expected an RGB artifact");
  const image = await readArtifactLinear(input.artifact.path, input.artifact.artifactHash);
  if (dimensions && (image.w !== dimensions.w || image.h !== dimensions.h)) {
    throw new Error("Composite RGB artifact dimensions do not match");
  }
  return image;
}

async function readMaskInput(
  input: EvaluatedNode,
  dimensions: { w: number; h: number },
): Promise<MaskImage> {
  if (input.artifact.mediaType !== MASK_ARTIFACT_MEDIA_TYPE)
    throw new Error("Expected a mask artifact");
  const mask = await readArtifactMask(input.artifact.path, input.artifact.artifactHash);
  if (mask.w !== dimensions.w || mask.h !== dimensions.h) {
    throw new Error("Composite mask artifact dimensions do not match");
  }
  return mask;
}

function linearImage(base: LinearImage, data: Float32Array): LinearImage {
  return { ...base, data };
}

async function loadPinnedArtifact(
  database: GraphTransaction,
  libraryPath: string,
  parameters: JsonValue,
  mediaType: PublishedArtifact["mediaType"],
): Promise<PublishedArtifact> {
  const artifactHash = z
    .object({ artifact_hash: z.string().regex(/^a_[0-9a-f]{64}$/) })
    .parse(parameters).artifact_hash;
  const result = await database.query<{
    media_type: string;
    bytes: string;
    w: number;
    h: number;
    artifact_available: boolean;
  }>(
    `SELECT media_type, bytes::text, w, h, artifact_available
     FROM image_artifacts WHERE artifact_hash = $1`,
    [artifactHash],
  );
  const row = result.rows[0];
  if (!row?.artifact_available || row.media_type !== mediaType) {
    throw new Error(`Pinned artifact is unavailable: ${artifactHash}`);
  }
  const path = artifactPath(libraryPath, artifactHash, "tif");
  try {
    if (mediaType === MASK_ARTIFACT_MEDIA_TYPE)
      await readMaskArtifactBytes(path, artifactHash, row);
    else await readArtifactBytes(path, artifactHash, row);
  } catch (error) {
    await database.query(
      "UPDATE image_artifacts SET artifact_available = false WHERE artifact_hash = $1",
      [artifactHash],
    );
    throw error;
  }
  return {
    artifactHash: artifactHash as `a_${string}`,
    extension: "tif",
    mediaType,
    validationProfile: mediaType === MASK_ARTIFACT_MEDIA_TYPE ? "mask-tiff" : "linear-rgb-tiff",
    path,
    storageBytes: Number(row.bytes),
    w: row.w,
    h: row.h,
  };
}

function assertExternalExecutionMatchesRecipe(
  kind: "generate" | "upscale",
  parameters: JsonValue,
  execution: ExternalExecutionProvenance,
): void {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error(`${kind} recipe parameters are invalid`);
  }
  if (
    execution.adapter !== parameters.adapter ||
    execution.adapterVersion !== parameters.adapter_version ||
    execution.model !== parameters.model ||
    execution.modelVersion !== parameters.model_version
  ) {
    throw new Error(`${kind} provider execution does not match its immutable recipe`);
  }
}

const externalExecutionSchema = z
  .object({
    adapter: z.string().min(1).max(256),
    adapterVersion: z.string().min(1).max(256).nullable(),
    service: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    modelVersion: z.string().min(1).max(256).nullable(),
    providerRequestId: z.string().min(1).max(256).nullable(),
    seed: z.number().int().safe().nullable(),
    durationMs: z.number().finite().nonnegative(),
    costUsd: z.number().finite().nonnegative(),
    inputPx: z.number().int().nonnegative(),
    targetPx: z.number().int().nonnegative(),
    attempt: z.number().int().positive().max(5),
    densityVerdict: z.enum(["satisfied", "limited", "not-applicable"]),
    warnings: z
      .array(z.object({ code: z.enum(warningCodes), message: z.string().max(1_024) }).strict())
      .max(16),
  })
  .strip();

function storeExternalExecution(execution: ExternalExecutionProvenance): JsonValue {
  return {
    adapter: execution.adapter,
    adapter_version: execution.adapterVersion,
    attempt: execution.attempt,
    cost_usd: execution.costUsd,
    density_verdict: execution.densityVerdict,
    duration_ms: execution.durationMs,
    input_px: execution.inputPx,
    model: execution.model,
    model_version: execution.modelVersion,
    provider_request_id: execution.providerRequestId,
    seed: execution.seed,
    service: execution.service,
    target_px: execution.targetPx,
    warnings: execution.warnings,
  };
}

async function loadNode(database: GraphTransaction, photoId: string, nodeId: string) {
  const rows = await database.query<{
    kind: ImageNodeKind;
    recipe_version: number;
    parameters: JsonValue;
    recipe_hash: string;
  }>(
    `SELECT kind, recipe_version, parameters, recipe_hash
     FROM image_nodes WHERE photo_id = $1 AND id = $2`,
    [photoId, nodeId],
  );
  const row = rows.rows[0];
  if (!row) throw new Error(`Graph node does not exist for photo: ${nodeId}`);
  const inputs = await database.query<{ input_node_id: string }>(
    `SELECT input_node_id FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [photoId, nodeId],
  );
  return {
    kind: row.kind,
    recipeVersion: row.recipe_version,
    parameters: row.parameters,
    recipeHash: row.recipe_hash,
    inputNodeIds: inputs.rows.map((input) => input.input_node_id),
  };
}

async function loadByEvaluation(
  database: GraphTransaction,
  libraryPath: string,
  photoId: string,
  nodeId: string,
  evaluation: string,
): Promise<Omit<EvaluatedNode, "reused"> | undefined> {
  const result = await database.query<{ execution_id: string }>(
    `SELECT execution_id FROM node_executions
     WHERE photo_id = $1 AND node_id = $2 AND evaluation_hash = $3 AND deterministic = true`,
    [photoId, nodeId, evaluation],
  );
  const executionId = result.rows[0]?.execution_id;
  return executionId
    ? await loadByExecutionId(database, libraryPath, photoId, executionId, nodeId)
    : undefined;
}

async function loadByExecutionId(
  database: GraphTransaction,
  libraryPath: string,
  photoId: string,
  executionId: string,
  expectedNodeId: string,
): Promise<Omit<EvaluatedNode, "reused"> | undefined> {
  const result = await database.query<{
    execution_id: string;
    node_id: string;
    evaluation_hash: string;
    output_artifact_hash: string;
    render_source_tier: ImageSource["kind"] | null;
    source_treatment: SourceTreatment | null;
    media_type: string;
    bytes: string;
    w: number;
    h: number;
    artifact_available: boolean;
  }>(
    `SELECT execution.execution_id, execution.node_id, execution.evaluation_hash,
       execution.output_artifact_hash, artifact.media_type, artifact.bytes::text,
       artifact.w, artifact.h, artifact.artifact_available, execution.render_source_tier, execution.source_treatment
     FROM node_executions AS execution
     JOIN image_artifacts AS artifact
       ON artifact.artifact_hash = execution.output_artifact_hash
     WHERE execution.photo_id = $1 AND execution.execution_id = $2`,
    [photoId, executionId],
  );
  const row = result.rows[0];
  if (row && row.node_id !== expectedNodeId) {
    throw new Error(`Execution identity collision: ${executionId}`);
  }
  if (!row || !row.artifact_available) return undefined;
  if (row.media_type !== "image/tiff" && row.media_type !== MASK_ARTIFACT_MEDIA_TYPE)
    throw new Error(`Unsupported artifact media type: ${row.media_type}`);
  const path = artifactPath(libraryPath, row.output_artifact_hash, "tif");
  try {
    if (row.media_type === MASK_ARTIFACT_MEDIA_TYPE) {
      await readMaskArtifactBytes(path, row.output_artifact_hash, { w: row.w, h: row.h });
    } else {
      await readArtifactBytes(path, row.output_artifact_hash, { w: row.w, h: row.h });
    }
  } catch {
    await database.query(
      "UPDATE image_artifacts SET artifact_available = false WHERE artifact_hash = $1",
      [row.output_artifact_hash],
    );
    return undefined;
  }
  return {
    artifact: {
      artifactHash: row.output_artifact_hash as `a_${string}`,
      extension: "tif",
      mediaType: row.media_type as PublishedArtifact["mediaType"],
      validationProfile:
        row.media_type === MASK_ARTIFACT_MEDIA_TYPE ? "mask-tiff" : "linear-rgb-tiff",
      path,
      storageBytes: Number(row.bytes),
      w: row.w,
      h: row.h,
    },
    evaluationHash: row.evaluation_hash,
    executionId: row.execution_id,
    sourceTreatment: row.source_treatment,
    ...(row.render_source_tier ? { sourceTier: row.render_source_tier } : {}),
  };
}
