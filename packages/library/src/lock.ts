import { unlinkSync } from "node:fs";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { PhotoctlError } from "@photoctl/protocol";

export const OPEN_LOCK_NAME = ".photoctl-open.lock";
export const DEFAULT_LOCK_BUDGET_MS = 30_000;
export const STALE_LOCK_MS = 10 * 60_000;
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

export type PidLiveness = "alive" | "dead" | "unknown";

export function shouldReclaimLock(input: {
  payload: LockPayload | null;
  ageMs: number;
  currentPid: number;
  liveness: PidLiveness;
}): boolean {
  if (input.payload?.pid === input.currentPid) return true;
  if (input.liveness === "dead") return true;
  if (input.liveness === "alive") return false;
  return input.ageMs > STALE_LOCK_MS;
}

const heldLocks = new Map<string, LockPayload>();
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
    let file;
    try {
      file = await open(path, "wx");
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    if (file) {
      try {
        await file.writeFile(JSON.stringify(payload));
      } catch (error) {
        try {
          await unlink(path);
        } catch {
          // Preserve the write failure; a later open can age-reclaim an empty file.
        }
        throw error;
      } finally {
        await file.close();
      }
      heldLocks.set(path, payload);
      return {
        path,
        payload,
        release: async () => releaseLibraryLock(path, payload),
      };
    }

    const holder = await readLock(path);
    holderPid = holder?.pid ?? 0;
    if (await mayReclaim(path, holder)) {
      try {
        await unlink(path);
      } catch (error) {
        if (!hasCode(error, "ENOENT")) throw error;
      }
      return acquireAttempt();
    }

    const elapsed = Date.now() - beganAt;
    if (elapsed >= budgetMs) throwLockTimeout(holderPid, budgetMs);
    const delay = POLL_BACKOFF_MS[Math.min(attempt++, POLL_BACKOFF_MS.length - 1)];
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, budgetMs - elapsed)));
    return acquireAttempt();
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

async function mayReclaim(path: string, payload: LockPayload | null): Promise<boolean> {
  if (heldLocks.has(path)) return false;
  const liveness = payload ? pidLiveness(payload.pid) : "unknown";
  const ageMs = payload ? Date.now() - payload.startedAt : await fileAge(path);
  return shouldReclaimLock({ payload, ageMs, currentPid: process.pid, liveness });
}

function pidLiveness(pid: number): PidLiveness {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (hasCode(error, "ESRCH")) return "dead";
    return "unknown";
  }
}

async function fileAge(path: string): Promise<number> {
  try {
    return Date.now() - (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function releaseLibraryLock(path: string, payload: LockPayload): Promise<void> {
  const held = heldLocks.get(path);
  if (held?.pid === payload.pid && held.startedAt === payload.startedAt) heldLocks.delete(path);
  const current = await readLock(path);
  if (current?.pid !== payload.pid || current.startedAt !== payload.startedAt) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const cleanup = () => {
    for (const path of heldLocks.keys()) {
      try {
        unlinkSync(path);
      } catch {
        // Exit cleanup is best-effort; a missing lock is already released.
      }
    }
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
