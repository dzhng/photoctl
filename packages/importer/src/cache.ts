import { homedir } from "node:os";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readFileRange } from "./file-range.js";

export function cacheRootForLibrary(libraryId: string, baseOverride?: string): string {
  const base = baseOverride
    ? resolve(baseOverride)
    : join(homedir(), "Library", "Caches", "photoctl");
  return join(base, libraryId);
}

export async function pinEmbeddedJpeg(
  cacheRoot: string,
  photoId: string,
  sourcePath: string,
  range: { offset: number; length: number },
): Promise<{ path: string; bytes: number }> {
  const directory = join(cacheRoot, "emb");
  await mkdir(directory, { recursive: true });
  const destination = join(directory, `${photoId}.jpg`);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
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
    const bytes = await readFileRange(source, range.offset, range.length, size);

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
    try {
      await source.close();
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
