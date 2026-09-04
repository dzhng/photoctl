import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { PreviewCoordinator } from "@photoctl/render";
import { pruneCache, type CachePruneEntry } from "./cache-prune.js";

test("prune removes oldest derived artifacts while preserving pinned, recent, and leased paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cache-prune-"));
  const now = new Date("2026-09-04T12:00:00.000Z");
  const old = join(root, "view", "old.jpg");
  const newer = join(root, "view", "newer.jpg");
  const recent = join(root, "view", "recent.jpg");
  const leased = join(root, "view", "leased.jpg");
  const pinned = join(root, "emb", "pinned.jpg");
  const entries = new Map<string, CachePruneEntry & { pinned: boolean }>([
    [old, { path: old, bytes: 4, lastUsed: new Date(now.getTime() - 3_600_000), pinned: false }],
    [
      newer,
      { path: newer, bytes: 4, lastUsed: new Date(now.getTime() - 2_400_000), pinned: false },
    ],
    [recent, { path: recent, bytes: 4, lastUsed: new Date(now.getTime() - 60_000), pinned: false }],
    [
      leased,
      { path: leased, bytes: 4, lastUsed: new Date(now.getTime() - 3_000_000), pinned: false },
    ],
    [pinned, { path: pinned, bytes: 4, lastUsed: new Date(0), pinned: true }],
  ]);
  const index = fakeIndex(entries);
  const coordinator = new PreviewCoordinator();
  const lease = coordinator.tryLeaseForPrune(leased);
  try {
    await Promise.all(
      [...entries].map(async ([path]) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, "data");
        await writeFile(`${path}.json`, "sidecar");
      }),
    );

    const result = await pruneCache({ root, maxBytes: 16, index, coordinator, now });

    expect(result).toEqual({ removed: 1, freedBytes: 4, remainingBytes: 16, maxBytes: 16 });
    expect(entries.has(old)).toBe(false);
    await expect(access(old)).rejects.toThrow();
    await expect(access(`${old}.json`)).rejects.toThrow();
    expect(entries.has(newer)).toBe(true);
    expect(entries.has(recent)).toBe(true);
    expect(entries.has(leased)).toBe(true);
    expect(entries.has(pinned)).toBe(true);
  } finally {
    lease?.release();
    await rm(root, { recursive: true });
  }
});

