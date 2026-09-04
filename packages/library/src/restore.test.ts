import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import { createBackup } from "./backup.js";
import { acquireLibraryLock, OPEN_LOCK_NAME } from "./lock.js";
import { openLibrary, initializeLibrary, openLibraryHoldingLock } from "./open.js";
import { recoverInterruptedRestore, restoreLibrary } from "./restore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("restore replaces changed rows with the validated snapshot", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  let backup: string;
  try {
    await initialized.handle.query(
      "INSERT INTO tags (photo_id, tag) SELECT id, 'original' FROM photos",
    );
    backup = (await createBackup(initialized.handle)).path;
    await initialized.handle.query("DELETE FROM settings WHERE key = 'library_id'");
  } finally {
    await initialized.handle.close();
  }

  const restored = await restoreLibrary(libraryPath, backup);
  expect(restored).toMatchObject({ library: libraryPath, from: backup, schemaVersion: 3 });
  const verified = await openLibrary(libraryPath);
  try {
    const setting = await verified.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
    );
    expect(setting.rows).toEqual([{ value: initialized.libraryId }]);
  } finally {
    await verified.close();
  }
}, 20_000);

test("invalid SQL leaves the original library byte-for-byte usable", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-invalid-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  await initialized.handle.close();
  const invalid = join(parent, "invalid.sql");
  await writeFile(invalid, "this is not SQL");
  const versionBefore = await readFile(join(libraryPath, "PG_VERSION"), "utf8");

  await expect(restoreLibrary(libraryPath, invalid)).rejects.toMatchObject({
    code: "catalog_unreadable",
  });
  expect(await readFile(join(libraryPath, "PG_VERSION"), "utf8")).toBe(versionBefore);
  const verified = await openLibrary(libraryPath);
  try {
    const setting = await verified.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
    );
    expect(setting.rows).toEqual([{ value: initialized.libraryId }]);
  } finally {
    await verified.close();
  }
}, 20_000);

test("a process interruption between directory renames is refused by open and rolled back on retry", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-interrupted-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  let backup: string;
  try {
    await initialized.handle.query(
      "INSERT INTO settings (key, value) VALUES ('restore_marker', '\"snapshot\"'::jsonb)",
    );
    backup = (await createBackup(initialized.handle)).path;
    await initialized.handle.query(
      "UPDATE settings SET value = '\"current\"'::jsonb WHERE key = 'restore_marker'",
    );
  } finally {
    await initialized.handle.close();
  }

  const moduleUrl = pathToFileURL(resolve("packages/library/dist/index.js")).href;
  const code = `import { restoreLibrary } from ${JSON.stringify(moduleUrl)};
await restoreLibrary(${JSON.stringify(libraryPath)}, ${JSON.stringify(backup)}, {
  afterLiveRename: () => process.exit(86),
});`;
  const exit = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
    child.once("error", reject);
    child.once("close", (status) => resolveExit(status ?? 1));
  });
  expect(exit).toBe(86);
  await expect(openLibrary(libraryPath)).rejects.toMatchObject({
    code: "catalog_unreadable",
    data: { hint: `photoctl restore --path ${libraryPath}` },
  });
  const rollback = (await readdir(parent)).find((name) => name.includes(".rollback-"));
  expect(rollback).toBeDefined();
  const rollbackGuard = await acquireLibraryLock(join(parent, rollback!, OPEN_LOCK_NAME));
  await expect(recoverInterruptedRestore(libraryPath, 0)).rejects.toMatchObject({
    code: "library_locked",
  });
  await rollbackGuard.release();

  await restoreLibrary(libraryPath, backup);
  const verified = await openLibrary(libraryPath);
  try {
    const marker = await verified.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'restore_marker'",
    );
    expect(marker.rows).toEqual([{ value: "snapshot" }]);
  } finally {
    await verified.close();
  }
}, 20_000);

