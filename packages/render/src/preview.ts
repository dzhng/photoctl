import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import type { ExifOrientation } from "./coordinates.js";
import { srgb2014ProfilePath } from "./color.js";
import type { ImageSource } from "./decoder.js";
import {
  canonicalNodeRecipe,
  canonicalJson,
  logicalNodeId,
  recipeHash,
  renderHashForNode,
} from "./graph/recipes.js";
import {
  readValidPreviewArtifact,
  writePreviewArtifact,
  type PreviewSourceTier,
  type ValidPreviewArtifact,
} from "./preview-artifact.js";
import { PreviewCoordinator, type PreviewIndexAdapter } from "./preview-coordinator.js";
import { renderSource, type Image16 } from "./source-render.js";

export { PreviewDestinationError } from "./preview-artifact.js";

export interface SourceRenderState {
  orientation: ExifOrientation;
}

export interface ViewSpec {
  region: [number, number, number, number] | null;
  longEdge: number | "native";
}

export function sourceRenderHash(state: SourceRenderState): `r_${string}` {
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: "source",
      recipeVersion: 1,
      parameters: { orientation: state.orientation },
      inputNodeIds: [],
    }),
  );
  return renderHashForNode(logicalNodeId(recipe));
}

export function viewHash(spec: ViewSpec): `v_${string}` {
  const canonical = canonicalJson({
    kind: "view",
    long_edge: spec.longEdge,
    recipe_version: 1,
    region: spec.region,
  });
  return `v_${createHash("sha256").update(canonical).digest("hex")}`;
}

export type PreviewCacheSource = "exact_view" | "sufficient_full_frame" | "render_master";
export type { PreviewSourceTier } from "./preview-artifact.js";

export interface MaterializedPreview {
  path: string;
  actualRegion: [number, number, number, number];
  w: number;
  h: number;
  sourceDimensions: { w: number; h: number };
  sourceTier: PreviewSourceTier;
  pixelScale: number;
  resolutionLimited: boolean;
  cacheSource: PreviewCacheSource;
}

/** Materializes one view while preserving a single graph-evaluated full-frame master. */
export async function materializePreview(request: {
  coordinator: PreviewCoordinator;
  index: PreviewIndexAdapter;
  cacheRoot: string;
  photoId: string;
  renderHash: string;
  photo: SourceRenderState & { w: number; h: number };
  source: ImageSource;
  render?: () => Promise<Image16>;
  sourceTier?: PreviewSourceTier;
  view: ViewSpec;
}): Promise<MaterializedPreview> {
  const region = clampRegion(
    request.view.region ?? [0, 0, request.photo.w, request.photo.h],
    request.photo.w,
    request.photo.h,
  );
  const requestedScale = requestedPixelScale(request.view, region);
  const requestedWidth = Math.max(1, Math.round(region[2] * requestedScale));
  const requestedHeight = Math.max(1, Math.round(region[3] * requestedScale));
  const directory = join(request.cacheRoot, "view", request.photoId, request.renderHash);
  const exactPath = join(directory, `${viewHash(request.view)}.jpg`);
  const masterPath = join(directory, "master.jpg");
  const nativeFullFrame = request.view.region === null && request.view.longEdge === "native";
  const cheapOverview = request.view.region === null && request.view.longEdge === 1616;

  if (nativeFullFrame) {
    const master = await ensureMaster(request, masterPath, region, requestedWidth, requestedHeight);
    return result(
      master.path,
      region,
      master.artifact.w,
      master.artifact.h,
      master.artifact.sourceDimensions.w,
      master.artifact.sourceDimensions.h,
      master.artifact.sourceTier,
      requestedScale,
      master.created ? "render_master" : "exact_view",
    );
  }

  return await request.coordinator.materialize(
    {
      photoId: request.photoId,
      renderHash: request.renderHash,
      artifact: `view:${viewHash(request.view)}`,
      path: exactPath,
    },
    async () => {
      const exact = await readValidPreviewArtifact(exactPath);
      if (exact && exact.w >= requestedWidth && exact.h >= requestedHeight) {
        return result(
          exactPath,
          region,
          exact.w,
          exact.h,
          exact.sourceDimensions.w,
          exact.sourceDimensions.h,
          exact.sourceTier,
          requestedScale,
          "exact_view",
        );
      }

      // The default overview is deliberately cheap and does not create a full-frame master.
      if (cheapOverview) {
        const image = await renderPreviewSource(request);
        return await deriveRenderedView(
          image,
          exactPath,
          request.photo,
          region,
          requestedScale,
          request.sourceTier ?? request.source.kind,
          "render_master",
        );
      }

      const master = await ensureMaster(
        request,
        masterPath,
        region,
        requestedWidth,
        requestedHeight,
      );
      return await deriveView(
        master.artifact.bytes,
        master.path,
        exactPath,
        master.artifact,
        request.photo,
        region,
        requestedScale,
        master.created ? "render_master" : "sufficient_full_frame",
      );
    },
    request.index,
  );
}

async function ensureMaster(
  request: Parameters<typeof materializePreview>[0],
  masterPath: string,
  region: [number, number, number, number],
  requestedWidth: number,
  requestedHeight: number,
): Promise<{ path: string; artifact: ValidPreviewArtifact; created: boolean }> {
  return await request.coordinator.materialize(
    {
      photoId: request.photoId,
      renderHash: request.renderHash,
      artifact: "master",
      path: masterPath,
    },
    async () => {
      const existing = await readValidPreviewArtifact(masterPath);
      if (
        existing &&
        isSufficient(existing, request.photo, region, requestedWidth, requestedHeight)
      ) {
        return { path: masterPath, artifact: existing, created: false };
      }
      const image = await renderPreviewSource(request);
      const bytes = await encodeJpeg(image);
      const provenance = {
        sourceTier: request.source.kind,
        sourceDimensions: { w: image.w, h: image.h },
      };
      await writePreviewArtifact(masterPath, bytes, provenance);
      const artifact = await readValidPreviewArtifact(masterPath);
      if (!artifact) throw new Error(`Preview artifact failed validation: ${masterPath}`);
      return {
        path: masterPath,
        artifact,
        created: true,
      };
    },
    request.index,
  );
}

