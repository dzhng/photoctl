import { createHash } from "node:crypto";
import { join } from "node:path";
import { resampleDisplaySrgb8, resampleDisplaySrgbRegion } from "@photoctl/img";
import sharp from "sharp";
import { orientedDimensions, type ExifOrientation } from "./coordinates.js";
import { srgb2014ProfilePath } from "./color.js";
import type { ImageSource } from "./decoder.js";
import { canonicalJson } from "./graph/recipes.js";
import { developFrame, frameSamplingDensity, viewFrame, type RenderFrame } from "./graph/frame.js";
import { developBaseRegion, projectDevelopView } from "./develop/geometry.js";
import {
  readValidPreviewArtifact,
  writePreviewArtifact,
  type PreviewSourceTier,
  type ValidPreviewArtifact,
} from "./preview-artifact.js";
import { PreviewCoordinator, type PreviewIndexAdapter } from "./preview-coordinator.js";
import { renderSource, type Image16 } from "./source-render.js";

export { PreviewDestinationError } from "./preview-artifact.js";
export interface ViewSpec {
  region: [number, number, number, number] | null;
  longEdge: number | "native";
}
export function viewHash(spec: ViewSpec): `v_${string}` {
  return `v_${createHash("sha256")
    .update(
      canonicalJson({
        kind: "view",
        long_edge: spec.longEdge,
        recipe_version: 3,
        region: spec.region,
      }),
    )
    .digest("hex")}`;
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
  frame: RenderFrame;
}

/** Public base-space views are planned against the exact raster retained with the master. */
export async function materializePreview(request: {
  coordinator: PreviewCoordinator;
  index: PreviewIndexAdapter;
  cacheRoot: string;
  photoId: string;
  renderHash: string;
  photo: { orientation: ExifOrientation; w: number; h: number };
  source: ImageSource;
  render?: () => Promise<{ image: Image16; frame: RenderFrame }>;
  logicalFrame?: RenderFrame;
  sourceTier?: PreviewSourceTier;
  view: ViewSpec;
}): Promise<MaterializedPreview> {
  const logical = request.logicalFrame ?? developFrame(request.photo, request.photo);
  const target = planView(logical, request.view);
  const directory = join(request.cacheRoot, "view", request.photoId, request.renderHash);
  const exactPath = join(directory, `${viewHash(request.view)}.jpg`);
  const masterPath = join(directory, "master.jpg");
  const native = request.view.region === null && request.view.longEdge === "native";
  const overview = request.view.region === null && request.view.longEdge === 1616;
  let sourceLimit: Promise<{ w: number; h: number } | undefined> | undefined;
  const atSourceLimit = async (artifact: ValidPreviewArtifact) => {
    sourceLimit ??= (async () => {
      if (request.source.kind !== "pinned-preview")
        return orientedDimensions(
          request.source,
          request.source.orientation ?? request.photo.orientation,
        );
      // The terminal fallback may be smaller or larger than retained pixels; its kind is not a density.
      try {
        const metadata = await sharp(request.source.path).metadata();
        if (!metadata.width || !metadata.height) return undefined;
        return orientedDimensions(
          { w: metadata.width, h: metadata.height },
          request.source.orientation,
        );
      } catch {
        // Retained pixels and their frame remain useful when the fallback itself is unavailable.
        return undefined;
      }
    })();
    const maximum = await sourceLimit;
    if (!maximum) return true;
    return artifact.frame.source.w >= maximum.w && artifact.frame.source.h >= maximum.h;
  };
  const sufficient = async (artifact: ValidPreviewArtifact) => {
    const plan = planView(artifact.frame, request.view);
    const originalFrame = developFrame(artifact.frame.catalog, artifact.frame.source);
    const originalCovers = frameSamplingDensity(target.frame, originalFrame) <= 1;
    // Native local layers cannot conceal a reduced original when richer source pixels return.
    return (
      (plan.w >= target.w && plan.h >= target.h && originalCovers) ||
      (await atSourceLimit(artifact))
    );
  };
  const render = async () => {
    if (request.render) return await request.render();
    const image = await renderSource(request.photo.orientation, request.source);
    return { image, frame: developFrame(request.photo, image) };
  };
  const master = async () =>
    await request.coordinator.materialize(
      {
        photoId: request.photoId,
        renderHash: request.renderHash,
        artifact: "master",
        path: masterPath,
      },
      async () => {
        const existing = await readValidPreviewArtifact(masterPath);
        if (existing && (await sufficient(existing)))
          return { path: masterPath, artifact: existing, created: false };
        const rendered = await render();
        await writePreviewArtifact(masterPath, await encodeJpeg(rendered.image), {
          sourceTier: request.sourceTier ?? request.source.kind,
          sourceDimensions: { w: rendered.image.w, h: rendered.image.h },
          frame: rendered.frame,
        });
        const artifact = await readValidPreviewArtifact(masterPath);
        if (!artifact) throw new Error(`Preview artifact failed validation: ${masterPath}`);
        return { path: masterPath, artifact, created: true };
      },
      request.index,
    );
  if (native) {
    const value = await master();
    return result(
      masterPath,
      value.artifact,
      target,
      value.created ? "render_master" : "exact_view",
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
      if (exact && (await sufficient(exact))) {
        return result(exactPath, exact, target, "exact_view");
      }
      if (overview) {
        const existing = await request.coordinator.reuseValid(masterPath, request.index);
        if (existing && (await sufficient(existing)))
          return await derive(existing, exactPath, request.view, target, "sufficient_full_frame");
        const rendered = await render();
        const plan = planView(rendered.frame, request.view);
        const pixels = resampleDisplaySrgbRegion(
          rendered.image.data,
          rendered.image.w,
          rendered.image.h,
          ...plan.region,
          plan.w,
          plan.h,
        );
        const bytes = await encodeJpeg({ ...rendered.image, w: plan.w, h: plan.h, data: pixels });
        const provenance = {
          sourceTier: request.sourceTier ?? request.source.kind,
          sourceDimensions: { w: rendered.image.w, h: rendered.image.h },
          frame: plan.frame,
        };
        await writePreviewArtifact(exactPath, bytes, provenance);
        return result(exactPath, { ...provenance, w: plan.w, h: plan.h }, target, "render_master");
      }
      const value = await master();
      return await derive(
        value.artifact,
        exactPath,
        request.view,
        target,
        value.created ? "render_master" : "sufficient_full_frame",
      );
    },
    request.index,
  );
}

