import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { publishDurableFile, syncDirectory } from "./fs-durability.js";
import type { LibraryHandle } from "./open.js";

export const AUTO_BACKUP_DEDUPE_MS = 5 * 60 * 1000;
export const BACKUP_MAX_COUNT = 10;
export const BACKUP_MAX_BYTES = 200 * 1024 ** 2;

export interface BackupResult {
  path: string;
  bytes: number;
  created: boolean;
  removed: string[];
  exceedsMaxBytes: boolean;
}

export interface BackupOptions {
  automatic?: boolean;
  now?: Date;
  maxCount?: number;
  maxBytes?: number;
  afterPublish?: (path: string) => void | Promise<void>;
}

interface BackupFile {
  path: string;
  name: string;
  bytes: number;
  createdMs: number;
  sequence: number;
}

export async function createBackup(
  library: LibraryHandle,
  options: BackupOptions = {},
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const directory = join(library.path, "backups");
  await mkdir(directory, { recursive: true });
  const existing = await listBackups(directory);
  const newest = existing[0];
  if (options.automatic && newest && now.getTime() - newest.createdMs < AUTO_BACKUP_DEDUPE_MS) {
    return {
      path: newest.path,
      bytes: newest.bytes,
      created: false,
      removed: [],
      exceedsMaxBytes: newest.bytes > (options.maxBytes ?? BACKUP_MAX_BYTES),
    };
  }

  const sql = await library.dumpSql();
  const path = await availableBackupPath(directory, now);
  await publishDurableFile(path, sql, { timestamp: now });
  await options.afterPublish?.(path);
  const bytes = Buffer.byteLength(sql);
  const removed = await rotateBackups(
    directory,
    options.maxCount ?? BACKUP_MAX_COUNT,
    options.maxBytes ?? BACKUP_MAX_BYTES,
  );
  if (removed.length > 0) await syncDirectory(directory);
  return {
    path,
    bytes,
    created: true,
    removed,
    exceedsMaxBytes: bytes > (options.maxBytes ?? BACKUP_MAX_BYTES),
  };
}

export async function latestBackup(libraryPath: string): Promise<string | undefined> {
  return (await listBackups(join(libraryPath, "backups")))[0]?.path;
}

async function rotateBackups(
  directory: string,
  maxCount: number,
  maxBytes: number,
): Promise<string[]> {
  const files = await listBackups(directory);
  let retainedBytes = 0;
  let retainedCount = 0;
  const removed: string[] = [];
  for (const [index, file] of files.entries()) {
    const keepNewest = index === 0;
    const fits = retainedCount < maxCount && retainedBytes + file.bytes <= maxBytes;
    if (keepNewest || fits) {
      retainedCount += 1;
      retainedBytes += file.bytes;
    } else {
      removed.push(file.path);
    }
  }
  await Promise.all(removed.map(async (path) => await rm(path)));
  return removed;
}

async function listBackups(directory: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith(".sql"))
      .map(async (name) => {
        const path = join(directory, name);
        const details = await stat(path);
        const encoded = backupOrder(name);
        return {
          path,
          name,
          bytes: details.size,
          createdMs: encoded?.createdMs ?? details.mtimeMs,
          sequence: encoded?.sequence ?? 0,
        };
      }),
  );
  return files.toSorted(
    (left, right) =>
      right.createdMs - left.createdMs ||
      right.sequence - left.sequence ||
      right.name.localeCompare(left.name),
  );
}

function backupOrder(name: string): { createdMs: number; sequence: number } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)(?:-(\d+))?\.sql$/u.exec(name);
  if (!match) return undefined;
  return { createdMs: Date.parse(match[1]), sequence: Number(match[2] ?? 0) };
}

async function availableBackupPath(directory: string, now: Date): Promise<string> {
  const stem = now.toISOString();
  async function candidate(suffix: number): Promise<string> {
    const path = join(directory, `${stem}${suffix === 0 ? "" : `-${suffix}`}.sql`);
    try {
      await stat(path);
    } catch (error) {
      if (hasCode(error, "ENOENT")) return path;
      throw error;
    }
    return await candidate(suffix + 1);
  }
  return await candidate(0);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
