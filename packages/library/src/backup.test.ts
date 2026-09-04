import { mkdtemp, readFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createBackup, latestBackup } from "./backup.js";
import { initializeLibrary } from "./open.js";
import type { LibraryHandle } from "./open.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("rotation keeps the newest snapshot even when it alone exceeds the byte cap", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-backup-rotation-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  let sql = "older";
  const library = {
    path: libraryPath,
    dumpSql: async () => sql,
  } as LibraryHandle;

  const first = await createBackup(library, {
    now: new Date("2026-09-04T12:00:00.000Z"),
    maxCount: 10,
    maxBytes: 10,
  });
  sql = "newest is larger than the whole cap";
  const newest = await createBackup(library, {
    now: new Date("2026-09-04T12:06:00.000Z"),
    maxCount: 10,
    maxBytes: 10,
  });

  expect(newest).toMatchObject({ created: true, exceedsMaxBytes: true, removed: [first.path] });
  expect(await readdir(join(libraryPath, "backups"))).toEqual(["2026-09-04T12:06:00.000Z.sql"]);
  expect(await readFile(newest.path, "utf8")).toBe(sql);
});

test("a failure before publication leaves no partial SQL while a failure after durable publication keeps it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-backup-publish-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const beforePublish = {
    path: libraryPath,
    dumpSql: async () => {
      throw new Error("dump failed");
    },
  } as LibraryHandle;
  await expect(createBackup(beforePublish)).rejects.toThrow("dump failed");
  expect(await readdir(join(libraryPath, "backups"))).toEqual([]);

  const afterPublish = { path: libraryPath, dumpSql: async () => "durable SQL" } as LibraryHandle;
  await expect(
    createBackup(afterPublish, {
      now: new Date("2026-09-04T12:00:00.000Z"),
      afterPublish: () => {
        throw new Error("interrupted after publish");
      },
    }),
  ).rejects.toThrow("interrupted after publish");
  const files = await readdir(join(libraryPath, "backups"));
  expect(files).toEqual(["2026-09-04T12:00:00.000Z.sql"]);
  expect(await readFile(join(libraryPath, "backups", files[0]), "utf8")).toBe("durable SQL");
});

test("rotation retains the ten newest snapshots and their actual contents", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-backup-count-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  let sql = "";
  const library = { path: libraryPath, dumpSql: async () => sql } as LibraryHandle;
  await Array.from({ length: 12 }, (_, index) => index).reduce<Promise<void>>(
    async (previous, index) => {
      await previous;
      sql = `snapshot-${index}`;
      await createBackup(library, {
        now: new Date(Date.UTC(2026, 8, 4, 12, index)),
        maxCount: 10,
        maxBytes: 1_000_000,
      });
    },
    Promise.resolve(),
  );
  const files = (await readdir(join(libraryPath, "backups"))).toSorted();
  expect(files).toHaveLength(10);
  expect(files[0]).toBe("2026-09-04T12:02:00.000Z.sql");
  expect(await readFile(join(libraryPath, "backups", files[0]), "utf8")).toBe("snapshot-2");
  expect(await readFile(join(libraryPath, "backups", files.at(-1) as string), "utf8")).toBe(
    "snapshot-11",
  );
});

test("backup order follows encoded creation time after copied files reset mtimes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-backup-order-"));
  directories.push(parent);
  const libraryPath = join(parent, "library");
  const library = { path: libraryPath, dumpSql: async () => "snapshot" } as LibraryHandle;
  const older = await createBackup(library, { now: new Date("2026-09-04T12:00:00.000Z") });
  const newer = await createBackup(library, { now: new Date("2026-09-04T13:00:00.000Z") });
  await utimes(older.path, new Date("2030-01-01"), new Date("2030-01-01"));
  await utimes(newer.path, new Date("2020-01-01"), new Date("2020-01-01"));

  expect(await latestBackup(libraryPath)).toBe(newer.path);
});

test("a backup is a restorable SQL file and an automatic retry inside five minutes reuses it", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-backup-"));
  directories.push(parent);
  const initialized = await initializeLibrary(join(parent, "library"));
  try {
    const created = await createBackup(initialized.handle, {
      now: new Date("2026-09-04T12:00:00.000Z"),
      automatic: true,
    });
    const deduplicated = await createBackup(initialized.handle, {
      now: new Date("2026-09-04T12:04:59.999Z"),
      automatic: true,
    });

    expect(created).toMatchObject({ created: true, bytes: expect.any(Number) });
    expect(created.path).toBe(join(parent, "library", "backups", "2026-09-04T12:00:00.000Z.sql"));
    expect(await readFile(created.path, "utf8")).toContain(initialized.libraryId);
    expect(deduplicated).toEqual({ ...created, created: false, removed: [] });
  } finally {
    await initialized.handle.close();
  }
});
