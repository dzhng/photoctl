/* eslint-disable no-await-in-loop -- Durable nested directory creation must fsync each parent before descending. */
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { encodeDisplayTiff } from "../linear-tiff.js";
import type { Image16 } from "../source-render.js";
import sharp from "sharp";
import { srgb2014ProfilePath } from "../color.js";

export interface NormalizedArtifact {
  artifactHash: `a_${string}`;
  bytes: Buffer;
  extension: "tif";
  mediaType: "image/tiff";
  w: number;
  h: number;
}

export interface PublishedArtifact extends Omit<NormalizedArtifact, "bytes"> {
  path: string;
  storageBytes: number;
}

/** Converts display pixels to the one canonical lossless representation owned by the artifact store. */
export async function normalizeArtifact(image: Image16): Promise<NormalizedArtifact> {
  if (
    image.space !== "display-srgb" ||
    image.channels !== 3 ||
    image.orientationApplied !== true ||
    !Number.isSafeInteger(image.w) ||
    !Number.isSafeInteger(image.h) ||
    image.w <= 0 ||
    image.h <= 0 ||
    image.data.length !== image.w * image.h * image.channels
  ) {
    throw new Error("Canonical artifacts require oriented display-sRGB RGB16 pixels");
  }
  const bytes = await encodeDisplayTiff(image);
  return {
    artifactHash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
    bytes,
    extension: "tif",
    mediaType: "image/tiff",
    w: image.w,
    h: image.h,
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

export async function readArtifactImage(path: string, expectedHash?: string): Promise<Image16> {
  const bytes = await readFile(path);
  if (expectedHash && `a_${createHash("sha256").update(bytes).digest("hex")}` !== expectedHash) {
    throw new Error(`Canonical artifact content hash mismatch: ${path}`);
  }
  const metadata = await sharp(bytes, { failOn: "error" }).metadata();
  const expectedProfile = await readFile(srgb2014ProfilePath);
  if (
    metadata.format !== "tiff" ||
    metadata.depth !== "ushort" ||
    metadata.bitsPerSample !== 16 ||
    !metadata.width ||
    !metadata.height ||
    !metadata.icc?.equals(expectedProfile)
  ) {
    throw new Error(`Canonical artifact failed validation: ${path}`);
  }
  const decoded = await sharp(bytes, { failOn: "error" })
    .toColourspace("rgb16")
    .removeAlpha()
    .raw({ depth: "ushort" })
    .toBuffer({ resolveWithObject: true });
  const data = new Uint16Array(decoded.data.byteLength / Uint16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = decoded.data.readUInt16LE(index * Uint16Array.BYTES_PER_ELEMENT);
  }
  return {
    w: decoded.info.width,
    h: decoded.info.height,
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
