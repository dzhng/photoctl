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
  materializePreview,
  PreviewDestinationError,
  PreviewCoordinator,
  renderStateHash,
  viewHash,
  type ImageSource,
  type ViewSpec,
} from "@photoctl/render";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { resolveOnlineImageSource } from "../image-source.js";
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
    const renderHash = renderStateHash({
      contentKey: photo.contentKey,
      contentHash: photo.contentHash,
      orientation: photo.orientation,
    });
    const view = parseViewSpec(parsed.options, parsed.flags.has("--norm"), photo.w, photo.h);
    const selected = await resolveOnlineImageSource(photo, resolver);
    const pinned: ImageSource = {
      kind: "pinned-preview",
      path: pinnedEmbeddedJpegPath(cacheRoot, id),
      mediaType: "image/jpeg",
      orientation: 1,
    };
    const materialized = await materializeWithFallback(
      { id, cacheRoot, renderHash, photo, view, coordinator, index },
      selected?.source ?? pinned,
      pinned,
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
    if (
      (materialized.usedFallback ||
        (materialized.source.kind === "pinned-preview" && photo.files.length > 0)) &&
      !warnings.some((warning) => warning.code === "source_offline")
    ) {
      warnings.push({
        code: "source_offline",
        id,
        message: "Preview uses the pinned offline source",
      });
    }
    if (materialized.preview.resolutionLimited) {
      warnings.push({
        code: "preview_resolution_limited",
        id,
        message: "The requested preview resolution exceeds the available source tier",
      });
    }
    const projection = previewProjection(
      materialized.preview.actualRegion,
      materialized.preview.w,
      materialized.preview.h,
    );
    const data: ShowData = {
      id,
      dims: {
        w: photo.w,
        h: photo.h,
        orientation: photo.orientation,
        note: "oriented, uncropped — the coordinate space",
      },
      crop: null,
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
          region: materialized.preview.actualRegion,
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
      develop: {},
      develop_hash: null,
      render_hash: renderHash,
      layers: { count: 0, stale: 0 },
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

function previewProjection(
  region: [number, number, number, number],
  width: number,
  height: number,
) {
  const [x, y, w, h] = region;
  const scaleX = width / w;
  const scaleY = height / h;
  return {
    base_to_view: { a: scaleX, b: 0, c: 0, d: scaleY, e: -x * scaleX, f: -y * scaleY },
    view_to_base: { a: 1 / scaleX, b: 0, c: 0, d: 1 / scaleY, e: x, f: y },
    visible_base_polygon: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ] as [[number, number], [number, number], [number, number], [number, number]],
  };
}

async function materializeWithFallback(
  context: {
    id: string;
    cacheRoot: string;
    renderHash: string;
    photo: StoredPhoto;
    view: ViewSpec;
    coordinator: PreviewCoordinator;
    index: CacheIndex;
  },
  source: ImageSource,
  pinned: ImageSource,
) {
  try {
    return {
      preview: await materializePreview({
        coordinator: context.coordinator,
        index: context.index,
        cacheRoot: context.cacheRoot,
        photoId: context.id,
        renderHash: context.renderHash,
        photo: context.photo,
        source,
        view: context.view,
      }),
      source,
      usedFallback: false,
    };
  } catch (error) {
    if (error instanceof PreviewDestinationError) {
      throw new PhotoctlError("volume_readonly", error.message, { path: error.path });
    }
    if (source.kind === "pinned-preview") {
      throw new PhotoctlError("file_offline", "Pinned preview is unavailable", { id: context.id });
    }
    try {
      return {
        preview: await materializePreview({
          coordinator: context.coordinator,
          index: context.index,
          cacheRoot: context.cacheRoot,
          photoId: context.id,
          renderHash: context.renderHash,
          photo: context.photo,
          source: pinned,
          view: context.view,
        }),
        source: pinned,
        usedFallback: true,
      };
    } catch (fallbackError) {
      if (fallbackError instanceof PreviewDestinationError) {
        throw new PhotoctlError("volume_readonly", fallbackError.message, {
          path: fallbackError.path,
        });
      }
      throw new PhotoctlError("file_offline", "No preview source is available", { id: context.id });
    }
  }
}