async function renderPreviewSource(
  request: Parameters<typeof materializePreview>[0],
): Promise<Image16> {
  return request.render
    ? await request.render()
    : await renderSource(request.photo.orientation, request.source);
}

async function deriveRenderedView(
  image: Image16,
  path: string,
  photo: { w: number; h: number },
  region: [number, number, number, number],
  requestedScale: number,
  sourceTier: PreviewSourceTier,
  cacheSource: PreviewCacheSource,
): Promise<MaterializedPreview> {
  const bytes = image8BitBytes(image);
  return await deriveView(
    bytes,
    path,
    path,
    {
      w: image.w,
      h: image.h,
      rawChannels: image.channels,
      sourceTier,
      sourceDimensions: { w: image.w, h: image.h },
    },
    photo,
    region,
    requestedScale,
    cacheSource,
  );
}

async function deriveView(
  bytes: Buffer,
  sourcePath: string,
  outputPath: string,
  source: {
    w: number;
    h: number;
    rawChannels?: 3;
    sourceTier: PreviewSourceTier;
    sourceDimensions: { w: number; h: number };
  },
  photo: { w: number; h: number },
  region: [number, number, number, number],
  requestedScale: number,
  cacheSource: PreviewCacheSource,
): Promise<MaterializedPreview> {
  const availableScale = Math.min(source.w / photo.w, source.h / photo.h, 1);
  const pixelScale = Math.min(requestedScale, availableScale);
  const width = Math.max(1, Math.round(region[2] * pixelScale));
  const height = Math.max(1, Math.round(region[3] * pixelScale));
  const sourceRegion = mapRegion(region, photo, source);
  const pipeline = source.rawChannels
    ? sharp(bytes, { raw: { width: source.w, height: source.h, channels: source.rawChannels } })
    : sharp(bytes, { failOn: "error" });
  const output = await pipeline
    .extract(sourceRegion)
    .resize({ width, height, fit: "fill", withoutEnlargement: true })
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .jpeg({ quality: 88 })
    .withIccProfile(srgb2014ProfilePath)
    .toBuffer();
  if (outputPath !== sourcePath || source.rawChannels) {
    await writePreviewArtifact(outputPath, output, source);
  }
  return result(
    outputPath,
    region,
    width,
    height,
    source.sourceDimensions.w,
    source.sourceDimensions.h,
    source.sourceTier,
    requestedScale,
    cacheSource,
  );
}

function result(
  path: string,
  actualRegion: [number, number, number, number],
  w: number,
  h: number,
  sourceWidth: number,
  sourceHeight: number,
  sourceTier: PreviewSourceTier,
  requestedScale: number,
  cacheSource: PreviewCacheSource,
): MaterializedPreview {
  const pixelScale = Math.min(w / actualRegion[2], h / actualRegion[3]);
  return {
    path,
    actualRegion,
    w,
    h,
    sourceDimensions: { w: sourceWidth, h: sourceHeight },
    sourceTier,
    pixelScale,
    resolutionLimited: pixelScale + 1 / Math.max(actualRegion[2], actualRegion[3]) < requestedScale,
    cacheSource,
  };
}

function requestedPixelScale(view: ViewSpec, region: [number, number, number, number]): number {
  return view.longEdge === "native"
    ? 1
    : Math.min(1, view.longEdge / Math.max(region[2], region[3]));
}

function isSufficient(
  source: { w: number; h: number },
  photo: { w: number; h: number },
  region: [number, number, number, number],
  requestedWidth: number,
  requestedHeight: number,
): boolean {
  const mapped = mapRegion(region, photo, source);
  return mapped.width >= requestedWidth && mapped.height >= requestedHeight;
}

function mapRegion(
  region: [number, number, number, number],
  photo: { w: number; h: number },
  source: { w: number; h: number },
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.round(region[0] * (source.w / photo.w)));
  const top = Math.max(0, Math.round(region[1] * (source.h / photo.h)));
  return {
    left,
    top,
    width: Math.max(1, Math.min(source.w - left, Math.round(region[2] * (source.w / photo.w)))),
    height: Math.max(1, Math.min(source.h - top, Math.round(region[3] * (source.h / photo.h)))),
  };
}

function clampRegion(
  region: [number, number, number, number],
  imageWidth: number,
  imageHeight: number,
): [number, number, number, number] {
  const left = Math.max(0, Math.floor(region[0]));
  const top = Math.max(0, Math.floor(region[1]));
  const right = Math.min(imageWidth, Math.ceil(region[0] + region[2]));
  const bottom = Math.min(imageHeight, Math.ceil(region[1] + region[3]));
  if (right <= left || bottom <= top) throw new Error("Preview region is outside the image");
  return [left, top, right - left, bottom - top];
}

async function encodeJpeg(image: Image16): Promise<Buffer> {
  return await sharp(image8BitBytes(image), {
    raw: { width: image.w, height: image.h, channels: image.channels },
  })
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .jpeg({ quality: 88 })
    .withIccProfile(srgb2014ProfilePath)
    .toBuffer();
}

function image8BitBytes(image: Image16): Buffer {
  const bytes = Buffer.allocUnsafe(image.data.length);
  for (let index = 0; index < image.data.length; index += 1) {
    bytes[index] = Math.round(image.data[index] / 257);
  }
  return bytes;
}
