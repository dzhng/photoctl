import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { createRetouchLayer, RevisionConflictError } from "@photoctl/render";
import { PhotoctlError, type Envelope, type RetouchData } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function retouchCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--norm"], options: ["--at", "--radius"] });
  if (parsed.positionals.length !== 1)
    throw new PhotoctlError("usage", "retouch requires exactly one photo ID or prefix");
  const rawAt = parsed.options.get("--at");
  if (!rawAt) throw new PhotoctlError("usage", "retouch requires --at x,y");
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const id = await resolvePhotoId(lease.handle, parsed.positionals[0]!);
    const photo = await loadPhoto(lease.handle, id);
    const dimensions = { w: photo.w, h: photo.h };
    const at = parsePoint(rawAt);
    let radius = parsed.options.has("--radius")
      ? parsePositive(parsed.options.get("--radius")!, "--radius")
      : 0.02;
    if (parsed.flags.has("--norm")) {
      if (at.some((value) => value < 0 || value > 1) || radius > 1)
        throw new PhotoctlError(
          "usage",
          "Normalized retouch coordinates and radius must be between 0 and 1",
        );
      at[0] *= dimensions.w;
      at[1] *= dimensions.h;
      radius *= Math.max(dimensions.w, dimensions.h);
    } else if (!parsed.options.has("--radius")) {
      radius *= Math.max(dimensions.w, dimensions.h);
    }
    at[0] = canonicalGeometry(at[0]);
    at[1] = canonicalGeometry(at[1]);
    radius = canonicalGeometry(radius);
    if (at[0] < 0 || at[0] > dimensions.w || at[1] < 0 || at[1] > dimensions.h)
      throw new PhotoctlError("usage", "Retouch point must be inside the oriented image bounds");
    try {
      const result = await createRetouchLayer(lease.handle, lease.handle.path, {
        photoId: id,
        orientation: photo.orientation,
        dimensions,
        at,
        radius,
      });
      return {
        schema: 1,
        ok: true,
        data: {
          id,
          layer_id: result.layerId,
          revision_id: result.revisionId,
          render_hash: result.renderHash,
          at: result.at,
          radius: result.radius,
          node: result.nodeId,
          reused: result.reused,
        } satisfies RetouchData,
        warnings: [],
      };
    } catch (error) {
      if (error instanceof RevisionConflictError)
        throw new PhotoctlError("library_locked", error.message, {
          id,
          reason: "revision_conflict",
        });
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("Retouch ")) throw new PhotoctlError("usage", message, { id });
      throw new PhotoctlError("catalog_unreadable", "Could not commit retouch", {
        id,
        reason: message,
      });
    }
  } finally {
    await lease.release();
  }
}

function parsePoint(value: string): [number, number] {
  const values = value.split(",").map(Number);
  if (values.length !== 2 || values.some((part) => !Number.isFinite(part)))
    throw new PhotoctlError("usage", "--at requires finite x,y coordinates");
  return [values[0]!, values[1]!];
}
function parsePositive(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new PhotoctlError("usage", `${option} requires a positive number`);
  return parsed;
}
function canonicalGeometry(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
