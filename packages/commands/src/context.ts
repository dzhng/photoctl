import { PhotoctlError, type CommandRequest } from "@photoctl/protocol";
import { openLibrary, type LibraryHandle } from "@photoctl/library";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type RequestEnv = CommandRequest["env"];

export async function openRequestLibrary(env: RequestEnv, cwd: string): Promise<LibraryHandle> {
  return await openLibrary(libraryPath(env, cwd), {
    noDaemon: env.noDaemon,
    lockBudgetMs: parseLockBudget(env.lockBudgetMs),
  });
}

export function libraryPath(env: Pick<RequestEnv, "libraryPath">, cwd: string): string {
  return env.libraryPath ? resolve(cwd, env.libraryPath) : join(homedir(), "Pictures", "photoctl");
}

export function cacheBase(env: Pick<RequestEnv, "cacheRoot">, cwd: string): string | undefined {
  return env.cacheRoot ? resolve(cwd, env.cacheRoot) : undefined;
}

export async function readLibraryId(handle: LibraryHandle): Promise<string> {
  const result = await handle.query<{ value: string }>(
    "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
  );
  const id = result.rows[0]?.value;
  if (!id) throw new Error("Library ID is missing");
  return id;
}

export function parseLockBudget(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new PhotoctlError("usage", "PHOTOCTL_LOCK_BUDGET_MS must be a non-negative integer");
  }
  return milliseconds;
}
