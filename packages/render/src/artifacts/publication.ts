/* eslint-disable no-await-in-loop -- Durable nested directory creation must fsync each parent before descending. */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { displaySrgbToLinearRec2020, linearRec2020ToDisplaySrgb } from "../color.js";
import type { LinearImage } from "../decoder.js";
import {
  decodeArtifactLinearTiff,
  encodeArtifactLinearTiff,
  inspectArtifactLinearTiff,
  validateArtifactLinearTiff,
} from "../linear-tiff.js";
import type { Image16 } from "../source-render.js";
import {
  decodeMaskTiff,
  encodeMaskTiff,
  inspectMaskTiff,
  validateMaskTiff,
  type MaskImage,
} from "../mask-tiff.js";

export const MASK_ARTIFACT_MEDIA_TYPE = "image/vnd.photoctl.mask+tiff" as const;

export interface NormalizedArtifact {
  artifactHash: `a_${string}`;
  bytes: Buffer;
  extension: "tif";
  mediaType: "image/tiff" | typeof MASK_ARTIFACT_MEDIA_TYPE;
  w: number;
  h: number;
}

export async function normalizeMaskArtifact(mask: MaskImage): Promise<NormalizedArtifact> {
  const bytes = encodeMaskTiff(mask);
  return {
    artifactHash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
    bytes,
    extension: "tif",
    mediaType: MASK_ARTIFACT_MEDIA_TYPE,
    w: mask.w,
    h: mask.h,
  };
}

export interface PublishedArtifact extends Omit<NormalizedArtifact, "bytes"> {
  path: string;
  storageBytes: number;
}

/** Converts an external display result once, then encodes the canonical scene-linear working artifact. */
export async function normalizeArtifact(image: LinearImage | Image16): Promise<NormalizedArtifact> {
  let linear: LinearImage;
  if (image.space === "scene-linear-rec2020") {
    linear = image;
  } else if (image.space === "display-srgb") {
    linear = {
      w: image.w,
      h: image.h,
      orientationApplied: true,
      space: "scene-linear-rec2020",
      data: await displaySrgbToLinearRec2020(image.data),
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    };
  } else {
    throw new Error("Canonical artifacts require converted scene-linear pixels");
  }
  if (
    linear.orientationApplied !== true ||
    !Number.isSafeInteger(linear.w) ||
    !Number.isSafeInteger(linear.h) ||
    linear.w <= 0 ||
    linear.h <= 0 ||
    linear.data.length !== linear.w * linear.h * 3 ||
    !linear.data.every(Number.isFinite)
  ) {
    throw new Error("Canonical artifacts require oriented scene-linear Rec.2020 RGB f32 pixels");
  }
  const bytes = await encodeArtifactLinearTiff(linear);
  return {
    artifactHash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
    bytes,
    extension: "tif",
    mediaType: "image/tiff",
    w: linear.w,
    h: linear.h,
  };
}

export function artifactPath(
  libraryPath: string,
  artifactHash: string,
  extension: NormalizedArtifact["extension"],
): string {
  if (!/^a_[0-9a-f]{64}$/.test(artifactHash)) {
    throw new Error("Expected a_ followed by a full SHA-256 hash");
  }
  return join(
    resolve(libraryPath),
    "artifacts",
    "sha256",
    artifactHash.slice(2, 4),
    `${artifactHash}.${extension}`,
  );
}

