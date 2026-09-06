import { detectHorizon, linearRec2020ToDisplaySrgb, resamplePixels } from "@photoctl/img";
import { readArtifactLinear } from "../artifacts/publication.js";
import { loadBaseProjection, loadLogicalFrame } from "../graph/projection.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { composeTransformMatrices } from "../transforms.js";

/** Analyze the caller's snapped photographic output, never its final vector markup. */
export async function detectOutputHorizon(
  request: EvaluateGraphNodeRequest,
  currentDegrees: number,
): Promise<number | null> {
  const evaluated = await evaluateGraphNode(request);
  const [image, frame, logical] = await Promise.all([
    readArtifactLinear(evaluated.artifact.path),
    loadBaseProjection(request.database, request.photoId, evaluated),
    loadLogicalFrame(request.database, request.photoId, request.nodeId),
  ]);
  const scale = Math.min(1, 512 / Math.max(image.w, image.h));
  const w = Math.max(1, Math.round(image.w * scale));
  const h = Math.max(1, Math.round(image.h * scale));
  const reduced =
    w === image.w && h === image.h
      ? image.data
      : await resamplePixels(image.data, image.w, image.h, 3, w, h, "lanczos3");
  // Map line directions through the saved execution frame, not a nominal
  // scale: offline tiers and rounded raster dimensions can be anisotropic.
  const mapping = composeTransformMatrices(logical.baseToRaster, frame.rasterToBase);
  const sx = image.w / w;
  const sy = image.h / h;
  return await detectHorizon(
    await linearRec2020ToDisplaySrgb(reduced),
    w,
    h,
    [mapping[0] * sx, mapping[1] * sx, mapping[2] * sy, mapping[3] * sy],
    currentDegrees,
  );
}
