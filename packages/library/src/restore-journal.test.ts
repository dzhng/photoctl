import { expect, test } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverInterruptedRestore } from "./restore.js";
import { restoreJournalPath, validateRestoreJournal } from "./restore-journal.js";

const library = "/tmp/library";
const token = "123e4567-e89b-42d3-a456-426614174000";

test.each([
  {
    stage: `/tmp/.library.restore-${token}`,
    rollback: "/tmp/.library.rollback-123e4567-e89b-42d3-a456-426614174001",
  },
  {
    stage: "/tmp/.library.restore-delete-anything",
    rollback: "/tmp/.library.rollback-delete-anything",
  },
  {
    stage: `/tmp/.library.restore-${token}/nested`,
    rollback: `/tmp/.library.rollback-${token}`,
  },
])("rejects journal paths that are not one matching generated token", ({ stage, rollback }) => {
  expect(() =>
    validateRestoreJournal(
      { schema: 1, phase: "prepared", live: library, stage, rollback, source: "/tmp/dump.sql" },
      library,
    ),
  ).toThrow("Invalid restore journal");
});

test("recovery refuses a matching-name symlink without touching its target", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-restore-journal-"));
  const live = join(parent, "library");
  const victim = join(parent, "victim");
  const stage = join(parent, `.library.restore-${token}`);
  const rollback = join(parent, `.library.rollback-${token}`);
  await mkdir(live);
  await mkdir(victim);
  await writeFile(join(victim, "keep.txt"), "keep");
  await symlink(victim, stage);
  await writeFile(
    restoreJournalPath(live),
    JSON.stringify({
      schema: 1,
      phase: "prepared",
      live,
      stage,
      rollback,
      source: join(parent, "dump.sql"),
    }),
  );
  try {
    await expect(recoverInterruptedRestore(live, 0)).rejects.toMatchObject({
      code: "catalog_unreadable",
    });
    expect(await readFile(join(victim, "keep.txt"), "utf8")).toBe("keep");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
