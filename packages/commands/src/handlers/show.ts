/* eslint-disable no-await-in-loop -- Source fallback order is semantic and bounds native decoder memory. */
import { cacheRootForLibrary, formatShotInstant, pinnedEmbeddedJpegPath } from "@photoctl/importer";
import {
  CacheIndex,
  createVolumeResolver,
  resolvePhotoId,
  xmpStateIsStale,
  type LibraryHandle,
} from "@photoctl/library";
import { PhotoctlError, type Envelope, type ShowData, type Warning } from "@photoctl/protocol";
import {
  developHash,
  activeLayerStatus,
  developBaseRegion,
  developGeometryMatrix,
  developPreviewProjection,
  DevelopRegionOutsideError,
  projectDevelopView,
  materializePreview,
  evaluateGraphNode,
  PreviewDestinationError,
  PreviewCoordinator,
  readActiveDevelopState,
  readArtifactImage,
  SourceEvaluationError,
  viewHash,
  type ImageSource,
  type ViewSpec,
} from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import {
  graphSourceWarning,
  resolveGraphSources,
  type GraphSourceCandidate,
} from "../graph-source.js";
import { loadPhoto, type StoredPhoto } from "../photo.js";

export async function showCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedCoordinator?: PreviewCoordinator,
): Promise<Envelope> {
  const parsed = parseArguments(args, {
    flags: ["--norm"],
    options: ["--preview-size", "--region"],
  });
  if (parsed.positionals.length !== 1) {
    throw new PhotoctlError("usage", "show requires exactly one photo ID or prefix");
  }
  const lease = await openRequestLibrary(env, cwd, provided);
  const { handle } = lease;
  try {
    const id = await resolvePhotoId(handle, parsed.positionals[0]);
    const photo = await loadPhoto(handle, id);
    const libraryId = await readLibraryId(handle);
    const resolver = createVolumeResolver(env.volumeMap, handle.path);
    const cacheRoot = cacheRootForLibrary(libraryId, cacheBase(env, cwd));
    const index = new CacheIndex(handle, cacheRoot);
    const coordinator = providedCoordinator ?? new PreviewCoordinator();
    const locators = await Promise.all(
      photo.files.map(async (file) => ({
        volume: file.volumeUuid,
        path: file.relPath,
        online: (await resolver.resolve(file.volumeUuid, file.relPath)).online,
      })),
    );
    const warnings: Warning[] = locators.some((locator) => !locator.online)
      ? [{ code: "source_offline", id, message: "One or more source files are offline" }]
      : [];
    const document = await readActiveDevelopState(handle, {
      photoId: id,
      orientation: photo.orientation,
    });
    const layerStatus = activeLayerStatus(document);
    if (layerStatus.staleIds.length > 0) {
      warnings.push({
        code: "layers_stale",
        id,
        message: `${layerStatus.staleIds.length} ${layerStatus.staleIds.length === 1 ? "layer is" : "layers are"} stale`,
      });
    }
    if (layerStatus.unfilledVacancyIds.length > 0) {
      warnings.push({
        code: "vacancy_unfilled",
        id,
        message: `${layerStatus.unfilledVacancyIds.length} ${layerStatus.unfilledVacancyIds.length === 1 ? "vacancy is" : "vacancies are"} unfilled`,
      });
    }
    const renderHash = document.renderHash;
    const view = parseViewSpec(parsed.options, parsed.flags.has("--norm"), photo.w, photo.h);
    const geometry = developGeometryMatrix(photo.w, photo.h, document.develop);
    let projected: ReturnType<typeof projectDevelopView>;
    try {
      projected = projectDevelopView(view, geometry);
    } catch (error) {
      if (error instanceof DevelopRegionOutsideError) {
        throw new PhotoctlError("usage", "--region does not intersect the visible image");
      }
      throw error;
    }
    const pinned: ImageSource = {
      kind: "pinned-preview",
      path: pinnedEmbeddedJpegPath(cacheRoot, id),
      mediaType: "image/jpeg",
      orientation: 1,
    };
    const candidates = await resolveGraphSources({
      photo,
      resolver,
      pinned,
      pinnedLocator: { kind: "pinned-preview", cache_path: `emb/${id}.jpg` },
      env,
    });
    const materialized = await materializeWithFallback(
      {
        id,
        cacheRoot,
        renderHash,
        photo: { ...photo, w: geometry.w, h: geometry.h },
        developBaseDimensions: { w: photo.w, h: photo.h },
        view: projected.view,
        cacheView: view,
        coordinator,
        index,
        handle,
        outputNodeId: document.outputNodeId,
      },
      candidates,
    );
    const tags = await handle.query<{ tag: string }>(
      "SELECT tag FROM tags WHERE photo_id = $1 ORDER BY tag",
      [id],
    );
    const xmpRows = await handle.query<{
      sidecar_path: string;
      read_at: string;
      sidecar_mtime: string;
    }>(
      `SELECT sidecar_path, read_at::text, sidecar_mtime::text
       FROM xmp_state WHERE photo_id = $1`,
      [id],
    );
    const xmpRow = xmpRows.rows[0];
    const xmpStale = xmpRow
      ? await xmpStateIsStale(xmpRow.sidecar_path, xmpRow.sidecar_mtime)
      : false;
    if (xmpStale)
      warnings.push({ code: "xmp_stale", id, message: "The source XMP changed after it was read" });
    const sourceWarning = graphSourceWarning(id, materialized.candidate.fallback);
    if (sourceWarning && !warnings.some((warning) => warning.code === sourceWarning.code)) {
      warnings.push(sourceWarning);
    }
    if (materialized.preview.resolutionLimited) {
      warnings.push({
        code: "preview_resolution_limited",
        id,
        message: "The requested preview resolution exceeds the available source tier",
      });
    }
    const projection = developPreviewProjection(
      materialized.preview.actualRegion,
      materialized.preview.w,
      materialized.preview.h,
      geometry.matrix,
    );
    const data: ShowData = {
      id,
      dims: {
        w: photo.w,
        h: photo.h,
        orientation: photo.orientation,
        note: "oriented, uncropped — the coordinate space",
      },
      crop: developGeometrySummary(document.develop),
      camera: photo.camera,
      exposure: photo.exposure,
      shot:
        photo.shotAt && photo.shotOffsetMin !== null
          ? formatShotInstant(new Date(photo.shotAt), photo.shotOffsetMin)
          : null,
      rating: photo.rating,
      flag: photo.flag,
      label: photo.label,
      tags: tags.rows.map((row) => row.tag),
      preview: materialized.preview.path,
      preview_info: {
        render_hash: renderHash,
        view_hash: viewHash(view),
        requested: { region: view.region, long_edge: view.longEdge },
        actual: {
          region: developBaseRegion(materialized.preview.actualRegion, geometry.matrix),
          w: materialized.preview.w,
          h: materialized.preview.h,
        },
        source_tier: materialized.preview.sourceTier,
        source_dimensions: materialized.preview.sourceDimensions,
        pixel_scale: materialized.preview.pixelScale,
        resolution_limited: materialized.preview.resolutionLimited,
        cache_source: materialized.preview.cacheSource,
        color_space: "srgb",
        icc: "sRGB2014",
        ...projection,
      },
      locators,
      content_key: photo.contentKey,
      develop: document.develop,
      develop_hash: document.hasDevelopNode ? developHash(document.develop) : null,
      render_hash: renderHash,
      layers: { count: layerStatus.count, stale: layerStatus.staleIds.length },
      xmp: xmpRow
        ? {
            sidecar_path: xmpRow.sidecar_path,
            read_at: xmpRow.read_at,
            sidecar_mtime: xmpRow.sidecar_mtime,
            stale: xmpStale,
          }
        : null,
    };
    return { schema: 1, ok: true, data, warnings };
  } finally {
    await lease.release();
  }
}

