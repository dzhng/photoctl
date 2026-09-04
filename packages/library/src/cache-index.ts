import type { LibraryHandle } from "./open.js";
import { isAbsolute, join, relative, sep } from "node:path";

export interface CacheEntry {
  path: string;
  bytes: number;
  lastUsed: Date;
}

/** PGlite-backed index for cache accounting; filesystem access stays with cache producers. */
export class CacheIndex {
  constructor(
    private readonly library: LibraryHandle,
    private readonly root: string,
  ) {}

  async recordCompleted(artifact: { path: string; bytes: number; lastUsed: Date }): Promise<void> {
    await this.library.query(
      `INSERT INTO cache_index (path, bytes, last_used, pinned)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (path) DO UPDATE
       SET bytes = EXCLUDED.bytes, last_used = EXCLUDED.last_used`,
      [this.key(artifact.path), artifact.bytes, artifact.lastUsed],
    );
  }

  async touch(path: string, lastUsed: Date): Promise<void> {
    await this.library.query("UPDATE cache_index SET last_used = $2 WHERE path = $1", [
      this.key(path),
      lastUsed,
    ]);
  }

  async evictionCandidates(
    olderThan: Date,
    after?: CacheEntry,
    limit = 128,
  ): Promise<CacheEntry[]> {
    const result = await this.library.query<{
      path: string;
      bytes: string | number;
      last_used: Date | string;
    }>(
      `SELECT path, bytes, last_used
       FROM cache_index
       WHERE pinned = false
         AND last_used < $1
         AND (
           $2::timestamptz IS NULL
           OR last_used > $2
           OR (last_used = $2 AND path > $3)
         )
       ORDER BY last_used, path
       LIMIT $4`,
      [olderThan, after?.lastUsed ?? null, after ? this.key(after.path) : null, limit],
    );
    return result.rows.map((row) => ({
      path: join(this.root, row.path),
      bytes: Number(row.bytes),
      lastUsed: new Date(row.last_used),
    }));
  }

  async claimIfOlderThan(path: string, olderThan: Date): Promise<boolean> {
    const result = await this.library.query<{ path: string }>(
      `DELETE FROM cache_index
       WHERE path = $1 AND pinned = false AND last_used < $2
       RETURNING path`,
      [this.key(path), olderThan],
    );
    return result.rows.length === 1;
  }

  async restore(entry: CacheEntry): Promise<void> {
    await this.recordCompleted({
      path: entry.path,
      bytes: entry.bytes,
      lastUsed: entry.lastUsed,
    });
  }

  async totalBytes(): Promise<number> {
    const result = await this.library.query<{ total: string | number }>(
      "SELECT COALESCE(sum(bytes), 0)::text AS total FROM cache_index",
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  private key(path: string): string {
    const key = relative(this.root, path);
    if (!key || key === ".." || key.startsWith(`..${sep}`) || isAbsolute(key)) {
      throw new Error(`Cache artifact is outside its configured root: ${path}`);
    }
    return key;
  }
}
