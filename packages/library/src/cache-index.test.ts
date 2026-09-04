import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { CacheIndex, initializeLibrary } from "./index.js";

test("cache index orders eviction by last use and conditionally claims only old unpinned rows", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-index-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  const index = new CacheIndex(initialized.handle, "/cache");
  try {
    await index.recordCompleted({ path: "/cache/old", bytes: 4, lastUsed: new Date(1_000) });
    await index.recordCompleted({ path: "/cache/new", bytes: 5, lastUsed: new Date(3_000) });
    await index.recordCompleted({ path: "/cache/pinned", bytes: 6, lastUsed: new Date(500) });
    await initialized.handle.query("UPDATE cache_index SET pinned = true WHERE path = $1", [
      "pinned",
    ]);

    expect(await index.evictionCandidates(new Date(2_000))).toEqual([
      { path: "/cache/old", bytes: 4, lastUsed: new Date(1_000) },
    ]);
    expect(await index.claimIfOlderThan("/cache/new", new Date(2_000))).toBe(false);
    expect(await index.claimIfOlderThan("/cache/old", new Date(2_000))).toBe(true);
    expect(await index.totalBytes()).toBe(11);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("cache paths remain scoped to whichever cache root is active", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-root-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  try {
    const firstRoot = join(directory, "cache-one");
    const secondRoot = join(directory, "cache-two");
    await new CacheIndex(initialized.handle, firstRoot).recordCompleted({
      path: join(firstRoot, "view", "artifact.jpg"),
      bytes: 7,
      lastUsed: new Date(1_000),
    });

    const moved = new CacheIndex(initialized.handle, secondRoot);
    expect(await moved.evictionCandidates(new Date(2_000))).toEqual([
      {
        path: join(secondRoot, "view", "artifact.jpg"),
        bytes: 7,
        lastUsed: new Date(1_000),
      },
    ]);
    expect(
      await moved.claimIfOlderThan(join(secondRoot, "view", "artifact.jpg"), new Date(2_000)),
    ).toBe(true);
    expect(await moved.totalBytes()).toBe(0);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("cache eviction candidates page through stable LRU boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-pages-"));
  const initialized = await initializeLibrary(join(directory, "library"));
  const index = new CacheIndex(initialized.handle, "/cache");
  try {
    await index.recordCompleted({ path: "/cache/first", bytes: 1, lastUsed: new Date(1_000) });
    await index.recordCompleted({ path: "/cache/second", bytes: 2, lastUsed: new Date(1_000) });
    await index.recordCompleted({ path: "/cache/third", bytes: 3, lastUsed: new Date(2_000) });

    const firstPage = await index.evictionCandidates(new Date(3_000), undefined, 2);
    expect(firstPage.map((entry) => entry.path)).toEqual(["/cache/first", "/cache/second"]);
    const secondPage = await index.evictionCandidates(new Date(3_000), firstPage.at(-1), 2);
    expect(secondPage.map((entry) => entry.path)).toEqual(["/cache/third"]);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});