test("a process interruption after promotion but before its journal update restores the original", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-promoted-interruption-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  let backup: string;
  try {
    await initialized.handle.query(
      "INSERT INTO settings (key, value) VALUES ('restore_marker', '\"snapshot\"'::jsonb)",
    );
    backup = (await createBackup(initialized.handle)).path;
    await initialized.handle.query(
      "UPDATE settings SET value = '\"current\"'::jsonb WHERE key = 'restore_marker'",
    );
  } finally {
    await initialized.handle.close();
  }

  const moduleUrl = pathToFileURL(resolve("packages/library/dist/index.js")).href;
  const code = `import { restoreLibrary } from ${JSON.stringify(moduleUrl)};
await restoreLibrary(${JSON.stringify(libraryPath)}, ${JSON.stringify(backup)}, {
  afterStageRename: () => process.exit(87),
});`;
  const exit = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
    child.once("error", reject);
    child.once("close", (status) => resolveExit(status ?? 1));
  });
  expect(exit).toBe(87);
  await expect(openLibrary(libraryPath)).rejects.toMatchObject({ code: "catalog_unreadable" });
  const directLock = await acquireLibraryLock(join(libraryPath, OPEN_LOCK_NAME));
  await expect(openLibraryHoldingLock(libraryPath, directLock)).rejects.toMatchObject({
    code: "catalog_unreadable",
  });

  await restoreLibrary(libraryPath, backup);
  const verified = await openLibrary(libraryPath);
  try {
    const marker = await verified.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'restore_marker'",
    );
    expect(marker.rows).toEqual([{ value: "snapshot" }]);
  } finally {
    await verified.close();
  }
}, 20_000);

test("a crash during rollback deletion keeps the committed promoted library", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-committed-interruption-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  let backup: string;
  try {
    await initialized.handle.query(
      "INSERT INTO settings (key, value) VALUES ('restore_marker', '\"snapshot\"'::jsonb)",
    );
    backup = (await createBackup(initialized.handle)).path;
    await initialized.handle.query(
      "UPDATE settings SET value = '\"current\"'::jsonb WHERE key = 'restore_marker'",
    );
  } finally {
    await initialized.handle.close();
  }

  const moduleUrl = pathToFileURL(resolve("packages/library/dist/index.js")).href;
  const code = `import { rm } from "node:fs/promises";
import { join } from "node:path";
import { restoreLibrary } from ${JSON.stringify(moduleUrl)};
await restoreLibrary(${JSON.stringify(libraryPath)}, ${JSON.stringify(backup)}, {
  duringRollbackCleanup: async (rollback) => {
    await rm(join(rollback, "PG_VERSION"));
    process.exit(88);
  },
});`;
  const exit = await new Promise<number>((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
    child.once("error", reject);
    child.once("close", (status) => resolveExit(status ?? 1));
  });
  expect(exit).toBe(88);
  expect(await recoverInterruptedRestore(libraryPath)).toBe(true);
  const verified = await openLibrary(libraryPath);
  try {
    const marker = await verified.query<{ value: string }>(
      "SELECT value #>> '{}' AS value FROM settings WHERE key = 'restore_marker'",
    );
    expect(marker.rows).toEqual([{ value: "snapshot" }]);
  } finally {
    await verified.close();
  }
  expect(await readdir(parent)).toEqual(["library"]);
}, 20_000);

test("a failure publishing the first journal releases both locks and removes the stage", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-journal-failure-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  const backup = (await createBackup(initialized.handle)).path;
  await initialized.handle.close();

  await expect(
    restoreLibrary(libraryPath, backup, {
      beforeJournalPublish: () => {
        throw new Error("journal unavailable");
      },
    }),
  ).rejects.toMatchObject({ code: "catalog_unreadable" });
  const verified = await openLibrary(libraryPath, { lockBudgetMs: 0 });
  await verified.close();
  expect(await readdir(parent)).toEqual(["library"]);
}, 20_000);

test("restore rejects a dump with a future migration ledger and preserves the original", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-future-schema-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const initialized = await initializeLibrary(libraryPath);
  await initialized.handle.close();
  const fixture = await readFile(
    new URL("../../../fixtures/libraries/schema-v1.pgsql", import.meta.url),
    "utf8",
  );
  const future = join(parent, "future.sql");
  await writeFile(future, fixture.replace("VALUES (1,", "VALUES (4,"));

  await expect(restoreLibrary(libraryPath, future)).rejects.toMatchObject({
    code: "catalog_unreadable",
    data: { message: "Invalid schema migration ledger: 4" },
  });
  const verified = await openLibrary(libraryPath);
  await verified.close();
}, 20_000);
