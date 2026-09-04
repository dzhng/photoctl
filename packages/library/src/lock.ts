import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
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
  readonly path: string;
  readonly fd: number;
  readonly payload: LockPayload;
  rewrite(payload: LockPayload): Promise<void>;
  moveTo(path: string): void;
  detach(): Promise<void>;
  release(): Promise<void>;
}

interface HeldLock {
  fd: number;
  payload: LockPayload;
  close(): Promise<void>;
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
    if (attempt > 0 && Date.now() - beganAt >= budgetMs) throwLockTimeout(holderPid, budgetMs);
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
    return libraryLock(path, { fd: file.fd, payload, close: async () => await file.close() });

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

export function adoptLibraryLock(path: string, fd: number): LibraryLock {
  installCleanup();
  const payload = { pid: process.pid, socket: null, startedAt: Date.now() } satisfies LockPayload;
  return libraryLock(path, {
    fd,
    payload,
    close: async () => closeSync(fd),
  });
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

function libraryLock(path: string, state: HeldLock): LibraryLock {
  heldLocks.set(path, state);
  let currentPath = path;
  let attached = true;
  return {
    get path() {
      return currentPath;
    },
    fd: state.fd,
    get payload() {
      return state.payload;
    },
    rewrite: async (payload) => {
      if (!attached) throw new Error("Cannot rewrite a detached library lock");
      ftruncateSync(state.fd, 0);
      writeSync(state.fd, JSON.stringify(payload), 0, "utf8");
      fsyncSync(state.fd);
      state.payload = payload;
    },
    moveTo: (nextPath) => {
      if (!attached) throw new Error("Cannot move a detached library lock");
      if (heldLocks.get(currentPath) === state) heldLocks.delete(currentPath);
      currentPath = nextPath;
      heldLocks.set(currentPath, state);
    },
    detach: async () => {
      if (!attached) return;
      attached = false;
      heldLocks.delete(currentPath);
      await state.close();
    },
    release: async () => {
      if (!attached) return;
      attached = false;
      await releaseLibraryLock(currentPath, state);
    },
  };
}

async function releaseLibraryLock(path: string, state: HeldLock): Promise<void> {
  const held = heldLocks.get(path);
  if (held === state) heldLocks.delete(path);
  try {
    const current = await readLock(path);
    if (
      current?.pid === state.payload.pid &&
      current.startedAt === state.payload.startedAt &&
      fileDescriptorStillOwnsPath(state.fd, path)
    ) {
      await unlink(path);
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  } finally {
    await state.close();
  }
}

function fileDescriptorStillOwnsPath(fd: number, path: string): boolean {
  try {
    const opened = fstatSync(fd);
    const current = statSync(path);
    return opened.dev === current.dev && opened.ino === current.ino;
  } catch {
    return false;
  }
}

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const cleanup = () => {
    for (const [path, held] of heldLocks) {
      try {
        if (fileDescriptorStillOwnsPath(held.fd, path)) unlinkSync(path);
      } catch {
        // Exit cleanup is best-effort; a missing lock is already released.
      }
      try {
        closeSync(held.fd);
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