function planView(frame: RenderFrame, view: ViewSpec) {
  const projected = projectDevelopView(view, { ...frame.raster, matrix: frame.baseToRaster }).view
    .region ?? [0, 0, frame.raster.w, frame.raster.h];
  const left = Math.max(0, Math.floor(projected[0]));
  const top = Math.max(0, Math.floor(projected[1]));
  const right = Math.min(frame.raster.w, Math.ceil(projected[0] + projected[2]));
  const bottom = Math.min(frame.raster.h, Math.ceil(projected[1] + projected[3]));
  const region: [number, number, number, number] = [left, top, right - left, bottom - top];
  const scale =
    view.longEdge === "native" ? 1 : Math.min(1, view.longEdge / Math.max(region[2], region[3]));
  const w = Math.max(1, Math.round(region[2] * scale));
  const h = Math.max(1, Math.round(region[3] * scale));
  return { region, w, h, frame: viewFrame(frame, region, { w, h }) };
}

async function derive(
  source: ValidPreviewArtifact,
  path: string,
  view: ViewSpec,
  target: ReturnType<typeof planView>,
  cacheSource: PreviewCacheSource,
): Promise<MaterializedPreview> {
  const plan = planView(source.frame, view);
  const [left, top, width, height] = plan.region;
  const { data, info } = await sharp(source.bytes, { failOn: "error" })
    .extract({ left, top, width, height })
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Buffer.from(resampleDisplaySrgb8(data, info.width, info.height, plan.w, plan.h));
  const bytes = await sharp(pixels, { raw: { width: plan.w, height: plan.h, channels: 3 } })
    .jpeg({ quality: 88 })
    .withIccProfile(srgb2014ProfilePath)
    .toBuffer();
  const provenance = {
    sourceTier: source.sourceTier,
    sourceDimensions: source.sourceDimensions,
    frame: plan.frame,
  };
  await writePreviewArtifact(path, bytes, provenance);
  return result(path, { ...provenance, w: plan.w, h: plan.h }, target, cacheSource);
}

function result(
  path: string,
  artifact: Pick<ValidPreviewArtifact, "frame" | "w" | "h" | "sourceTier" | "sourceDimensions">,
  target: ReturnType<typeof planView>,
  cacheSource: PreviewCacheSource,
): MaterializedPreview {
  const matrix = artifact.frame.baseToRaster;
  const pixelScale = Math.min(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
  return {
    path,
    actualRegion: developBaseRegion([0, 0, artifact.w, artifact.h], matrix),
    w: artifact.w,
    h: artifact.h,
    sourceDimensions: artifact.sourceDimensions,
    sourceTier: artifact.sourceTier,
    pixelScale,
    resolutionLimited: artifact.w + 1 < target.w || artifact.h + 1 < target.h,
    cacheSource,
    frame: artifact.frame,
  };
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
