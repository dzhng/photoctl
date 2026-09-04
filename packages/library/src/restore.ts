/* eslint-disable no-await-in-loop -- Restore preserves large trees with bounded filesystem pressure. */
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { PhotoctlError } from "@photoctl/protocol";
import { latestBackup } from "./backup.js";
import { installLibraryExtensions, startDatabase } from "./database.js";
import {
  acquireLibraryLock,
  DEFAULT_LOCK_BUDGET_MS,
  OPEN_LOCK_NAME,
  type LibraryLock,
} from "./lock.js";
import { LATEST_SCHEMA_VERSION, migrate, verifyLatestSchema } from "./migrations/runner.js";
import { copyDurableFile, publishDurableFile, syncDirectory } from "./fs-durability.js";
import { openLibraryHoldingLock, readLibraryDiagnostics, type LibraryHandle } from "./open.js";
import {
  restoreJournalPath,
  validateRestoreJournal,
  type RestoreJournal,
} from "./restore-journal.js";

export interface RestoreResult {
  library: string;
  from: string;
  schemaVersion: number;
}

export interface RestoreOptions {
  lockBudgetMs?: number;
  afterLiveRename?: () => void | Promise<void>;
  afterStageRename?: () => void | Promise<void>;
  beforeJournalPublish?: () => void | Promise<void>;
  duringRollbackCleanup?: (rollback: string) => void | Promise<void>;
}

export async function restoreLibrary(
  path: string,
  from?: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const live = resolve(path);
  const budget = options.lockBudgetMs ?? DEFAULT_LOCK_BUDGET_MS;
  const operationLock = await acquireLibraryLock(`${restoreJournalPath(live)}.lock`, budget);
  try {
    return await restoreLibraryExclusive(live, from, options, budget);
  } finally {
    await operationLock.release();
  }
}

async function restoreLibraryExclusive(
  live: string,
  from: string | undefined,
  options: RestoreOptions,
  budget: number,
): Promise<RestoreResult> {
  await recoverInterruptedRestoreExclusive(live, budget);
  const source = resolve(from ?? (await latestBackup(live)) ?? missingBackup(live));
  let sql: string;
  try {
    sql = await readFile(source, "utf8");
  } catch {
    throw unreadableBackup(live, source);
  }

  let liveLock = await acquireLibraryLock(join(live, OPEN_LOCK_NAME), budget);
  if (await journalExists(live)) {
    await liveLock.release();
    await recoverInterruptedRestoreExclusive(live, budget);
    liveLock = await acquireLibraryLock(join(live, OPEN_LOCK_NAME), budget);
  }

  const token = randomUUID();
  const parent = dirname(live);
  const name = basename(live);
  const stage = join(parent, `.${name}.restore-${token}`);
  const rollback = join(parent, `.${name}.rollback-${token}`);
  let stageLock: LibraryLock | undefined;
  let stageDb: Awaited<ReturnType<typeof startDatabase>> | undefined;
  try {
    await mkdir(stage);
    stageLock = await acquireLibraryLock(join(stage, OPEN_LOCK_NAME), budget);
    stageDb = await startDatabase(stage);
    await stageDb.exec("CREATE SCHEMA IF NOT EXISTS public");
    await stageDb.exec(sql);
    await stageDb.exec('SET search_path TO "$user", public');
    await installLibraryExtensions(stageDb);
    const migration = await migrate(stageDb);
    await verifyLatestSchema(stageDb);
    const identity = await stageDb.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
    );
    if (!identity.rows[0]?.value || migration.toVersion !== LATEST_SCHEMA_VERSION) {
      throw new Error("The backup does not contain a valid photoctl library");
    }
    await stageDb.close();
    stageDb = undefined;
    await preserveBackups(live, stage, source);
    await Promise.all(
      ["artifacts", "originals", "previews", "presets"].map(
        async (treeName) => await preserveTree(join(live, treeName), join(stage, treeName)),
      ),
    );
    await syncDirectory(stage);
  } catch (error) {
    await stageDb?.close();
    await stageLock?.release();
    await liveLock.release();
    await rm(stage, { recursive: true, force: true });
    if (error instanceof PhotoctlError) throw error;
    throw unreadableBackup(live, source, error);
  }

  let promoted: LibraryHandle | undefined;
  const journal: RestoreJournal = { schema: 1, phase: "prepared", live, stage, rollback, source };
  let committed = false;
  try {
    await options.beforeJournalPublish?.();
    await writeJournal(journal);
    await liveLock.release();
    await rename(live, rollback);
    await options.afterLiveRename?.();
    journal.phase = "live_moved";
    await writeJournal(journal);
    await rename(stage, live);
    await options.afterStageRename?.();
    stageLock?.moveTo(join(live, OPEN_LOCK_NAME));
    journal.phase = "promoted";
    await writeJournal(journal);
    if (!stageLock) throw new Error("The staged library lock was lost");
    promoted = await openLibraryHoldingLock(live, stageLock, false, true);
    stageLock = undefined;
    await readLibraryDiagnostics(promoted);
    await promoted.close();
    promoted = undefined;
    journal.phase = "committed";
    await writeJournal(journal);
    committed = true;
    await options.duringRollbackCleanup?.(rollback);
    await rm(rollback, { recursive: true, force: true });
    await rm(restoreJournalPath(live));
    await syncDirectory(parent);
    return {
      library: live,
      from: source,
      schemaVersion: LATEST_SCHEMA_VERSION,
    };
  } catch (error) {
    await promoted?.close();
    await stageLock?.release();
    await liveLock.release();
    if (await journalExists(live)) {
      await recoverInterruptedRestoreExclusive(live, budget);
    } else {
      await rm(stage, { recursive: true, force: true });
    }
    if (committed) {
      return { library: live, from: source, schemaVersion: LATEST_SCHEMA_VERSION };
    }
    if (error instanceof PhotoctlError) throw error;
    throw unreadableBackup(live, source, error);
  }
}

