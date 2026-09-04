import type { PGlite } from "@electric-sql/pglite";
import { pgDump } from "@electric-sql/pglite-tools/pg_dump";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PhotoctlError } from "@photoctl/protocol";
import { newLibraryEntityId } from "./identity.js";
import { installLibraryExtensions, startDatabase } from "./database.js";
import {
  acquireLibraryLock,
  DEFAULT_LOCK_BUDGET_MS,
  OPEN_LOCK_NAME,
  type LibraryLock,
} from "./lock.js";
import { migrate, verifyLatestSchema, type MigrationResult } from "./migrations/runner.js";
import { assertNoRestoreJournal } from "./restore-journal.js";

export const DEFAULT_CACHE_MAX_BYTES = 20 * 1024 ** 3;

const { dependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const pgliteVersion = dependencies["@electric-sql/pglite"];

export interface LibraryHandle {
  path: string;
  query: PGlite["query"];
  transaction: PGlite["transaction"];
  migrate(): Promise<MigrationResult>;
  dumpSql(): Promise<string>;
  close(): Promise<void>;
}

export interface LibraryDiagnostics {
  libraryId: string;
  cacheMaxBytes: number;
  vectorVersion: string;
}

export async function databaseDescription(handle: LibraryHandle): Promise<string> {
  const result = await handle.query<{ server_version: string }>("SHOW server_version");
  return `pglite ${pgliteVersion} / pg ${result.rows[0]?.server_version}`;
}

export async function readLibraryDiagnostics(handle: LibraryHandle): Promise<LibraryDiagnostics> {
  const settings = await handle.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM settings WHERE key IN ('library_id', 'cache_max_bytes')",
  );
  const values = new Map(settings.rows.map((row) => [row.key, row.value]));
  const vectorExtension = await handle.query<{ extversion: string }>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  const libraryId = values.get("library_id");
  const cacheMaxBytes = values.get("cache_max_bytes");
  if (typeof libraryId !== "string" || typeof cacheMaxBytes !== "number") {
    throw new Error("Library settings are incomplete");
  }
  const vectorVersion = vectorExtension.rows[0]?.extversion;
  if (!vectorVersion) throw new Error("The vector extension is not installed");
  return { libraryId, cacheMaxBytes, vectorVersion };
}

export async function initializeLibrary(
  path: string,
  cacheMaxBytes = DEFAULT_CACHE_MAX_BYTES,
): Promise<{ handle: LibraryHandle; libraryId: string; cacheMaxBytes: number }> {
  const libraryPath = resolve(path);
  try {
    await mkdir(libraryPath);
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      throw new PhotoctlError("usage", `Library already exists: ${libraryPath}`);
    }
    if (error instanceof PhotoctlError) throw error;
    throw catalogUnreadable(libraryPath);
  }

  let handle: LibraryHandle | undefined;
  try {
    handle = await openLibrary(libraryPath, { initialize: true });
    const libraryId = newLibraryEntityId();
    await handle.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2::jsonb), ($3, $4::jsonb), ($5, $6::jsonb)",
      [
        "library_id",
        JSON.stringify(libraryId),
        "cache_max_bytes",
        JSON.stringify(cacheMaxBytes),
        "daemon_idle_ms",
        JSON.stringify(900_000),
      ],
    );
    return { handle, libraryId, cacheMaxBytes };
  } catch (error) {
    try {
      await handle?.close();
    } finally {
      await rm(libraryPath, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function openLibrary(
  path: string,
  options: { noDaemon?: boolean; lockBudgetMs?: number; initialize?: boolean } = {},
): Promise<LibraryHandle> {
  const libraryPath = resolve(path);
  await assertNoRestoreJournal(libraryPath);
  let lock;
  try {
    lock = await acquireLibraryLock(
      join(libraryPath, OPEN_LOCK_NAME),
      options.lockBudgetMs ?? DEFAULT_LOCK_BUDGET_MS,
    );
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw catalogUnreadable(libraryPath);
  }
  try {
    await assertNoRestoreJournal(libraryPath);
  } catch (error) {
    await lock.release();
    throw error;
  }
  return await openLibraryHoldingLock(libraryPath, lock, options.initialize ?? false);
}

export async function openLibraryHoldingLock(
  libraryPath: string,
  lock: LibraryLock,
  initialize = false,
  allowRestoreJournal = false,
): Promise<LibraryHandle> {
  let db: PGlite | undefined;
  try {
    if (!allowRestoreJournal) await assertNoRestoreJournal(libraryPath);
    if (!initialize) await validatePGliteVersion(libraryPath);
    try {
      db = await startDatabase(libraryPath);
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      throw catalogUnreadable(libraryPath);
    }
    await installLibraryExtensions(db);
    const openDb = db;
    let pendingMigration: MigrationResult | undefined = await migrate(openDb);
    await verifyLatestSchema(openDb);
    return {
      path: libraryPath,
      query: openDb.query.bind(openDb),
      transaction: openDb.transaction.bind(openDb),
      migrate: async () => {
        if (pendingMigration) {
          const result = pendingMigration;
          pendingMigration = undefined;
          return result;
        }
        return await migrate(openDb);
      },
      dumpSql: async () => {
        let file: Awaited<ReturnType<typeof pgDump>>;
        try {
          file = await pgDump({ pg: openDb });
        } finally {
          await openDb.exec("COMMIT");
        }
        return await file.text();
      },
      close: async () => {
        try {
          await db?.close();
        } finally {
          await lock.release();
        }
      },
    };
  } catch (error) {
    try {
      await db?.close();
    } finally {
      await lock.release();
    }
    if (error instanceof PhotoctlError) throw error;
    throw catalogUnreadable(libraryPath);
  }
}

async function validatePGliteVersion(libraryPath: string): Promise<void> {
  let version: string;
  try {
    version = (await readFile(join(libraryPath, "PG_VERSION"), "utf8")).trim();
  } catch {
    throw catalogUnreadable(libraryPath);
  }
  if (version !== "18") {
    throw new PhotoctlError("migrate_required", `Library requires migration: ${libraryPath}`, {
      path: libraryPath,
      found_version: version,
      expected_version: "18",
      hint: `photoctl restore --path ${libraryPath}`,
    });
  }
}

function catalogUnreadable(libraryPath: string): PhotoctlError {
  return new PhotoctlError("catalog_unreadable", `Cannot read library: ${libraryPath}`, {
    path: libraryPath,
    hint: `photoctl restore --path ${libraryPath}`,
  });
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
