import { closeSync, fstatSync, statSync, unlinkSync } from "node:fs";
import { open, readFile, stat, unlink, type FileHandle } from "node:fs/promises";
import { flockSync } from "fs-ext";
import { PhotoctlError } from "@photoctl/protocol";

export const OPEN_LOCK_NAME = ".photoctl-open.lock";
export const DEFAULT_LOCK_BUDGET_MS = 30_000;
const POLL_BACKOFF_MS = [10, 20, 40, 60, 80, 100] as const;

export interface LockPayload {
  pid: number;
  socket: string | null;
  startedAt: number;
}

export interface LibraryLock {
  path: string;
  payload: LockPayload;
  release(): Promise<void>;
}

interface HeldLock {
  file: FileHandle;
  payload: LockPayload;
}

const heldLocks = new Map<string, HeldLock>();
let cleanupInstalled = false;

export async function acquireLibraryLock(
  path: string,
  budgetMs = DEFAULT_LOCK_BUDGET_MS,
): Promise<LibraryLock> {
  installCleanup();
  const beganAt = Date.now();
  let holderPid = 0;
  let attempt = 0;
  async function acquireAttempt(): Promise<LibraryLock> {
    if (Date.now() - beganAt > budgetMs) throwLockTimeout(holderPid, budgetMs);
    const payload = { pid: process.pid, socket: null, startedAt: Date.now() } satisfies LockPayload;
    let file: FileHandle;
    try {
      file = await open(path, "wx+");
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      try {
        file = await open(path, "r+");
      } catch (openError) {
        if (hasCode(openError, "ENOENT")) return acquireAttempt();
        throw openError;
      }
    }
    try {
      flockSync(file.fd, "exnb");
    } catch (error) {
      await file.close();
      if (!hasCode(error, "EAGAIN") && !hasCode(error, "EWOULDBLOCK")) throw error;
      const holder = await readLock(path);
      holderPid = holder?.pid ?? 0;
      return waitAndRetry();
    }
    if (!(await fileStillOwnsPath(file, path))) {
      await file.close();
      return acquireAttempt();
    }
    try {
      await file.truncate(0);
      await file.writeFile(JSON.stringify(payload));
      await file.sync();
    } catch (error) {
      await file.close();
      throw error;
    }
    heldLocks.set(path, { file, payload });
    return {
      path,
      payload,
      release: async () => releaseLibraryLock(path, payload, file),
    };

    async function waitAndRetry(): Promise<LibraryLock> {
      const elapsed = Date.now() - beganAt;
      if (elapsed >= budgetMs) throwLockTimeout(holderPid, budgetMs);
      const delay = POLL_BACKOFF_MS[Math.min(attempt++, POLL_BACKOFF_MS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, budgetMs - elapsed)));
      return acquireAttempt();
    }
  }
  return acquireAttempt();
}

function throwLockTimeout(holderPid: number, budgetMs: number): never {
  throw new PhotoctlError("library_locked", `Library is locked by process ${holderPid}`, {
    holder_pid: holderPid,
    waited_ms: budgetMs,
  });
}

export async function readLock(path: string): Promise<LockPayload | null> {
  try {
    const payload: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      typeof payload === "object" &&
      payload !== null &&
      "pid" in payload &&
      typeof payload.pid === "number" &&
      "socket" in payload &&
      (typeof payload.socket === "string" || payload.socket === null) &&
      "startedAt" in payload &&
      typeof payload.startedAt === "number"
    ) {
      return payload as LockPayload;
    }
  } catch {
    return null;
  }
  return null;
}

async function fileStillOwnsPath(file: FileHandle, path: string): Promise<boolean> {
  try {
    const [opened, current] = await Promise.all([file.stat(), stat(path)]);
    return opened.dev === current.dev && opened.ino === current.ino;
  } catch {
    return false;
  }
}

async function releaseLibraryLock(
  path: string,
  payload: LockPayload,
  file: FileHandle,
): Promise<void> {
  const held = heldLocks.get(path);
  if (held?.payload === payload) heldLocks.delete(path);
  try {
    const current = await readLock(path);
    if (
      current?.pid === payload.pid &&
      current.startedAt === payload.startedAt &&
      (await fileStillOwnsPath(file, path))
    ) {
      await unlink(path);
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  } finally {
    await file.close();
  }
}

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const cleanup = () => {
    for (const [path, held] of heldLocks) {
      try {
        const opened = fstatSync(held.file.fd);
        const current = statSync(path);
        if (opened.dev === current.dev && opened.ino === current.ino) unlinkSync(path);
      } catch {
        // Exit cleanup is best-effort; a missing lock is already released.
      }
      try {
        closeSync(held.file.fd);
      } catch {
        // The descriptor may already be closed after an interrupted operation.
      }
    }
    heldLocks.clear();
  };
  process.on("exit", cleanup);
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
