import { PhotoctlError } from "@photoctl/protocol";
import type { DevelopDict } from "../develop/dict.js";
import { composeTransformMatrices } from "../transforms.js";
import {
  developFrame,
  rasterFrame,
  savedRenderFrame,
  assertNewRasterSize,
  type RenderFrame,
  frameAtRaster,
} from "./frame.js";
import {
  loadActiveDocument,
  commitRevision,
  planSourceDocument,
  type CommitRevisionRequest,
  type GraphDatabase,
  type NodeReference,
} from "./store.js";
import { loadLogicalFrame } from "./projection.js";
import { layerDraft } from "../layers/model.js";
import { loadGeometryAncestry } from "./geometry-intent.js";
import {
  normalizeMaskArtifact,
  publishArtifact,
  type PublishedArtifact,
} from "../artifacts/publication.js";
import { readBaseDevelopInput } from "./base-input.js";
import { readCanvasInputStages } from "./output.js";

export type CanvasExpansion = { padding: number } | { aspect: readonly [number, number] };
export interface CanvasLimits {
  maxOutputEdge: number;
  maxOutputPixels: number;
}

/** Preparation is read-only, including an exact-aspect no-op on an untouched photo. */
export async function prepareCanvasExpansion(
  database: GraphDatabase,
  request: CanvasExpansion & { photoId: string; limits?: CanvasLimits },
) {
  const photo = (
    await database.query<{ w: number; h: number; orientation: number }>(
      "SELECT w, h, orientation FROM photos WHERE id = $1",
      [request.photoId],
    )
  ).rows[0];
  if (!photo) throw new PhotoctlError("not_found", `Photo not found: ${request.photoId}`);
  const document = await loadActiveDocument(database, request.photoId);
  const inputFrame = document
    ? await loadLogicalFrame(database, request.photoId, document.roots.output)
    : developFrame(photo, photo);
  return {
    photoId: request.photoId,
    orientation: photo.orientation,
    expectedRevisionId: document?.revisionId ?? null,
    document,
    sourceDocument: document ? undefined : planSourceDocument(photo.orientation, "canvas-"),
    inputFrame,
    inputStages: document
      ? await readCanvasInputStages(database, request.photoId, document.roots)
      : [savedRenderFrame(inputFrame)],
    ...expandCanvasFrame(inputFrame, request, request.limits),
  };
}

export async function commitCanvasExpansion(
  database: GraphDatabase,
  libraryPath: string,
  request: Pick<CommitRevisionRequest, "nodes" | "artifacts" | "executions"> & {
    prepared: Awaited<ReturnType<typeof prepareCanvasExpansion>>;
    content: NodeReference;
    contentRaster?: RenderFrame["raster"];
    exteriorMask?: PublishedArtifact;
  },
) {
  const { prepared } = request;
  if (!prepared.changed) return { changed: false as const, layerId: null };
  const current = prepared.document;
  const ancestry = current?.roots.geometry
    ? await loadGeometryAncestry(database, prepared.photoId, current.roots.geometry)
    : undefined;
  const support =
    current?.layers
      .filter((layer) => layer.enabled && layer.role === "border")
      .map((layer) => layer.authoredCheckpointNodeId!) ?? [];
  const head = ancestry?.inputs[0];
  const sequence = (ancestry?.parameters.sequence ?? 0) + 1;
  const activation = {
    crop_activation: ancestry?.parameters.crop_activation ?? 0,
    aspect_activation: ancestry?.parameters.aspect_activation ?? 0,
  };
  const baseNodes = prepared.sourceDocument?.nodes ?? [];
  const controls = current
    ? (await readBaseDevelopInput(database, prepared.photoId, current.roots.base)).develop
    : {};
  const { crop, aspect_ratio, rotate, straighten_deg } = controls;
  const geometry: DevelopDict = {
    ...(crop === undefined ? {} : { crop }),
    ...(aspect_ratio === undefined ? {} : { aspect_ratio }),
    ...(rotate === undefined ? {} : { rotate }),
    ...(straighten_deg === undefined ? {} : { straighten_deg }),
  };
  const publishedMask =
    request.exteriorMask ??
    (await publishArtifact(libraryPath, await normalizeMaskArtifact(canvasExteriorMask(prepared))));
  const committed = await commitRevision(database, {
    photoId: prepared.photoId,
    expectedRevisionId: prepared.expectedRevisionId,
    outputPlan: "photographic",
    nodes: [
      ...request.nodes,
      ...baseNodes,
      {
        localKey: "border-checkpoint",
        kind: "geometry",
        recipeVersion: 1,
        parameters: {
          type: "checkpoint",
          sequence,
          ...activation,
          support_input_count: support.length,
          geometry,
          input_frame: savedRenderFrame(prepared.inputFrame),
          input_stages: prepared.inputStages,
          outer_frame: savedRenderFrame(prepared.frame),
        },
        inputs: [...support, ...(head ? [head] : [])].map((nodeId) => ({ nodeId })),
      },
      {
        localKey: "canvas-intent",
        kind: "geometry",
        recipeVersion: 1,
        parameters: { type: "intent", sequence, ...activation },
        inputs: [{ localKey: "border-checkpoint" }],
      },
      {
        localKey: "border-mask",
        kind: "mask",
        recipeVersion: 1,
        parameters: { artifact_hash: publishedMask.artifactHash },
        inputs: [],
      },
      ...(
        [
          [
            "border-content-placement",
            request.content,
            request.contentRaster ?? prepared.frame.raster,
          ],
          ["border-mask-placement", { localKey: "border-mask" }, prepared.frame.raster],
        ] as const
      ).map(([localKey, input, raster]) => ({
        localKey,
        kind: "transform" as const,
        recipeVersion: 2,
        parameters: {
          matrix: [1, 0, 0, 1, 0, 0],
          frame: savedRenderFrame(frameAtRaster(prepared.frame, raster)),
        },
        inputs: [input],
      })),
    ],
    rootUpdates: [
      ...(prepared.sourceDocument
        ? [{ root: "base" as const, node: prepared.sourceDocument.output }]
        : []),
      { root: "geometry", node: { localKey: "canvas-intent" } },
    ],
    artifacts: [...(request.artifacts ?? []), publishedMask],
    executions: request.executions,
    newLayers: [{ localKey: "border", role: "border" }],
    layers: [
      ...(current?.layers.map((layer) => layerDraft(layer, layer.z)) ?? []),
      {
        layer: { localKey: "border" },
        name: "Outpaint",
        z: current?.layers.length ?? 0,
        contentNode: { localKey: "border-content-placement" },
        maskNode: { localKey: "border-mask-placement" },
        opacity: 1,
        blend: "normal",
        enabled: true,
      },
    ],
  });
  return {
    changed: true as const,
    layerId: committed.newLayers.border!,
    revisionId: committed.revisionId,
    renderHash: committed.renderHash! as `r_${string}`,
    outputNodeId: committed.roots.output! as `node_${string}`,
    contentNodeId: ("nodeId" in request.content
      ? request.content.nodeId
      : committed.nodes[request.content.localKey]!.id) as `node_${string}`,
  };
}