function developGeometrySummary(develop: ShowData["develop"]): ShowData["crop"] {
  const geometry = develop as {
    crop?: { x: number; y: number; w: number; h: number };
    rotate?: 0 | 90 | 180 | 270;
    straighten_deg?: number;
    aspect_ratio?: string;
  };
  if (!geometry.crop && !geometry.rotate && !geometry.straighten_deg && !geometry.aspect_ratio) {
    return null;
  }
  return {
    rect: geometry.crop ?? null,
    rotate: geometry.rotate ?? 0,
    straighten_deg: geometry.straighten_deg ?? 0,
    aspect_ratio: geometry.aspect_ratio ?? null,
  };
}

function parseViewSpec(
  options: Map<string, string>,
  normalized: boolean,
  width: number,
  height: number,
): ViewSpec {
  const regionValue = options.get("--region");
  if (normalized && !regionValue) throw new PhotoctlError("usage", "--norm requires --region");
  const region = regionValue ? parseRegion(regionValue, normalized, width, height) : null;
  const size = options.get("--preview-size");
  return {
    region,
    longEdge: size === undefined ? (region ? "native" : 1616) : parsePreviewSize(size),
  };
}

function parsePreviewSize(value: string): number | "native" {
  if (value === "native") return value;
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new PhotoctlError("usage", "--preview-size must be a positive integer or native");
  }
  return size;
}