/** Publishes with an atomic no-replace link; an existing identical object makes retries idempotent. */
export async function publishArtifact(
  libraryPath: string,
  artifact: NormalizedArtifact,
): Promise<PublishedArtifact> {
  const actualHash = `a_${createHash("sha256").update(artifact.bytes).digest("hex")}`;
  if (actualHash !== artifact.artifactHash) {
    throw new Error(`Artifact ${artifact.artifactHash} does not match its content hash`);
  }
  const path = artifactPath(libraryPath, artifact.artifactHash, artifact.extension);
  const directory = dirname(path);
  await ensureArtifactDirectory(libraryPath, artifact.artifactHash);
  const temporary = join(directory, `.${artifact.artifactHash}.${process.pid}.${randomUUID()}.tmp`);
  try {
    const output = await open(temporary, "wx", 0o600);
    try {
      await output.writeFile(artifact.bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    try {
      await link(temporary, path);
      await syncDirectory(directory);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const existing = await readFile(path);
      if (!existing.equals(artifact.bytes)) {
        const existingHash = `a_${createHash("sha256").update(existing).digest("hex")}`;
        if (existingHash === artifact.artifactHash) {
          throw new Error(`Artifact hash collision: ${artifact.artifactHash}`, { cause: error });
        }
        await rename(temporary, path);
        await syncDirectory(directory);
      }
    }
  } finally {
    await rm(temporary, { force: true });
    await syncDirectory(directory);
  }
  return {
    artifactHash: artifact.artifactHash,
    extension: artifact.extension,
    mediaType: artifact.mediaType,
    path,
    storageBytes: artifact.bytes.length,
    w: artifact.w,
    h: artifact.h,
  };
}

async function ensureArtifactDirectory(libraryPath: string, artifactHash: string): Promise<void> {
  const library = resolve(libraryPath);
  let parent = library;
  for (const name of ["artifacts", "sha256", artifactHash.slice(2, 4)]) {
    const child = join(parent, name);
    try {
      await mkdir(child);
      await syncDirectory(parent);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    parent = child;
  }
}

export async function readArtifactLinear(
  path: string,
  expectedHash?: string,
): Promise<LinearImage> {
  const bytes = await readFile(path);
  if (expectedHash && `a_${createHash("sha256").update(bytes).digest("hex")}` !== expectedHash) {
    throw new Error(`Canonical artifact content hash mismatch: ${path}`);
  }
  return await decodeArtifactLinearTiff(bytes);
}

export async function readArtifactMask(path: string, expectedHash?: string): Promise<MaskImage> {
  const bytes = await readFile(path);
  if (expectedHash && `a_${createHash("sha256").update(bytes).digest("hex")}` !== expectedHash) {
    throw new Error(`Canonical mask artifact content hash mismatch: ${path}`);
  }
  return decodeMaskTiff(bytes);
}

export async function readMaskArtifactBytes(
  path: string,
  expectedHash: string,
  expectedDimensions: { w: number; h: number },
): Promise<Buffer> {
  const bytes = await readVerifiedArtifactBytes(path, expectedHash);
  const layout = inspectMaskTiff(bytes);
  assertDimensions(path, layout, expectedDimensions);
  validateMaskTiff(bytes);
  return bytes;
}

/** Reads verified canonical bytes without decoding a duplicate f32 pixel array. */
export async function readArtifactBytes(
  path: string,
  expectedHash: string,
  expectedDimensions: { w: number; h: number },
): Promise<Buffer> {
  const bytes = await readVerifiedArtifactBytes(path, expectedHash);
  const dimensions = await validateArtifactLinearTiff(bytes);
  assertDimensions(path, dimensions, expectedDimensions);
  return bytes;
}

/** Reads hash/metadata-verified bytes; the native develop worker must validate every sample. */
export async function readArtifactBytesForNativeDevelop(
  path: string,
  expectedHash: string,
  expectedDimensions: { w: number; h: number },
): Promise<Buffer> {
  const bytes = await readVerifiedArtifactBytes(path, expectedHash);
  const layout = await inspectArtifactLinearTiff(bytes);
  assertDimensions(path, { w: layout.width, h: layout.height }, expectedDimensions);
  return bytes;
}

async function readVerifiedArtifactBytes(path: string, expectedHash: string): Promise<Buffer> {
  const bytes = await readFile(path);
  if (`a_${createHash("sha256").update(bytes).digest("hex")}` !== expectedHash) {
    throw new Error(`Canonical artifact content hash mismatch: ${path}`);
  }
  return bytes;
}

function assertDimensions(
  path: string,
  dimensions: { w: number; h: number },
  expectedDimensions: { w: number; h: number },
): void {
  if (dimensions.w !== expectedDimensions.w || dimensions.h !== expectedDimensions.h) {
    throw new Error(`Canonical artifact dimensions mismatch: ${path}`);
  }
}

/** Wraps bytes whose samples a native worker has already validated. */
export async function normalizeValidatedArtifactBytes(
  bytes: Buffer,
  expectedDimensions: { w: number; h: number },
): Promise<NormalizedArtifact> {
  const layout = await inspectArtifactLinearTiff(bytes);
  assertDimensions(
    "native develop output",
    { w: layout.width, h: layout.height },
    expectedDimensions,
  );
  return {
    artifactHash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
    bytes,
    extension: "tif",
    mediaType: "image/tiff",
    ...expectedDimensions,
  };
}

/** Converts a canonical linear artifact to clamped display pixels for view and delivery only. */
export async function readArtifactImage(path: string, expectedHash?: string): Promise<Image16> {
  const linear = await readArtifactLinear(path, expectedHash);
  const encoded = await linearRec2020ToDisplaySrgb(linear.data);
  const data = new Uint16Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    data[index] = Math.round(Math.max(0, Math.min(1, encoded[index])) * 65_535);
  }
  return {
    w: linear.w,
    h: linear.h,
    channels: 3,
    data,
    space: "display-srgb",
    orientationApplied: true,
  };
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
