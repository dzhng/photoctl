/* eslint-disable no-await-in-loop -- Yield between bounded row batches rather than queue the whole frame. */
import { setImmediate } from "node:timers/promises";
import { fitWhiteBalance } from "@photoctl/img";
import { PhotoctlError } from "@photoctl/protocol";
import { readArtifactBytes } from "../artifacts/publication.js";
import { inspectArtifactLinearTiff } from "../linear-tiff.js";
import { transformPoint } from "../transforms.js";
import { evaluateGraphNode, type EvaluateGraphNodeRequest } from "../graph/evaluator.js";
import { loadBaseProjection } from "../graph/projection.js";
import type { Bbox, Point } from "../coordinates.js";

export type NeutralSample = { point: Point } | { region: Bbox };

/** The caller supplies the snapped input beneath editable develop, not the displayed composite. */
export async function sampleWhiteBalance(request: EvaluateGraphNodeRequest, sample: NeutralSample) {
  const evaluated = await evaluateGraphNode(request);
  const [bytes, frame] = await Promise.all([
    readArtifactBytes(evaluated.artifact.path, evaluated.artifact.artifactHash, evaluated.artifact),
    loadBaseProjection(request.database, request.photoId, evaluated),
  ]);
  const image = evaluated.artifact;
  const { pixelOffset } = await inspectArtifactLinearTiff(bytes);
  let bounds: Bbox;
  if ("point" in sample) {
    const { x, y } = transformPoint(frame.baseToRaster, { x: sample.point[0], y: sample.point[1] });
    if (x < 0 || y < 0 || x >= image.w || y >= image.h)
      throw new PhotoctlError("usage", "Sample point is outside the editable base");
    bounds = [Math.floor(x), Math.floor(y), 1, 1];
  } else {
    const [x, y, w, h] = sample.region;
    const corners = [
      { x, y },
      { x: x + w, y },
      { x, y: y + h },
      { x: x + w, y: y + h },
    ].map((p) => transformPoint(frame.baseToRaster, p));
    const left = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))));
    const top = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    bounds = [
      left,
      top,
      Math.min(image.w, Math.ceil(Math.max(...corners.map((p) => p.x)))) - left,
      Math.min(image.h, Math.ceil(Math.max(...corners.map((p) => p.y)))) - top,
    ];
  }
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = bounds[1]; y < bounds[1] + bounds[3]; y++) {
    for (let x = bounds[0]; x < bounds[0] + bounds[2]; x++) {
      if ("region" in sample) {
        const p = transformPoint(frame.rasterToBase, { x: x + 0.5, y: y + 0.5 });
        const [left, top, w, h] = sample.region;
        if (p.x < left || p.x >= left + w || p.y < top || p.y >= top + h) continue;
      }
      const offset = (y * image.w + x) * 3;
      for (let c = 0; c < 3; c++) sum[c]! += bytes.readFloatLE(pixelOffset + (offset + c) * 4);
      count++;
    }
    // A requested full-frame patch must not monopolize the daemon's JS thread.
    if (y % 32 === 0) await setImmediate();
  }
  if (!count) throw new PhotoctlError("usage", "Sample contains no available pixel centers");
  const mean: [number, number, number] = [sum[0]! / count, sum[1]! / count, sum[2]! / count];
  try {
    return {
      ...fitWhiteBalance(mean),
      sample: {
        ...sample,
        mean_rgb: mean,
        pixels: count,
        space: "scene-linear-rec2020" as const,
        stage: "editable-base-before-develop" as const,
        raster: { w: image.w, h: image.h },
      },
    };
  } catch (error) {
    throw new PhotoctlError("usage", error instanceof Error ? error.message : String(error));
  }
}
