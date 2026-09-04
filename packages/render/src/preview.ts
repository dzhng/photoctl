import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { ExifOrientation } from "./coordinates.js";
import { srgb2014ProfilePath } from "./color.js";
import type { ImageSource } from "./decoder.js";
import { renderPhoto, type Image16 } from "./graph.js";

export interface RenderState {
  contentKey: string;
  orientation: ExifOrientation;
}

export interface ViewSpec {
  region: [number, number, number, number] | null;
  longEdge: number | "native";
}

export function renderStateHash(state: RenderState): string {
  const canonical = JSON.stringify({
    content_key: state.contentKey,
    orientation: state.orientation,
  });
  return `r_${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

export function viewHash(spec: ViewSpec): string {
  const canonical = JSON.stringify({ region: spec.region, long_edge: spec.longEdge });
  return `v_${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

export type PreviewCacheSource = "exact_view" | "sufficient_full_frame" | "render_master";

export class PreviewDestinationError extends Error {
  readonly code = "volume_readonly";

  constructor(
    readonly path: string,
    readonly reason: unknown,
  ) {
    super(`Could not write preview cache: ${path}`);
  }
}

export interface MaterializedPreview {
  path: string;
  actualRegion: [number, number, number, number];
  w: number;
  h: number;
  sourceDimensions: { w: number; h: number };
  pixelScale: number;
  resolutionLimited: boolean;
  cacheSource: PreviewCacheSource;
}

/** Materializes one view while preserving a single graph-evaluated full-frame master. */
export async function materializePreview(request: {
  cacheRoot: string;
  photoId: string;
  renderHash: string;
  photo: RenderState & { w: number; h: number };
  source: ImageSource;
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

  const exact = nativeFullFrame ? undefined : await readValidJpeg(exactPath);
  if (exact && exact.w >= requestedWidth && exact.h >= requestedHeight) {
    return result(
      exactPath,
      region,
      exact.w,
      exact.h,
      exact.w,
      exact.h,
      requestedScale,
      "exact_view",
    );
  }

  const master = await readValidJpeg(masterPath);
  if (master && isSufficient(master, request.photo, region, requestedWidth, requestedHeight)) {
    if (nativeFullFrame) {
      return result(
        masterPath,
        region,
        master.w,
        master.h,
        master.w,
        master.h,
        requestedScale,
        "exact_view",
      );
    }
    return await deriveView(
      master.bytes,
      masterPath,
      exactPath,
      directory,
      master,
      request.photo,
      region,
      requestedScale,
      "sufficient_full_frame",
    );
  }

  // The default overview is deliberately cheap and does not create a full-frame master.
  if (cheapOverview) {
    const image = await renderPhoto({ orientation: request.photo.orientation }, request.source);
    return await deriveRenderedView(
      image,
      exactPath,
      directory,
      request.photo,
      region,
      requestedScale,
      "render_master",
    );
  }

  const image = await renderPhoto({ orientation: request.photo.orientation }, request.source);
  const masterBytes = await encodeJpeg(image);
  await writeAtomically(masterPath, directory, masterBytes);
  const renderedMaster = { bytes: masterBytes, w: image.w, h: image.h };
  if (nativeFullFrame) {
    return result(
      masterPath,
      region,
      image.w,
      image.h,
      image.w,
      image.h,
      requestedScale,
      "render_master",
    );
  }
  return await deriveView(
    masterBytes,
    masterPath,
    exactPath,
    directory,
    renderedMaster,
    request.photo,
    region,
    requestedScale,
    "render_master",
  );
}

async function deriveRenderedView(
  image: Image16,
  path: string,
  directory: string,
  photo: { w: number; h: number },
  region: [number, number, number, number],
  requestedScale: number,
  cacheSource: PreviewCacheSource,
): Promise<MaterializedPreview> {
  const bytes = image8BitBytes(image);
  return await deriveView(
    bytes,
    path,
    path,
    directory,
    { w: image.w, h: image.h, rawChannels: image.channels },
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
  directory: string,
  source: { w: number; h: number; rawChannels?: 3 },
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
    await writeAtomically(outputPath, directory, output);
  }
  return result(outputPath, region, width, height, source.w, source.h, requestedScale, cacheSource);
}

function result(
  path: string,
  actualRegion: [number, number, number, number],
  w: number,
  h: number,
  sourceWidth: number,
  sourceHeight: number,
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
  const x = Math.max(0, Math.min(imageWidth - 1, Math.floor(region[0])));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.floor(region[1])));
  const w = Math.max(1, Math.min(imageWidth - x, Math.ceil(region[2])));
  const h = Math.max(1, Math.min(imageHeight - y, Math.ceil(region[3])));
  return [x, y, w, h];
}

async function readValidJpeg(
  path: string,
): Promise<{ bytes: Buffer; w: number; h: number } | undefined> {
  try {
    const bytes = await readFile(path);
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    await sharp(bytes, { failOn: "error" }).stats();
    const expectedProfile = await readFile(srgb2014ProfilePath);
    if (
      metadata.format !== "jpeg" ||
      !metadata.width ||
      !metadata.height ||
      !metadata.icc?.equals(expectedProfile)
    ) {
      return undefined;
    }
    return { bytes, w: metadata.width, h: metadata.height };
  } catch {
    return undefined;
  }
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

async function writeAtomically(path: string, directory: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    const output = await open(temporary, "w");
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, path);
  } catch (error) {
    throw new PreviewDestinationError(path, error);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
