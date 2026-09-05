import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type UndoData } from "@photoctl/protocol";
import { ensurePhotoDocument, RevisionConflictError, undoRevision } from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";

export async function undoCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: [], options: [] });
  if (parsed.positionals.length !== 1)
    throw new PhotoctlError("usage", "undo requires one photo ID or prefix");
  const lease = await openRequestLibrary(env, cwd, provided);
  try {
    const id = await resolvePhotoId(lease.handle, parsed.positionals[0]!);
    const photo = await loadPhoto(lease.handle, id);
    const current = await ensurePhotoDocument(lease.handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    const restored = await undoRevision(lease.handle, {
      photoId: id,
      expectedRevisionId: current.revisionId,
    });
    if (!restored.renderHash)
      throw new PhotoctlError("catalog_unreadable", "The restored revision has no output root", {
        id,
      });
    return {
      schema: 1,
      ok: true,
      data: {
        id,
        undone: restored.revisionId !== current.revisionId,
        revision_id: restored.revisionId,
        render_hash: restored.renderHash,
      } satisfies UndoData,
      warnings: [],
    };
  } catch (error) {
    if (error instanceof RevisionConflictError)
      throw new PhotoctlError("library_locked", error.message, { reason: "revision_conflict" });
    throw error;
  } finally {
    await lease.release();
  }
}