function parseRegion(
  value: string,
  normalized: boolean,
  width: number,
  height: number,
): [number, number, number, number] {
  const values = value.split(",").map(Number);
  if (values.length !== 4 || values.some((item) => !Number.isFinite(item))) {
    throw new PhotoctlError("usage", "--region must be x,y,w,h");
  }
  if (normalized && values.some((item) => item < 0 || item > 1)) {
    throw new PhotoctlError("usage", "normalized region values must be between 0 and 1");
  }
  const region = normalized
    ? [values[0] * width, values[1] * height, values[2] * width, values[3] * height]
    : values;
  if (region[2] <= 0 || region[3] <= 0) {
    throw new PhotoctlError("usage", "--region must have a positive size");
  }
  if (
    region[0] >= width ||
    region[1] >= height ||
    region[0] + region[2] <= 0 ||
    region[1] + region[3] <= 0
  ) {
    throw new PhotoctlError("usage", "--region does not intersect the visible image");
  }
  return [region[0], region[1], region[2], region[3]];
}

async function materializeWithFallback(
  context: {
    id: string;
    cacheRoot: string;
    renderHash: string;
    photo: StoredPhoto;
    developBaseDimensions: { w: number; h: number };
    view: ViewSpec;
    cacheView: ViewSpec;
    coordinator: PreviewCoordinator;
    index: CacheIndex;
    handle: LibraryHandle;
    outputNodeId: string;
  },
  candidates: GraphSourceCandidate[],
) {
  for (const candidate of candidates) {
    try {
      return {
        preview: await materializePreview({
          coordinator: context.coordinator,
          index: context.index,
          cacheRoot: context.cacheRoot,
          photoId: context.id,
          renderHash: context.renderHash,
          photo: context.photo,
          source: candidate.source,
          sourceTier: candidate.source.kind,
          render: async () => await evaluatePreviewGraph(context, candidate),
          view: context.view,
          cacheView: context.cacheView,
        }),
        candidate,
      };
    } catch (error) {
      if (error instanceof PreviewDestinationError) {
        throw new PhotoctlError("volume_readonly", error.message, {
          path: error.path,
        });
      }
      if (!(error instanceof SourceEvaluationError)) {
        throw new PhotoctlError(
          "decoder_unavailable",
          error instanceof Error ? error.message : String(error),
          { id: context.id },
        );
      }
    }
  }
  throw new PhotoctlError("file_offline", "No preview source is available", { id: context.id });
}

async function evaluatePreviewGraph(
  context: {
    id: string;
    photo: StoredPhoto;
    developBaseDimensions: { w: number; h: number };
    handle: LibraryHandle;
    outputNodeId: string;
  },
  candidate: GraphSourceCandidate,
) {
  const evaluated = await evaluateGraphNode({
    database: context.handle,
    libraryPath: context.handle.path,
    photoId: context.id,
    nodeId: context.outputNodeId,
    source: candidate.produce,
    developBaseDimensions: context.developBaseDimensions,
  });
  return await readArtifactImage(evaluated.artifact.path);
}
