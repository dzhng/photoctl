/* eslint-disable no-await-in-loop -- Source fallback order is semantic and bounds native decoder memory. */
import { resolve } from "node:path";
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { createVolumeResolver, resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import { PhotoctlError, type Envelope, type RenderData, type Warning } from "@photoctl/protocol";
import {
  ensurePhotoDocument,
  evaluateGraphNode,
  publishFile,
  readArtifactBytes,
  SourceEvaluationError,
  type ImageSource,
} from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { graphSourceWarning, resolveGraphSources } from "../graph-source.js";
import { loadPhoto } from "../photo.js";

export async function renderCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--linear"], options: ["--to"] });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "render requires exactly one photo ID or prefix");
  }
  if (!parsed.flags.has("--linear")) {
    throw new PhotoctlError("usage", "render currently requires --linear");
  }
  const destination = parsed.options.get("--to");
  if (!destination) throw new PhotoctlError("usage", "render requires --to <output.tif>");
  const file = resolve(cwd, destination);

  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const id = await resolvePhotoId(handle, parsed.positionals[0]);
    const photo = await loadPhoto(handle, id);
    const document = await ensurePhotoDocument(handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    const resolver = createVolumeResolver(env.volumeMap, handle.path);
    const libraryId = await readLibraryId(handle);
    const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    const pinned: ImageSource = {
      kind: "pinned-preview",
      path: pinnedEmbeddedJpegPath(cacheRoot, id),
      mediaType: "image/jpeg",
      orientation: 1,
    };
    const warnings: Warning[] = [];
    const candidates = await resolveGraphSources({
      photo,
      resolver,
      pinned,
      pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${id}.jpg` },
      env,
    });
    let resolved:
      | {
          evaluated: Awaited<ReturnType<typeof evaluateGraphNode>>;
          fallback: (typeof candidates)[number]["fallback"];
        }
      | undefined;
    for (const candidate of candidates) {
      try {
        resolved = {
          evaluated: await evaluateGraphNode({
            database: handle,
            libraryPath: handle.path,
            photoId: id,
            nodeId: document.outputNodeId,
            source: candidate.produce,
            developBaseDimensions: { w: photo.w, h: photo.h },
          }),
          fallback: candidate.fallback,
        };
        break;
      } catch (error) {
        if (!(error instanceof SourceEvaluationError)) {
          throw new PhotoctlError("decoder_unavailable", errorMessage(error), { id });
        }
      }
    }
    if (!resolved) {
      throw new PhotoctlError("file_offline", "No usable image source is available", { id });
    }
    const sourceWarning = graphSourceWarning(id, resolved.fallback);
    if (sourceWarning) warnings.push(sourceWarning);
    const bytes = await readArtifactBytes(
      resolved.evaluated.artifact.path,
      resolved.evaluated.artifact.artifactHash,
      { w: resolved.evaluated.artifact.w, h: resolved.evaluated.artifact.h },
    );
    try {
      await publishFile(file, bytes);
    } catch {
      throw new PhotoctlError("volume_readonly", `Could not write rendered TIFF: ${file}`, {
        path: file,
      });
    }
    return {
      schema: 1,
      ok: true,
      data: {
        id,
        file,
        w: resolved.evaluated.artifact.w,
        h: resolved.evaluated.artifact.h,
        space: "scene-linear-rec2020",
        render_hash: document.renderHash,
      } satisfies RenderData,
      warnings,
    };
  } finally {
    await lease.release();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
