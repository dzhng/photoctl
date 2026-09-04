import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { openLibrary } from "@photoctl/library";
import { spawnPhotoctl } from "@photoctl/test-harness";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

test("eight fresh init processes create one migrated library without a leaked lock", async () => {
  const parent = await mkdtemp(join(tmpdir(), "photoctl-fresh-open-"));
  directories.push(parent);
  const library = join(parent, "library");

  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      spawnPhotoctl(["init", "--path", library], { env: { PHOTOCTL_NO_DAEMON: "1" } }),
    ),
  );

  expect(attempts.filter((attempt) => attempt.code === 0)).toHaveLength(1);
  expect(attempts.filter((attempt) => attempt.code === 2)).toHaveLength(7);
  const handle = await openLibrary(library);
  const versions = await handle.query<{ version: number }>(
    "SELECT version FROM schema_version ORDER BY version",
  );
  await handle.close();
  expect(versions.rows).toEqual([
    { version: 1 },
    { version: 2 },
    { version: 3 },
    { version: 4 },
    { version: 5 },
  ]);
  expect(await readdir(parent)).toEqual(["library"]);
  expect(await readdir(library)).not.toContain(".photoctl-open.lock");
}, 30_000);
