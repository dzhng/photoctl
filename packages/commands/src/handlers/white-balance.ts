/* eslint-disable no-await-in-loop -- Ordered source fallback, never parallel decode. */
import { cacheRootForLibrary } from "@photoctl/importer";
import { createVolumeResolver, resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  commitDevelopState,
  developHash,
  readActiveDevelopState,
  RevisionConflictError,
  sampleWhiteBalance,
  SourceEvaluationError,
  type NeutralSample,
} from "@photoctl/render";
import {
  PhotoctlError,
  type Envelope,
  type StderrEvent,
  type Warning,
  type WhiteBalanceData,
} from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { graphSourceWarning, resolveGraphSources } from "../graph-source.js";
import { loadPhoto } from "../photo.js";
import { createProgressHeartbeat } from "../progress.js";

export async function whiteBalanceCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  emit?: (event: StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, { flags: ["--norm"], options: ["--point", "--region"] });
  const point = parsed.options.get("--point");
  const region = parsed.options.get("--region");
  if (parsed.positionals.length !== 1 || (point === undefined) === (region === undefined))
    throw new PhotoctlError(
      "usage",
      "white_balance requires one photo and exactly one --point or --region",
    );
  const values = (point ?? region)!.split(",").map((v) => (v.trim() ? Number(v) : NaN));
  if (values.length !== (point === undefined ? 4 : 2) || values.some((v) => !Number.isFinite(v)))
    throw new PhotoctlError("usage", "Sample coordinates must be finite comma-separated numbers");
  const lease = await openRequestLibrary(env, cwd, provided);
  const progress = createProgressHeartbeat({
    phase: "white_balance",
    total: 1,
    emit:
      emit &&
      (async (event) => {
        try {
          await emit(event);
        } catch {
          /* Advisory only. */
        }
      }),
  });
  try {
    const id = await resolvePhotoId(lease.handle, parsed.positionals[0]!);
    const photo = await loadPhoto(lease.handle, id);
    if (parsed.flags.has("--norm"))
      values.forEach((v, i) => {
        values[i] = v * (i % 2 === 0 ? photo.w : photo.h);
      });
    const [x, y, w, h] = values as [number, number, number, number];
    if (
      x < 0 ||
      y < 0 ||
      x >= photo.w ||
      y >= photo.h ||
      (region !== undefined && (w <= 0 || h <= 0 || x + w > photo.w || y + h > photo.h))
    )
      throw new PhotoctlError("usage", "Sample must lie within the oriented uncropped base");
    const sample: NeutralSample =
      point !== undefined ? { point: [x, y] } : { region: [x, y, w, h] };
    const state = await readActiveDevelopState(lease.handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    const cacheRoot = cacheRootForLibrary(await readLibraryId(lease.handle), cacheBase(env, cwd));
    const candidates = await resolveGraphSources({
      photo,
      resolver: createVolumeResolver(env.volumeMap, lease.handle.path),
      cacheRoot,
      env,
    });
    await progress.start();
    const warnings: Warning[] = [];
    let fit: Awaited<ReturnType<typeof sampleWhiteBalance>> | undefined;
    for (const candidate of candidates) {
      try {
        fit = await sampleWhiteBalance(
          {
            database: lease.handle,
            libraryPath: lease.handle.path,
            photoId: id,
            nodeId: state.developInputNodeId,
            source: candidate.produce,
            developBaseDimensions: { w: photo.w, h: photo.h },
          },
          sample,
        );
        const warning = graphSourceWarning(id, candidate.fallback);
        if (warning) warnings.push(warning);
        break;
      } catch (error) {
        if (!(error instanceof SourceEvaluationError)) throw error;
      }
    }
    if (!fit) throw new PhotoctlError("file_offline", "No editable base is available", { id });
    const white_balance = { temp_offset_k: fit.tempOffsetK, tint: fit.tint };
    const next = { ...state.develop, white_balance };
    try {
      const committed = await commitDevelopState(lease.handle, state, next);
      if (committed.layers.stale.length)
        warnings.push({
          code: "layers_stale",
          id,
          message: `${committed.layers.stale.length} layers are stale after the develop change`,
        });
      await progress.advance(1);
      return {
        schema: 1,
        ok: true,
        data: {
          id,
          develop_hash: developHash(next),
          render_hash: committed.renderHash,
          layers: { delta_applied: committed.layers.deltaApplied, stale: committed.layers.stale },
          white_balance,
          limited: fit.limited,
          residual: fit.residual,
          sample: fit.sample,
        } satisfies WhiteBalanceData,
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