/** Generation and published coverage share one exterior-only ring. */
export function canvasExteriorMask(prepared: Awaited<ReturnType<typeof prepareCanvasExpansion>>) {
  const data = new Float32Array(prepared.frame.raster.w * prepared.frame.raster.h).fill(1);
  for (let y = 0; y < prepared.inputFrame.raster.h; y++) {
    const start = (y + prepared.offset.y) * prepared.frame.raster.w + prepared.offset.x;
    data.fill(0, start, start + prepared.inputFrame.raster.w);
  }
  return { ...prepared.frame.raster, data };
}

/** Expansion changes the viewport, never the catalog coordinate system or the source tier. */
export function expandCanvasFrame(
  input: RenderFrame,
  expansion: CanvasExpansion,
  limits?: CanvasLimits,
) {
  for (const value of limits ? [limits.maxOutputEdge, limits.maxOutputPixels] : []) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Canvas limits must be positive safe integers");
  }
  let w: number;
  let h: number;
  if ("padding" in expansion) {
    const padding = expansion.padding;
    if (
      !Number.isSafeInteger(padding) ||
      padding < 0 ||
      (limits &&
        padding > Math.floor((limits.maxOutputEdge - Math.max(input.raster.w, input.raster.h)) / 2))
    ) {
      throw new PhotoctlError("usage", "Canvas padding exceeds the output dimension limit");
    }
    w = input.raster.w + 2 * padding;
    h = input.raster.h + 2 * padding;
  } else {
    let [p, q] = expansion.aspect;
    if (![p, q].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new PhotoctlError("usage", "Canvas aspect must contain two positive safe integers");
    }
    let a = p;
    let b = q;
    while (b !== 0) [a, b] = [b, a % b];
    p /= a;
    q /= a;
    const k = Math.ceil(Math.max(input.raster.w / p, input.raster.h / q));
    if (
      limits &&
      (k > Math.floor(limits.maxOutputEdge / p) || k > Math.floor(limits.maxOutputEdge / q))
    ) {
      throw new PhotoctlError("usage", "Canvas aspect exceeds the output dimension limit");
    }
    w = k * p;
    h = k * q;
  }
  if (limits && w > Math.floor(limits.maxOutputPixels / h)) {
    throw new PhotoctlError("usage", "Canvas exceeds the output pixel limit");
  }
  assertNewRasterSize({ w, h }, input.catalog);
  const offset = {
    x: Math.floor((w - input.raster.w) / 2),
    y: Math.floor((h - input.raster.h) / 2),
  };
  return {
    changed: w !== input.raster.w || h !== input.raster.h,
    offset,
    frame: rasterFrame(
      input.catalog,
      input.source,
      { w, h },
      composeTransformMatrices([1, 0, 0, 1, offset.x, offset.y], input.sourceToRaster),
    ),
  };
}