async function preserveTree(source: string, target: string): Promise<void> {
  let details;
  try {
    details = await lstat(source);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Preserved library path is not a directory: ${source}`);
  }
  await mkdir(target);
  for (const name of await readdir(source)) {
    const sourcePath = join(source, name);
    const targetPath = join(target, name);
    const child = await lstat(sourcePath);
    if (child.isDirectory() && !child.isSymbolicLink()) {
      await preserveTree(sourcePath, targetPath);
    } else if (child.isFile()) {
      await link(sourcePath, targetPath);
    } else {
      throw new Error(`Preserved library tree contains an unsupported entry: ${sourcePath}`);
    }
  }
  await syncDirectory(target);
}

export async function recoverInterruptedRestore(
  path: string,
  lockBudgetMs = DEFAULT_LOCK_BUDGET_MS,
): Promise<boolean> {
  const live = resolve(path);
  const operationLock = await acquireLibraryLock(`${restoreJournalPath(live)}.lock`, lockBudgetMs);
  try {
    return await recoverInterruptedRestoreExclusive(live, lockBudgetMs);
  } finally {
    await operationLock.release();
  }
}

async function recoverInterruptedRestoreExclusive(
  live: string,
  lockBudgetMs: number,
): Promise<boolean> {
  const journalPath = restoreJournalPath(live);
  let journal: RestoreJournal;
  try {
    journal = validateRestoreJournal(JSON.parse(await readFile(journalPath, "utf8")), live);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    if (error instanceof PhotoctlError) throw error;
    throw new PhotoctlError("catalog_unreadable", `Cannot read restore journal: ${journalPath}`, {
      path: live,
      journal: journalPath,
      hint: `Inspect the restore journal before retrying photoctl restore --path ${live}`,
    });
  }

  const state = await restoreState(journal);
  const guards = new Map<"live" | "stage" | "rollback", LibraryLock>();
  try {
    if (state.live) {
      guards.set(
        "live",
        await acquireLibraryLock(join(journal.live, OPEN_LOCK_NAME), lockBudgetMs),
      );
    }
    if (state.stage) {
      guards.set(
        "stage",
        await acquireLibraryLock(join(journal.stage, OPEN_LOCK_NAME), lockBudgetMs),
      );
    }
    if (state.rollback) {
      guards.set(
        "rollback",
        await acquireLibraryLock(join(journal.rollback, OPEN_LOCK_NAME), lockBudgetMs),
      );
    }

    if (journal.phase === "committed") {
      if (!state.live || state.stage) throw invalidRestoreState(journal);
      if (state.rollback) await rm(journal.rollback, { recursive: true, force: true });
      await rm(journalPath);
      await syncDirectory(dirname(live));
      return true;
    }

    if (state.live && !state.stage && state.rollback) {
      await rm(journal.live, { recursive: true, force: true });
      await renameRollbackToLive(journal, guards.get("rollback"));
    } else if (!state.live && state.stage && state.rollback) {
      await renameRollbackToLive(journal, guards.get("rollback"));
      await rm(journal.stage, { recursive: true, force: true });
    } else if (!state.live && !state.stage && state.rollback) {
      await renameRollbackToLive(journal, guards.get("rollback"));
    } else if (state.live && state.stage && !state.rollback) {
      await rm(journal.stage, { recursive: true, force: true });
    } else if (!(state.live && !state.stage && !state.rollback)) {
      throw invalidRestoreState(journal);
    }
    await rm(journalPath);
    await syncDirectory(dirname(live));
    return true;
  } finally {
    await Promise.all([...guards.values()].map(async (guard) => await guard.release()));
  }
}

async function renameRollbackToLive(
  journal: RestoreJournal,
  rollbackGuard: LibraryLock | undefined,
): Promise<void> {
  await rename(journal.rollback, journal.live);
  rollbackGuard?.moveTo(join(journal.live, OPEN_LOCK_NAME));
}

async function restoreState(journal: RestoreJournal): Promise<{
  live: boolean;
  stage: boolean;
  rollback: boolean;
}> {
  const [live, stage, rollback] = await Promise.all([
    directoryExists(journal.live),
    directoryExists(journal.stage),
    directoryExists(journal.rollback),
  ]);
  return { live, stage, rollback };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const details = await lstat(path);
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new PhotoctlError("catalog_unreadable", `Restore path is not a directory: ${path}`);
    }
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function invalidRestoreState(journal: RestoreJournal): PhotoctlError {
  return new PhotoctlError("catalog_unreadable", "Restore paths are in an unsafe state", {
    path: journal.live,
    journal: restoreJournalPath(journal.live),
    hint: "Inspect the restore paths before retrying; photoctl did not remove any directory",
  });
}

async function preserveBackups(live: string, stage: string, source: string): Promise<void> {
  const target = join(stage, "backups");
  await mkdir(target, { recursive: true });
  const copied = new Set<string>();
  try {
    await Promise.all(
      (await readdir(join(live, "backups")))
        .filter((name) => name.endsWith(".sql"))
        .map(async (name) => {
          await copyDurableFile(join(live, "backups", name), join(target, name));
          copied.add(name);
        }),
    );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const sourceName = basename(source);
  if (!copied.has(sourceName)) await copyDurableFile(source, join(target, sourceName));
  await syncDirectory(target);
}

async function writeJournal(journal: RestoreJournal): Promise<void> {
  const path = restoreJournalPath(journal.live);
  await publishDurableFile(path, `${JSON.stringify(journal)}\n`);
}

async function journalExists(libraryPath: string): Promise<boolean> {
  try {
    await stat(restoreJournalPath(libraryPath));
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function missingBackup(libraryPath: string): never {
  throw new PhotoctlError("usage", `No backup found for library: ${libraryPath}`, {
    path: libraryPath,
    hint: "Pass --from <file> to restore a specific backup",
  });
}

function unreadableBackup(libraryPath: string, source: string, cause?: unknown): PhotoctlError {
  return new PhotoctlError("catalog_unreadable", `Cannot restore backup: ${source}`, {
    path: libraryPath,
    from: source,
    ...(cause instanceof Error ? { message: cause.message } : {}),
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
