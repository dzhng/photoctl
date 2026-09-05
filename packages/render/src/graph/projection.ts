import { transformMaskPixels, transformPixels } from "@photoctl/img";
import {
  artifactPath,
  readArtifactMask,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import type { LinearImage } from "../decoder.js";
import { developDictSchema } from "../develop/dict.js";
import { developGeometryMatrix, scaleDevelopGeometry } from "../develop/geometry.js";
import type { MaskImage } from "../mask-tiff.js";
import { composeTransformMatrices, invertTransformMatrix } from "../transforms.js";
import type { EvaluateGraphNodeRequest, EvaluatedNode } from "./evaluator.js";
import type { GraphTransaction } from "./store.js";
import type { JsonValue } from "./types.js";

export async function loadBaseProjection(
  database: GraphTransaction,
  photoId: string,
  input: { artifact: Pick<PublishedArtifact, "artifactHash" | "w" | "h">; executionId: string },
) {
  const result = await database.query<{
    depth: number;
    kind: string;
    parameters: JsonValue;
    w: number;
    h: number;
    catalog_w: number;
    catalog_h: number;
  }>(
    `WITH RECURSIVE lineage(node_id, artifact_hash, depth) AS (
       SELECT execution.node_id, $3::text, 0
       FROM node_executions AS execution
       WHERE execution.photo_id = $1 AND execution.execution_id = $2
       UNION ALL
       SELECT edge.input_node_id, execution_input.input_artifact_hash, lineage.depth + 1
       FROM lineage
       JOIN image_node_inputs AS edge
         ON edge.photo_id = $1 AND edge.node_id = lineage.node_id AND edge.input_index = 0
       JOIN LATERAL (
         SELECT execution_input.input_artifact_hash
         FROM node_executions AS execution
         JOIN node_execution_inputs AS execution_input
           ON execution_input.photo_id = execution.photo_id
          AND execution_input.execution_id = execution.execution_id
          AND execution_input.input_index = 0
         WHERE execution.photo_id = $1
           AND execution.node_id = lineage.node_id
           AND execution.output_artifact_hash = lineage.artifact_hash
         ORDER BY execution.created_at DESC, execution.execution_id
         LIMIT 1
       ) AS execution_input ON true
     )
     SELECT lineage.depth, node.kind, node.parameters, artifact.w, artifact.h,
            photo.w AS catalog_w, photo.h AS catalog_h
     FROM lineage
     JOIN image_nodes AS node ON node.photo_id = $1 AND node.id = lineage.node_id
     JOIN image_artifacts AS artifact ON artifact.artifact_hash = lineage.artifact_hash
     JOIN photos AS photo ON photo.id = $1
     ORDER BY lineage.depth`,
    [photoId, input.executionId, input.artifact.artifactHash],
  );
  const rows = result.rows;
  const first = rows[0];
  if (!first) throw new Error(`Base input execution is unavailable: ${input.executionId}`);
  // An explicit resample establishes a canvas; its provider input may be an intrinsic crop.
  const canvasIndex = rows.findIndex(({ kind }) =>
    ["resample", "solid", "source", "generate"].includes(kind),
  );
  const frameRows = canvasIndex < 0 ? rows : rows.slice(0, canvasIndex + 1);
  const developIndex = frameRows.findIndex(({ kind }) => kind === "develop");
  const sourceBase = developIndex >= 0 ? frameRows[developIndex + 1] : frameRows.at(-1);
  if (!sourceBase) throw new Error("Base develop input execution is unavailable");
  const catalogBase = { w: first.catalog_w, h: first.catalog_h };
  const actualBase = { w: sourceBase.w, h: sourceBase.h };
  const develop = developIndex >= 0 ? frameRows[developIndex]!.parameters : {};
  const geometry = developGeometryMatrix(
    actualBase.w,
    actualBase.h,
    scaleDevelopGeometry(developDictSchema.parse(develop), catalogBase, actualBase),
  );
  if (geometry.w !== input.artifact.w || geometry.h !== input.artifact.h) {
    throw new Error("Base geometry does not match its evaluated RGB input");
  }
  return {
    baseW: actualBase.w,
    baseH: actualBase.h,
    matrix: geometry.matrix,
    catalogBase,
  };
}

/** Shared base-mask mapping for compositing and inspection of the same evaluated RGB frame. */
export async function projectMaskToRender(
  mask: MaskImage,
  projection: Awaited<ReturnType<typeof loadBaseProjection>>,
  frame: { w: number; h: number },
): Promise<MaskImage> {
  const matrix = catalogToRenderMatrix(projection);
  return mask.w === frame.w &&
    mask.h === frame.h &&
    matrix.every((value, coefficient) => value === [1, 0, 0, 1, 0, 0][coefficient])
    ? mask
    : {
        ...frame,
        data: await transformMaskPixels(mask.data, mask.w, mask.h, frame.w, frame.h, matrix),
      };
}

export function catalogToRenderMatrix(projection: Awaited<ReturnType<typeof loadBaseProjection>>) {
  return composeTransformMatrices(projection.matrix, [
    projection.baseW / projection.catalogBase.w,
    0,
    0,
    projection.baseH / projection.catalogBase.h,
    0,
    0,
  ]);
}

function frameToFrameMatrix(
  from: Awaited<ReturnType<typeof loadBaseProjection>>,
  to: Awaited<ReturnType<typeof loadBaseProjection>>,
) {
  const fromMatrix = catalogToRenderMatrix(from);
  const toMatrix = catalogToRenderMatrix(to);
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
