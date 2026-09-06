import { commitRevision, loadActiveDocument, type GraphDatabase } from "../graph/store.js";
import { resolveLayerId, type RevisionLayerDraft } from "../layers/model.js";
import { maskCentroid } from "../layers/operations.js";
import {
  resolveTransformMatrix,
  transformPoint,
  invertTransformMatrix,
  type Transform,
} from "../transforms.js";
import { describeFillBranch } from "./branch.js";
import { parseRenderFrame } from "../graph/frame.js";
import { prepareFillDensity, type FillDensityRequest } from "./prepare-density.js";

export interface TransformFillRequest extends Pick<
  FillDensityRequest,
  "photoId" | "frame" | "source" | "resolveUpscaleAdapter"
> {
  layer: string;
  transform: Transform;
  relative: boolean;
}

export async function transformFillLayer(
  database: GraphDatabase,
  libraryPath: string,
  request: TransformFillRequest,
) {
  const document = await loadActiveDocument(database, request.photoId);
  if (!document) throw new Error("The active photo document is missing");
  const layerId = await resolveLayerId(database, request.photoId, request.layer);
  const selected = document.layers.find(({ id }) => id === layerId);
  if (!selected) throw new Error(`Layer is not present in the active revision: ${layerId}`);
  const branch = await describeFillBranch(database, request.photoId, selected);
  if (!branch) return undefined;

  const maskCenter = await maskCentroid(
    database,
    libraryPath,
    request.photoId,
    branch.selectionNodeId ?? branch.permanentMaskNodeId,
  );
  const centroid = branch.outpaint
    ? transformPoint(parseRenderFrame(branch.outpaint.output_frame).rasterToBase, maskCenter)
    : branch.fit
      ? transformPoint(invertTransformMatrix(branch.generationInputMatrix), maskCenter)
      : maskCenter;
  const anchor =
    request.relative && request.transform.anchor === "centroid"
      ? transformPoint(branch.currentMatrix, centroid)
      : centroid;
  const matrix = resolveTransformMatrix(
    branch.currentMatrix,
    request.transform,
    request.relative,
    anchor,
  );
  const prepared = await prepareFillDensity(database, libraryPath, {
    ...request,
    branch,
    matrix,
    baseNodeId: document.roots.base,
  });
  const layers: RevisionLayerDraft[] = document.layers.map((layer) => ({
    layer: { layerId: layer.id },
    name: layer.name,
    z: layer.z,
    contentNode: layer.id === layerId ? prepared.content : { nodeId: layer.contentNodeId },
    maskNode: layer.id === layerId ? prepared.mask : { nodeId: layer.maskNodeId },
    opacity: layer.opacity,
    blend: layer.blend,
    enabled: layer.enabled,
  }));
  const committed = await commitRevision(database, {
    outputPlan: "photographic",
    photoId: request.photoId,
    expectedRevisionId: document.revisionId,
    nodes: prepared.nodes,
    artifacts: prepared.artifacts,
    executions: prepared.executions,
    rootUpdates: [],
    layers,
  });
  if (!committed.renderHash) throw new Error("A layer transform must commit a render hash");
  return {
    revisionId: committed.revisionId,
    renderHash: committed.renderHash as `r_${string}`,
    matrix,
    layer: committed.layers.find(({ id }) => id === layerId)!,
    warnings: prepared.warnings,
    upscale: prepared.upscale,
  };
}
