import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { moveLayer, orientedDimensions, RevisionConflictError } from "@photoctl/render";
import { PhotoctlError, type Envelope } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function fillCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, {
    flags: ["--norm"],
    options: ["--move", "--to", "--by"],
  });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "fill requires exactly one photo ID or prefix");
  }
  const layer = parsed.options.get("--move");
  const modes = ["--to", "--by"].filter((option) => parsed.options.has(option));
  if (!layer || modes.length !== 1) {
    throw new PhotoctlError("usage", "fill --move requires exactly one of --to x,y or --by dx,dy");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const photoId = await resolvePhotoId(lease.handle, parsed.positionals[0]);
    const photo = await loadPhoto(lease.handle, photoId);
    const dimensions = orientedDimensions({ w: photo.w, h: photo.h }, photo.orientation);
    const mode = modes[0] === "--to" ? "to" : "by";
    const point = parsePoint(parsed.options.get(modes[0])!, modes[0]);
    if (parsed.flags.has("--norm")) {
      const valid =
        mode === "to"
          ? point.every((value) => value >= 0 && value <= 1)
          : point.every((value) => value >= -1 && value <= 1);
      if (!valid) {
        throw new PhotoctlError(
          "usage",
          mode === "to"
            ? "--norm target coordinates must be between 0 and 1"
            : "--norm displacements must be between -1 and 1",
        );
      }
      point[0] *= dimensions.w;
      point[1] *= dimensions.h;
    }
    try {
      const moved = await moveLayer(lease.handle, lease.handle.path, {
        photoId,
        orientation: photo.orientation,
        dimensions,
        layer,
        destination: { mode, x: point[0], y: point[1] },
      });
      return {
        schema: 1,
        ok: true,
        data: {
          id: photoId,
          layer_id: moved.layerId,
          vacancy_layer_id: moved.vacancyLayerId,
          revision_id: moved.revisionId,
          render_hash: moved.renderHash,
          matrix: moved.matrix,
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
      if (message.includes("not present")) {
        throw new PhotoctlError("not_found", message, { id: photoId, layer });
      }
      if (message === "fill --move requires a subject layer") {
        throw new PhotoctlError("usage", message, { id: photoId, layer });
      }
      throw new PhotoctlError("catalog_unreadable", "Could not commit moved layer state", {
        id: photoId,
        layer,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

function parsePoint(value: string, option: string): [number, number] {
  const point = value.split(",").map(Number);
  if (point.length !== 2 || point.some((coordinate) => !Number.isFinite(coordinate))) {
    throw new PhotoctlError("usage", `${option} must be two finite comma-separated numbers`);
  }
  return [point[0], point[1]];
}
