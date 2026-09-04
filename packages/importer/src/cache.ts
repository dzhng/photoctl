import { homedir } from "node:os";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { srgb2014ProfilePath } from "@photoctl/render";
import { readFileRange } from "./file-range.js";

export function cacheRootForLibrary(libraryId: string, baseOverride?: string): string {
  const base = baseOverride
    ? resolve(baseOverride)
    : join(homedir(), "Library", "Caches", "photoctl");
  return join(base, libraryId);
}

export function pinnedEmbeddedJpegPath(cacheRoot: string, photoId: string): string {
  return join(cacheRoot, "emb", `${photoId}.jpg`);
}

export class PinnedPreviewSourceError extends Error {
  constructor(readonly reason: unknown) {
    super("Could not read the pinned-preview source");
  }
}

export class PinnedPreviewDestinationError extends Error {
  constructor(readonly reason: unknown) {
    super("Could not write the pinned-preview destination");
  }
}

export async function pinnedEmbeddedJpegMatches(
  cacheRoot: string,
  photoId: string,
  sourcePath: string,
  range: { offset: number; length: number },
  orientation: number,
): Promise<boolean> {
  try {
    const [pinned, source] = await Promise.all([
      readFile(pinnedEmbeddedJpegPath(cacheRoot, photoId)),
      createEmbeddedPreviewJpeg(sourcePath, range, orientation),
    ]);
    await Promise.all([
      sharp(pinned, { failOn: "error" }).stats(),
      sharp(source, { failOn: "error" }).stats(),
    ]);
    return pinned.equals(source);
  } catch {
    return false;
  }
}

export async function createDecodedPreviewJpeg(sourcePath: string): Promise<Buffer> {
  return await sharp(sourcePath, { failOn: "error" })
    .rotate()
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .resize({ width: 1616, height: 1616, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .withIccProfile(srgb2014ProfilePath)
    .toBuffer();
}

export async function pinnedPreviewMatches(
  cacheRoot: string,
  photoId: string,
  expected: Uint8Array,
): Promise<boolean> {
  try {
    return (await readFile(pinnedEmbeddedJpegPath(cacheRoot, photoId))).equals(expected);
  } catch {
    return false;
  }
}

export async function pinPreviewBytes(
  cacheRoot: string,
  photoId: string,
  bytes: Uint8Array,
): Promise<{ path: string; bytes: number }> {
  try {
    return await writePinnedPreview(cacheRoot, photoId, bytes);
  } catch (error) {
    throw new PinnedPreviewDestinationError(error);
  }
}

export async function pinEmbeddedJpeg(
  cacheRoot: string,
  photoId: string,
  sourcePath: string,
  range: { offset: number; length: number },
  orientation: number,
): Promise<{ path: string; bytes: number }> {
  let bytes: Buffer;
  try {
    bytes = await createEmbeddedPreviewJpeg(sourcePath, range, orientation);
  } catch (error) {
    throw new PinnedPreviewSourceError(error);
  }
  try {
    return await writePinnedPreview(cacheRoot, photoId, bytes);
  } catch (error) {
    throw new PinnedPreviewDestinationError(error);
  }
}

export async function createEmbeddedPreviewJpeg(
  sourcePath: string,
  range: { offset: number; length: number },
  orientation: number,
): Promise<Buffer> {
  const bytes = await readPinnedSourceRange(sourcePath, range);
  let image = sharp(bytes, { failOn: "error" });
  if (orientation === 2) image = image.flop();
  if (orientation === 3) image = image.rotate(180);
  if (orientation === 4) image = image.flip();
  if (orientation === 5) image = image.flip().rotate(90);
  if (orientation === 6) image = image.rotate(90);
  if (orientation === 7) image = image.flop().rotate(90);
  if (orientation === 8) image = image.rotate(270);
  return await image
    .flatten({ background: "white" })
    .toColourspace("srgb")
    .resize({ width: 1616, height: 1616, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .withIccProfile(srgb2014ProfilePath)
    .toBuffer();
}

async function writePinnedPreview(
  cacheRoot: string,
  photoId: string,
  bytes: Uint8Array,
): Promise<{ path: string; bytes: number }> {
  const directory = join(cacheRoot, "emb");
  const destination = pinnedEmbeddedJpegPath(cacheRoot, photoId);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    const output = await open(temporary, "wx");
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    await rename(temporary, destination);
    return { path: destination, bytes: bytes.length };
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readPinnedSourceRange(
  sourcePath: string,
  range: { offset: number; length: number },
): Promise<Buffer> {
  const source = await open(sourcePath, "r");
  try {
    const size = (await source.stat()).size;
    if (
      !Number.isSafeInteger(range.offset) ||
      !Number.isSafeInteger(range.length) ||
      range.offset < 0 ||
      range.length <= 0 ||
      range.offset + range.length > size
    ) {
      throw new Error("Embedded JPEG range is outside the source file");
    }
    return await readFileRange(source, range.offset, range.length, size);
  } finally {
    await source.close();
  }
}