test("a preview touched after pruning starts cannot be deleted from the captured candidate list", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cache-touch-race-"));
  const path = join(root, "view", "returned.jpg");
  const startedAt = new Date("2026-09-04T12:00:00.000Z");
  const entry = { path, bytes: 4, lastUsed: new Date(startedAt.getTime() - 3_600_000) };
  let releaseClaim!: () => void;
  const claimStarted = new Promise<void>((resolve) => {
    releaseClaim = resolve;
  });
  let allowClaim!: () => void;
  const claimAllowed = new Promise<void>((resolve) => {
    allowClaim = resolve;
  });
  let present = true;
  const index = {
    recordCompleted: async () => {},
    touch: async (_path: string, lastUsed: Date) => {
      entry.lastUsed = lastUsed;
    },
    evictionCandidates: async () => [{ ...entry }],
    claimIfOlderThan: async (_path: string, olderThan: Date) => {
      releaseClaim();
      await claimAllowed;
      if (entry.lastUsed >= olderThan) return false;
      present = false;
      return true;
    },
    restore: async () => {
      present = true;
    },
    totalBytes: async () => (present ? entry.bytes : 0),
  };
  const coordinator = new PreviewCoordinator();
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "data");
    const pruning = pruneCache({ root, maxBytes: 0, index, coordinator, now: startedAt });
    await claimStarted;
    await index.touch(path, startedAt);
    allowClaim();

    await expect(pruning).resolves.toMatchObject({ removed: 0, remainingBytes: 4 });
    expect(present).toBe(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("pinned cache tiers are protected even if their index flag is damaged", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cache-pinned-tier-"));
  const embedded = join(root, "emb", "source.jpg");
  const model = join(root, "models", "segment.onnx");
  const entries = new Map<string, CachePruneEntry & { pinned: boolean }>([
    [embedded, { path: embedded, bytes: 4, lastUsed: new Date(0), pinned: false }],
    [model, { path: model, bytes: 4, lastUsed: new Date(0), pinned: false }],
  ]);
  const index = fakeIndex(entries);
  const coordinator = new PreviewCoordinator();
  try {
    await mkdir(dirname(embedded), { recursive: true });
    await mkdir(dirname(model), { recursive: true });
    await writeFile(embedded, "data");
    await writeFile(model, "data");

    await expect(
      pruneCache({ root, maxBytes: 0, index, coordinator, now: new Date(3_600_000) }),
    ).resolves.toEqual({ removed: 0, freedBytes: 0, remainingBytes: 8, maxBytes: 0 });
    expect(entries.size).toBe(2);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("one undeletable artifact does not starve later eviction candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cache-prune-failure-"));
  const blocked = join(root, "view", "blocked.jpg");
  const removable = join(root, "view", "removable.jpg");
  const entries = new Map<string, CachePruneEntry & { pinned: boolean }>([
    [blocked, { path: blocked, bytes: 4, lastUsed: new Date(0), pinned: false }],
    [removable, { path: removable, bytes: 4, lastUsed: new Date(1), pinned: false }],
  ]);
  const index = fakeIndex(entries);
  const coordinator = new PreviewCoordinator();
  try {
    await mkdir(blocked, { recursive: true });
    await writeFile(`${blocked}.json`, "sidecar");
    await mkdir(dirname(removable), { recursive: true });
    await writeFile(removable, "data");

    await expect(
      pruneCache({ root, maxBytes: 0, index, coordinator, now: new Date(3_600_000) }),
    ).rejects.toThrow("blocked.jpg");
    expect(entries.has(blocked)).toBe(true);
    expect(entries.has(removable)).toBe(false);
  } finally {
    await rm(root, { recursive: true });
  }
});

test("prune continues across bounded LRU pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cache-prune-pages-"));
  const entries = new Map<string, CachePruneEntry & { pinned: boolean }>(
    Array.from({ length: 130 }, (_, position) => {
      const path = join(root, "view", `${String(position).padStart(3, "0")}.jpg`);
      return [path, { path, bytes: 1, lastUsed: new Date(position), pinned: false }];
    }),
  );
  try {
    await expect(
      pruneCache({
        root,
        maxBytes: 0,
        index: fakeIndex(entries),
        coordinator: new PreviewCoordinator(),
        now: new Date(3_600_000),
      }),
    ).resolves.toEqual({ removed: 130, freedBytes: 130, remainingBytes: 0, maxBytes: 0 });
    expect(entries.size).toBe(0);
  } finally {
    await rm(root, { recursive: true });
  }
});

function fakeIndex(entries: Map<string, CachePruneEntry & { pinned: boolean }>) {
  return {
    recordCompleted: async () => {},
    touch: async (path: string, lastUsed: Date) => {
      const entry = entries.get(path);
      if (entry) entry.lastUsed = lastUsed;
    },
    evictionCandidates: async (
      olderThan: Date,
      after?: CachePruneEntry,
      limit = Number.POSITIVE_INFINITY,
    ) =>
      [...entries.values()]
        .filter(
          (entry) =>
            !entry.pinned &&
            entry.lastUsed < olderThan &&
            (!after ||
              entry.lastUsed > after.lastUsed ||
              (entry.lastUsed.getTime() === after.lastUsed.getTime() && entry.path > after.path)),
        )
        .toSorted(
          (left, right) =>
            left.lastUsed.getTime() - right.lastUsed.getTime() ||
            left.path.localeCompare(right.path),
        )
        .slice(0, limit),
    claimIfOlderThan: async (path: string, olderThan: Date) => {
      const entry = entries.get(path);
      if (!entry || entry.pinned || entry.lastUsed >= olderThan) return false;
      entries.delete(path);
      return true;
    },
    restore: async (entry: CachePruneEntry) => {
      entries.set(entry.path, { ...entry, pinned: false });
    },
    totalBytes: async () => [...entries.values()].reduce((total, entry) => total + entry.bytes, 0),
  };
}
