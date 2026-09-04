import { removePreviewArtifact, type PreviewCoordinator } from "@photoctl/render";
import { isAbsolute, relative, sep } from "node:path";

export interface CachePruneEntry {
  path: string;
  bytes: number;
  lastUsed: Date;
}

export interface CachePruneIndex {
  evictionCandidates(
    olderThan: Date,
    after?: CachePruneEntry,
    limit?: number,
  ): Promise<CachePruneEntry[]>;
  claimIfOlderThan(path: string, olderThan: Date): Promise<boolean>;
  restore(entry: CachePruneEntry): Promise<void>;
  totalBytes(): Promise<number>;
}

export interface CachePruneResult {
  removed: number;
  freedBytes: number;
  remainingBytes: number;
  maxBytes: number;
}

export class CachePruneError extends Error {
  constructor(
    readonly path: string,
    readonly reason: unknown,
  ) {
    super(`Could not remove cache artifact: ${path}`);
  }
}

/** Applies the LRU budget to unpinned artifacts without racing active preview readers. */
export async function pruneCache(options: {
  root: string;
  maxBytes: number;
  index: CachePruneIndex;
  coordinator: PreviewCoordinator;
  now?: Date;
  graceMs?: number;
}): Promise<CachePruneResult> {
  const pruneStartedAt = options.now ?? new Date();
  const recentCutoff = new Date(pruneStartedAt.getTime() - (options.graceMs ?? 30 * 60_000));
  const remainingBytes = await options.index.totalBytes();
  const state = { remainingBytes, removed: 0, freedBytes: 0 };

  if (remainingBytes > options.maxBytes) {
    const firstFailure = await prunePages(options, recentCutoff, state);
    if (firstFailure) throw firstFailure;
  }

  return {
    removed: state.removed,
    freedBytes: state.freedBytes,
    remainingBytes: await options.index.totalBytes(),
    maxBytes: options.maxBytes,
  };
}

const EVICTION_PAGE_SIZE = 128;

async function prunePages(
  options: Parameters<typeof pruneCache>[0],
  recentCutoff: Date,
  state: { remainingBytes: number; removed: number; freedBytes: number },
  after?: CachePruneEntry,
  priorFailure?: CachePruneError,
): Promise<CachePruneError | undefined> {
  const candidates = await options.index.evictionCandidates(
    recentCutoff,
    after,
    EVICTION_PAGE_SIZE,
  );
  const failure = await candidates.reduce<Promise<CachePruneError | undefined>>(
    async (pendingFailure, candidate) => {
      let currentFailure = await pendingFailure;
      if (
        state.remainingBytes <= options.maxBytes ||
        !isPrunablePath(options.root, candidate.path)
      ) {
        return currentFailure;
      }
      const lease = options.coordinator.tryLeaseForPrune(candidate.path);
      if (!lease) return currentFailure;
      try {
        if (await options.index.claimIfOlderThan(candidate.path, recentCutoff)) {
          try {
            await removePreviewArtifact(candidate.path);
            state.remainingBytes -= candidate.bytes;
            state.freedBytes += candidate.bytes;
            state.removed += 1;
          } catch (error) {
            await options.index.restore(candidate);
            currentFailure ??= new CachePruneError(candidate.path, error);
          }
        }
      } finally {
        lease.release();
      }
      return currentFailure;
    },
    Promise.resolve(priorFailure),
  );
  if (state.remainingBytes <= options.maxBytes || candidates.length < EVICTION_PAGE_SIZE) {
    return failure;
  }
  return await prunePages(options, recentCutoff, state, candidates.at(-1), failure);
}

function isPrunablePath(root: string, path: string): boolean {
  const child = relative(root, path);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) return false;
  const tier = child.split(sep)[0];
  return tier !== "emb" && tier !== "models";
}
