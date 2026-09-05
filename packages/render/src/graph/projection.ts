import { clipMaskToFrame, transformMaskPixels, transformPixels } from "@photoctl/img";
import {
  artifactPath,
  readArtifactMask,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import type { LinearImage } from "../decoder.js";
import { frameForNode, parseRenderFrame, savedRenderFrame, type RenderFrame } from "./frame.js";
import { canonicalJson, imageNodeRegistry } from "./recipes.js";
import type { MaskImage } from "../mask-tiff.js";
import { composeTransformMatrices, invertTransformMatrix } from "../transforms.js";
import type { EvaluateGraphNodeRequest, EvaluatedNode } from "./evaluator.js";
import type { GraphTransaction } from "./store.js";
import type { JsonValue } from "./types.js";

/** Recipe-only inspection never borrows dimensions from an unrelated pixel execution. */
export async function loadLogicalFrame(
  database: GraphTransaction,
  photoId: string,
  nodeId: string,
) {
  const result = await database.query<{
    kind: string;
    parameters: JsonValue;
    w: number;
    h: number;
    artifact_w: number | null;
    artifact_h: number | null;
  }>(
    `WITH RECURSIVE lineage(node_id, depth) AS (
       SELECT $2::text, 0
       UNION ALL
       SELECT edge.input_node_id, lineage.depth + 1 FROM lineage
       JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
       JOIN image_node_inputs AS edge ON edge.photo_id = $1 AND edge.node_id = lineage.node_id AND edge.input_index = 0
       WHERE node.kind NOT IN ('resample', 'solid', 'source', 'generate')
     )
     SELECT node.kind, node.parameters, photo.w, photo.h, artifact.w AS artifact_w, artifact.h AS artifact_h FROM lineage
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
     JOIN photos AS photo ON photo.id = $1
     LEFT JOIN image_artifacts artifact ON artifact.artifact_hash = node.parameters->>'artifact_hash'
     ORDER BY lineage.depth`,
    [photoId, nodeId],
  );
  const first = result.rows[0];
  if (!first) throw new Error(`Frame recipe is unavailable: ${nodeId}`);
  const catalog = { w: first.w, h: first.h };
  let frame: RenderFrame | undefined;
  for (const row of result.rows.toReversed()) {
    const raster =
      row.kind === "resample" || row.kind === "solid"
        ? (imageNodeRegistry[row.kind].parameters.parse(row.parameters) as { w: number; h: number })
        : row.artifact_w !== null && row.artifact_h !== null
          ? { w: row.artifact_w, h: row.artifact_h }
          : (frame?.raster ?? catalog);
    frame = frameForNode(row.kind, row.parameters, catalog, raster, frame);
  }
  return frame!;
}

export async function loadBaseProjection(
  database: GraphTransaction,
  photoId: string,
  input: { artifact: Pick<PublishedArtifact, "artifactHash" | "w" | "h">; executionId: string },
) {
  const memo = new Map<string, Promise<RenderFrame>>();
  const load = (executionId: string): Promise<RenderFrame> => {
    const existing = memo.get(executionId);
    if (existing) return existing;
    if (memo.size >= 256) throw new Error("Historical frame ancestry exceeds the recovery limit");
    const pending = recover(executionId);
    memo.set(executionId, pending);
    return pending;
  };
  const recover = async (executionId: string): Promise<RenderFrame> => {
    const result = await database.query<{
      kind: string;
      parameters: JsonValue;
      render_frame: unknown;
      w: number;
      h: number;
      catalog_w: number;
      catalog_h: number;
      has_input: boolean;
    }>(
      `SELECT node.kind, node.parameters, execution.render_frame, artifact.w, artifact.h,
              photo.w AS catalog_w, photo.h AS catalog_h,
              EXISTS(SELECT 1 FROM image_node_inputs edge WHERE edge.photo_id = node.photo_id AND edge.node_id = node.id AND edge.input_index = 0) AS has_input
       FROM node_executions AS execution
       JOIN image_nodes AS node ON node.photo_id = execution.photo_id AND node.id = execution.node_id
       JOIN image_artifacts AS artifact ON artifact.artifact_hash = execution.output_artifact_hash
       JOIN photos AS photo ON photo.id = execution.photo_id
       WHERE execution.photo_id = $1 AND execution.execution_id = $2`,
      [photoId, executionId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Frame execution is unavailable: ${executionId}`);
    if (row.render_frame !== null) return parseRenderFrame(row.render_frame);
    const catalog = { w: row.catalog_w, h: row.catalog_h };
    let previous: RenderFrame | undefined;
    if (!["source", "resample", "solid", "generate", "upscale"].includes(row.kind)) {
      const candidates = await database.query<{ execution_id: string }>(
        `SELECT candidate.execution_id
         FROM node_executions AS parent
         JOIN node_execution_inputs AS input ON input.photo_id = parent.photo_id
          AND input.execution_id = parent.execution_id AND input.input_index = 0
         JOIN image_node_inputs AS edge ON edge.photo_id = parent.photo_id
          AND edge.node_id = parent.node_id AND edge.input_index = 0
         JOIN node_executions AS candidate ON candidate.photo_id = parent.photo_id
          AND candidate.node_id = edge.input_node_id AND candidate.output_artifact_hash = input.input_artifact_hash
         WHERE parent.photo_id = $1 AND parent.execution_id = $2 LIMIT 65`,
        [photoId, executionId],
      );
      if (candidates.rows.length > 64)
        throw new Error("Historical frame ancestry exceeds the recovery limit");
      if (row.has_input && candidates.rows.length === 0)
        throw new Error("Historical frame input execution is unavailable");
      const frames = await Promise.all(
        candidates.rows.map(async (candidate) => await load(candidate.execution_id)),
      );
      previous = frames[0];
      if (
        previous &&
        frames.some(
          (frame) =>
            canonicalJson(savedRenderFrame(frame)) !== canonicalJson(savedRenderFrame(previous!)),
        )
      )
        throw new Error(
          "Historical execution has ambiguous frame ancestry; pixels cannot determine its coordinates",
        );
    }
    const frame = frameForNode(row.kind, row.parameters, catalog, row, previous);
    await database.query(
      "UPDATE node_executions SET render_frame = $3::jsonb WHERE photo_id = $1 AND execution_id = $2 AND render_frame IS NULL",
      [photoId, executionId, JSON.stringify(savedRenderFrame(frame))],
    );
    return frame;
  };
  const frame = await load(input.executionId);
  if (frame.raster.w !== input.artifact.w || frame.raster.h !== input.artifact.h)
    throw new Error("Stored frame does not match its evaluated RGB input");
  return frame;
}

/** Shared base-mask mapping for compositing and inspection of the same evaluated RGB frame. */
export async function projectMaskToRender(
  mask: MaskImage,
  projection: Awaited<ReturnType<typeof loadBaseProjection>>,
  frame: { w: number; h: number },
): Promise<MaskImage> {
  const matrix = projection.baseToRaster;
  return mask.w === frame.w &&
    mask.h === frame.h &&
    matrix.every((value, coefficient) => value === [1, 0, 0, 1, 0, 0][coefficient])
    ? mask
    : {
        ...frame,
        data: await transformMaskPixels(mask.data, mask.w, mask.h, frame.w, frame.h, matrix),
      };
}

function frameToFrameMatrix(
  from: Awaited<ReturnType<typeof loadBaseProjection>>,
  to: Awaited<ReturnType<typeof loadBaseProjection>>,
) {
  const fromMatrix = from.baseToRaster;
  const toMatrix = to.baseToRaster;
  return fromMatrix.every((value, coefficient) => value === toMatrix[coefficient])
    ? ([1, 0, 0, 1, 0, 0] as const)
    : composeTransformMatrices(toMatrix, invertTransformMatrix(fromMatrix));
}

export async function projectCoverageBetweenFrames(
  mask: MaskImage,
  from: Awaited<ReturnType<typeof loadBaseProjection>>,
  to: Awaited<ReturnType<typeof loadBaseProjection>>,
  frame: { w: number; h: number },
): Promise<MaskImage> {
  const matrix = frameToFrameMatrix(from, to);
  if (
    mask.w === frame.w &&
    mask.h === frame.h &&
    matrix.every((value, coefficient) => value === [1, 0, 0, 1, 0, 0][coefficient])
  )
    return mask;
  return {
    ...frame,
    data: await transformMaskPixels(mask.data, mask.w, mask.h, frame.w, frame.h, matrix),
  };
}

export async function projectRgbToRender(
  image: LinearImage,
  from: Awaited<ReturnType<typeof loadBaseProjection>>,
  to: Awaited<ReturnType<typeof loadBaseProjection>>,
  frame: { w: number; h: number },
): Promise<LinearImage> {
  const matrix = frameToFrameMatrix(from, to);
  if (
    image.w === frame.w &&
    image.h === frame.h &&
    matrix.every((value, coefficient) => value === [1, 0, 0, 1, 0, 0][coefficient])
  )
    return image;
  return {
    ...image,
    ...frame,
    data: await transformPixels(
      image.data,
      image.w,
      image.h,
      3,
      frame.w,
      frame.h,
      matrix,
      "lanczos3",
    ),
  };
}

/** Sampling footprints cannot admit pixels excluded by an authored visible frame. */
export function clipCoverageToFrames(
  mask: MaskImage,
  frame: RenderFrame,
  restrictions: readonly RenderFrame[],
): MaskImage {
  let data = mask.data;
  for (const restriction of restrictions) {
    data = clipMaskToFrame(
      data,
      mask.w,
      mask.h,
      composeTransformMatrices(restriction.baseToRaster, frame.rasterToBase),
      restriction.raster.w,
      restriction.raster.h,
    );
  }
  return { ...mask, data };
}

/** Recover the precise coverage artifact, never interpolate already-thresholded support. */
export async function supportCoverage(
  request: EvaluateGraphNodeRequest,
  input: EvaluatedNode,
): Promise<MaskImage | undefined> {
  const result = await request.database.query<{ artifact_hash: string }>(
    `SELECT execution_input.input_artifact_hash AS artifact_hash
     FROM node_executions AS execution
     JOIN image_nodes AS node ON node.photo_id = execution.photo_id AND node.id = execution.node_id
     JOIN node_execution_inputs AS execution_input
       ON execution_input.photo_id = execution.photo_id AND execution_input.execution_id = execution.execution_id
      AND execution_input.input_index = 0
     WHERE execution.photo_id = $1 AND execution.execution_id = $2
       AND node.kind = 'mask' AND node.recipe_version = 2 AND node.parameters->>'operation' = 'support'`,
    [request.photoId, input.executionId],
  );
  const hash = result.rows[0]?.artifact_hash;
  return hash
    ? await readArtifactMask(artifactPath(request.libraryPath, hash, "tif"), hash)
    : undefined;
}
