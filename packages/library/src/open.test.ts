import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary, openLibrary } from "./open.js";

test("a library opens with durable Postgres settings", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-durability-"));
  const path = join(parent, "library");
  const initialized = await initializeLibrary(path);
  try {
    const fsync = await initialized.handle.query<{ fsync: string }>("SHOW fsync");
    const synchronousCommit = await initialized.handle.query<{ synchronous_commit: string }>(
      "SHOW synchronous_commit",
    );
    expect(fsync.rows[0]?.fsync).toBe("on");
    expect(synchronousCommit.rows[0]?.synchronous_commit).toBe("on");
  } finally {
    await initialized.handle.close();
    await rm(parent, { recursive: true });
  }
});

test("migration failures become a stable catalog error", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-migration-error-"));
  const path = join(parent, "library");
  const initialized = await initializeLibrary(path);
  try {
    await initialized.handle.query("DROP TABLE schema_version");
  } finally {
    await initialized.handle.close();
  }

  try {
    await expect(openLibrary(path)).rejects.toMatchObject({
      code: "catalog_unreadable",
      data: { path, hint: `photoctl restore --path ${path}` },
    });
  } finally {
    await rm(parent, { recursive: true });
  }
});
