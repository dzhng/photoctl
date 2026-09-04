import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";
import { PhotoctlError } from "@photoctl/protocol";
import { acquireLibraryLock, DEFAULT_LOCK_BUDGET_MS, OPEN_LOCK_NAME } from "./lock.js";
import { migrate } from "./migrations/runner.js";

export const DEFAULT_CACHE_MAX_BYTES = 20 * 1024 ** 3;

const { dependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };
const pgliteVersion = dependencies["@electric-sql/pglite"];

export interface LibraryHandle {
  path: string;
  query: PGlite["query"];
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
    const libraryId = uuidv7();
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
  let db: PGlite | undefined;
  try {
    if (!options.initialize) await validatePGliteVersion(libraryPath);
    try {
      db = await PGlite.create({
        dataDir: libraryPath,
        extensions: { vector },
        startParams: PGlite.defaultStartParams.filter((argument) => argument !== "-F"),
      });
    } catch (error) {
      if (error instanceof PhotoctlError) throw error;
      throw catalogUnreadable(libraryPath);
    }
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
    await db.exec("SET synchronous_commit = on");
    await assertDurability(db);
    await migrate(db);
    return {
      path: libraryPath,
      query: db.query.bind(db),
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

async function assertDurability(db: PGlite): Promise<void> {
  const fsync = await db.query<{ fsync: string }>("SHOW fsync");
  const synchronousCommit = await db.query<{ synchronous_commit: string }>(
    "SHOW synchronous_commit",
  );
  if (fsync.rows[0]?.fsync !== "on" || synchronousCommit.rows[0]?.synchronous_commit !== "on") {
    throw new Error("PGlite durability settings are not enabled");
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
