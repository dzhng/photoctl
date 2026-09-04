import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CacheIndex, openLibrary } from "@photoctl/library";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { expect, test } from "vitest";

test("cache prune applies an explicit byte budget through the built CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-command-"));
  const libraryPath = join(directory, "library");
  const cacheBase = join(directory, "cache");
  try {
    expect((await spawnPhotoctl(["init", "--path", libraryPath])).code).toBe(0);
    const library = await openLibrary(libraryPath);
    try {
      const libraryId = await library.query<{ value: string }>(
        "SELECT value #>> '{}' AS value FROM settings WHERE key = 'library_id'",
      );
      const cacheRoot = join(cacheBase, libraryId.rows[0]!.value);
      const first = join(cacheRoot, "view", "first.jpg");
      const second = join(cacheRoot, "view", "second.jpg");
      const index = new CacheIndex(library, cacheRoot);
      await mkdir(dirname(first), { recursive: true });
      await writeFile(first, "1234");
      await writeFile(second, "5678");
      await index.recordCompleted({ path: first, bytes: 4, lastUsed: new Date(0) });
      await index.recordCompleted({ path: second, bytes: 4, lastUsed: new Date(1) });
    } finally {
      await library.close();
    }

    const result = await spawnPhotoctl(["cache", "prune", "--max", "4B"], {
      libraryDir: libraryPath,
      env: { PHOTOCTL_CACHE: cacheBase },
    });

    expect(result.code).toBe(0);
    expect(result.json).toEqual({
      schema: 1,
      ok: true,
      data: { removed: 1, freed_bytes: 4, remaining_bytes: 4, max_bytes: 4 },
      warnings: [],
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});
