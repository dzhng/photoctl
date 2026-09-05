import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  createManualLayer,
  orientedDimensions,
  RevisionConflictError,
  type ManualMaskShape,
} from "@photoctl/render";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function segmentCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--norm"], options: ["--box", "--brush"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "segment requires one photo ID or prefix");
  }
  if ((parsed.options.has("--box") ? 1 : 0) + (parsed.options.has("--brush") ? 1 : 0) !== 1) {
    throw new PhotoctlError("usage", "segment requires exactly one of --box or --brush");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, parsed.positionals[0]);
    const photo = await loadPhoto(lease.handle, photoId);
    const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
    let shape: ManualMaskShape;
    try {
      shape = parseShape(parsed.options, parsed.flags.has("--norm"), dimensions);
      const result = await createManualLayer(lease.handle, lease.handle.path, {
        photoId,
        orientation: photo.orientation,
        dimensions,
        shape,
      });
      return {
        schema: 1,
        ok: true,
        data: {
          id: photoId,
          layer_id: result.layerId,
          revision_id: result.revisionId,
          render_hash: result.renderHash,
          mask: {
            artifact_hash: result.artifactHash,
            bbox: result.bbox,
            pixels: result.pixels,
          },
        },
        warnings: [],
      };
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      if (error instanceof RevisionConflictError) {
        throw new PhotoctlError("library_locked", error.message, {
          id: photoId,
          reason: "revision_conflict",
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("Segment") ||
        message.startsWith("Manual mask") ||
        message.startsWith("--")
      ) {
        throw new PhotoctlError("usage", message, { id: photoId });
      }
      throw new PhotoctlError("catalog_unreadable", "Could not create manual layer", {
        id: photoId,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

function parseShape(
  options: Map<string, string>,
  normalized: boolean,
  dimensions: { w: number; h: number },
): ManualMaskShape {
  const box = options.get("--box");
  if (box) {
    const values = box.split(",").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
      throw new Error("--box must be x,y,w,h");
    }
    assertNormalizedValues(values, normalized);
    if (normalized) {
      values[0] *= dimensions.w;
      values[1] *= dimensions.h;
      values[2] *= dimensions.w;
      values[3] *= dimensions.h;
    }
    return { kind: "box", bbox: values as [number, number, number, number] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(options.get("--brush")!);
  } catch {
    throw new Error("--brush must be a JSON array of [x,y] points");
  }
  if (!Array.isArray(parsed)) throw new Error("--brush must be a JSON array of [x,y] points");
  const points = parsed.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      point.some((value) => typeof value !== "number")
    ) {
      throw new Error("--brush must be a JSON array of [x,y] points");
    }
    assertNormalizedValues(point, normalized);
    return [
      point[0] * (normalized ? dimensions.w : 1),
      point[1] * (normalized ? dimensions.h : 1),
    ] as [number, number];
  });
  return { kind: "brush", points };
}

function assertNormalizedValues(values: number[], normalized: boolean): void {
  if (normalized && values.some((value) => value < 0 || value > 1)) {
    throw new Error("--norm coordinates must be between 0 and 1");
  }
}
