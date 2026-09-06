/* eslint-disable no-await-in-loop -- Source candidates are an ordered fallback ladder. */
import { cacheRootForLibrary, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import { createVolumeResolver, resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  commitDevelopState,
  detectOutputHorizon,
  developDictSchema,
  developGeometryMatrix,
  developHash,
  readActiveDevelopState,
  RevisionConflictError,
  SourceEvaluationError,
  type ActiveDevelopState,
  type DevelopDict,
} from "@photoctl/render";
import { PhotoctlError, type CropData, type Envelope, type Warning } from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { graphSourceWarning, resolveGraphSources } from "../graph-source.js";
import { loadPhoto, type StoredPhoto } from "../photo.js";
import { createProgressHeartbeat } from "../progress.js";

export async function cropCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--auto"], options: ["--aspect", "--straighten"] });
  const autoRequested = parsed.flags.has("--auto");
  const aspect = parsed.options.get("--aspect");
  const straighten = parsed.options.get("--straighten");
  if (
    parsed.positionals.length !== 1 ||
    (!autoRequested && aspect === undefined && straighten === undefined)
  )
    throw new PhotoctlError(
      "usage",
      "crop requires one photo and --aspect, --straighten, or --auto",
    );
  if (autoRequested && straighten !== undefined)
    throw new PhotoctlError("usage", "crop --auto and --straighten are mutually exclusive");
  if (straighten !== undefined && !straighten.trim())
    throw new PhotoctlError("usage", "--straighten requires a number");
  const patch = developDictSchema.safeParse({
    ...(aspect !== undefined ? { aspect_ratio: aspect } : {}),
    ...(straighten !== undefined ? { straighten_deg: Number(straighten) } : {}),
  });
  if (!patch.success) throw new PhotoctlError("usage", patch.error.message);
  const lease = await openRequestLibrary(env, cwd, provided);
  const progress = createProgressHeartbeat({
    emit:
      emit &&
      (async (event) => {
        try {
          await emit(event);
        } catch {
          /* Advisory progress cannot turn a committed crop into a reported failure. */
        }
      }),
    phase: "crop",
    total: 1,
  });
  try {
    if (autoRequested) await progress.start();
    const id = await resolvePhotoId(lease.handle, parsed.positionals[0]!);
    const photo = await loadPhoto(lease.handle, id);
    const current = await readActiveDevelopState(lease.handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    const warnings: Warning[] = [];
    const next: DevelopDict = { ...current.develop, ...patch.data };
    let auto: CropData["auto"] = null;
    if (autoRequested) {
      const estimate = await analyze(lease.handle, photo, current, env, cwd, warnings);
      const previous = current.develop.straighten_deg ?? 0;
      const target =
        estimate === null
          ? previous
          : Math.min(45, Math.max(-45, Math.round((previous + estimate) * 1e6) / 1e6));
      const correction = estimate === null ? null : target - previous;
      auto =
        correction === null
          ? { detected: false, correction_deg: null }
          : { detected: true, correction_deg: correction };
      if (correction !== null && correction !== 0) {
        next.straighten_deg = target;
      }
    }
    try {
      developGeometryMatrix(photo.w, photo.h, next);
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      throw new PhotoctlError("usage", error instanceof Error ? error.message : String(error));
    }
    try {
      const committed = await commitDevelopState(
        lease.handle,
        current,
        next,
        undefined,
        aspect === undefined ? [] : ["aspect_ratio"],
      );
      if (committed.layers.stale.length)
        warnings.push({
          code: "layers_stale",
          id,
          message: `${committed.layers.stale.length} layers are stale after the develop change`,
        });
      if (autoRequested) await progress.advance(1);
      return {
        schema: 1,
        ok: true,
        data: {
          id,
          develop_hash: developHash(next),
          render_hash: committed.renderHash,
          layers: { delta_applied: committed.layers.deltaApplied, stale: committed.layers.stale },
          auto,
        } satisfies CropData,
        warnings,
      };
    } catch (error) {
      if (error instanceof RevisionConflictError)
        throw new PhotoctlError("library_locked", error.message, {
          id,
          reason: "revision_conflict",
        });
      throw error;
    }
  } finally {
    try {
      await progress.stop();
    } finally {
      await lease.release();
    }
  }
}

async function analyze(
  handle: LibraryHandle,
  photo: StoredPhoto,
  state: ActiveDevelopState,
  env: RequestEnv,
  cwd: string,
  warnings: Warning[],
): Promise<number | null> {
  const id = state.photoId;
  const cacheRoot = cacheRootForLibrary(await readLibraryId(handle), cacheBase(env, cwd));
  const candidates = await resolveGraphSources({
    photo,
    resolver: createVolumeResolver(env.volumeMap, handle.path),
    pinned: {
      kind: "pinned-preview",
      path: pinnedEmbeddedJpegPath(cacheRoot, id),
      mediaType: "image/jpeg",
      orientation: 1,
    },
    pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${id}.jpg` },
    env,
  });
  for (const candidate of candidates) {
    try {
      const result = await detectOutputHorizon(
        {
          database: handle,
          libraryPath: handle.path,
          photoId: id,
          nodeId: state.pixelOutputNodeId,
          source: candidate.produce,
          developBaseDimensions: { w: photo.w, h: photo.h },
        },
        state.develop.straighten_deg ?? 0,
      );
      const warning = graphSourceWarning(id, candidate.fallback);
      if (warning) warnings.push(warning);
      return result;
    } catch (error) {
      if (!(error instanceof SourceEvaluationError)) throw error;
    }
  }
  throw new PhotoctlError("file_offline", "No photographic source is available", { id });
}
