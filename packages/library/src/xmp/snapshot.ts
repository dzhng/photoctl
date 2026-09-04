import { createHash } from "node:crypto";
import { open, stat, type FileHandle } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { XmpChangedError, XmpFilesystemError } from "./errors.js";

const MAX_SNAPSHOT_ATTEMPTS = 3;

export interface SnapshotHooks {
  afterRead?: (attempt: number) => Promise<void>;
}

export interface FileSnapshot {
  text: string;
  mode: number;
  mtime: Date;
  identity: string;
}

export async function readFileSnapshot(
  path: string,
  hooks: SnapshotHooks = {},
): Promise<FileSnapshot | undefined> {
  for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const file = await openExisting(path);
    if (!file) return undefined;
    try {
      const before = await fileStat(file, path);
      const bytes = await fileRead(file, path);
      const observed = await fileMetadata(file, path);
      const after = await fileStat(file, path);
      await hooks.afterRead?.(attempt);
      const current = await pathStat(path);
      if (sameMetadata(before, after) && current && sameMetadata(after, current)) {
        return {
          text: bytes.toString("utf8"),
          mode: Number(after.mode),
          mtime: observed.mtime,
          identity: snapshotIdentity(after, bytes),
        };
      }
    } finally {
      await file.close().catch(() => undefined);
    }
  }
  throw new XmpChangedError(`XMP sidecar changed repeatedly while reading: ${path}`);
}

function snapshotIdentity(metadata: BigIntStats, bytes: Buffer): string {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.uid,
    metadata.gid,
    metadata.size,
    metadata.mtimeNs,
    digest,
  ].join(":");
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function openExisting(path: string): Promise<FileHandle | undefined> {
  try {
    return await open(path, "r");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw new XmpFilesystemError("open", path, error);
  }
}

async function fileRead(file: FileHandle, path: string): Promise<Buffer> {
  try {
    return await file.readFile();
  } catch (error) {
    throw new XmpFilesystemError("read", path, error);
  }
}

async function fileStat(file: FileHandle, path: string): Promise<BigIntStats> {
  try {
    return await file.stat({ bigint: true });
  } catch (error) {
    throw new XmpFilesystemError("inspect", path, error);
  }
}

async function fileMetadata(file: FileHandle, path: string) {
  try {
    return await file.stat();
  } catch (error) {
    throw new XmpFilesystemError("inspect", path, error);
  }
}

async function pathStat(path: string): Promise<BigIntStats | undefined> {
  try {
    return await stat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return undefined;
    throw new XmpFilesystemError("inspect", path, error);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
