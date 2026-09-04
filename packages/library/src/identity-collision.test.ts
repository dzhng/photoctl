import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { identifyFile, resolveContentIdentity } from "./identity.js";
import { migrate } from "./migrations/runner.js";

test("sample-key collisions promote both files and preserve distinct stable IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-collision-"));
  const firstPath = join(root, "first.bin");
  const secondPath = join(root, "second.bin");
  const firstBytes = Buffer.alloc(2 * 1024 * 1024 + 64, 7);
  const secondBytes = Buffer.from(firstBytes);
  secondBytes.fill(13, 1024 * 1024, 1024 * 1024 + 64);
  const firstId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const db = await PGlite.create();
  try {
    await writeFile(firstPath, firstBytes);
    await writeFile(secondPath, secondBytes);
    await migrate(db);
    const identity = await identifyFile(firstPath);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, $2, $3, 1, 1, 1)`,
      [firstId, identity.contentKey, identity.size],
    );
    await db.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('volume', 'drive', $1, now())`,
      [root],
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c010', $1, 'volume', 'first.bin', now())`,
      [firstId],
    );
    const resolver = {
      locate: async () => {
        throw new Error("unused");
      },
      resolve: async (_volume: string, relPath: string) => ({
        mount: root,
        path: join(root, relPath),
        online: true,
      }),
    };

    const second = await resolveContentIdentity(
      db,
      secondPath,
      identity,
      "volume",
      "second.bin",
      resolver,
    );
    await db.query(
      `INSERT INTO photos (id, content_key, content_hash, size, w, h, orientation)
       VALUES ($1, $2, $3, $4, 1, 1, 1)`,
      [second.photoId, identity.contentKey, second.contentHash, identity.size],
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c011', $1, 'volume', 'second.bin', now())`,
      [second.photoId],
    );
    const again = await resolveContentIdentity(
      db,
      secondPath,
      identity,
      "volume",
      "second.bin",
      resolver,
    );

    expect(second.photoId).not.toBe(firstId);
    expect(second.contentHash).toMatch(/^sha256_[0-9a-f]{64}$/);
    expect(again).toEqual(second);
    const promoted = await db.query<{ id: string; content_hash: string }>(
      "SELECT id::text, content_hash FROM photos WHERE content_key = $1 ORDER BY id",
      [identity.contentKey],
    );
    expect(promoted.rows).toEqual([
      { id: firstId, content_hash: expect.stringMatching(/^sha256_[0-9a-f]{64}$/) },
      { id: second.photoId, content_hash: second.contentHash },
    ]);
  } finally {
    await db.close();
    await rm(root, { recursive: true });
  }
});

test("an offline unpromoted candidate never absorbs a sampled-key collision", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-collision-offline-"));
  const candidate = join(root, "candidate.bin");
  const db = await PGlite.create();
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c020";
  try {
    await writeFile(candidate, Buffer.alloc(2 * 1024 * 1024 + 1, 3));
    await migrate(db);
    const identity = await identifyFile(candidate);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, $2, $3, 1, 1, 1)`,
      [id, identity.contentKey, identity.size],
    );
    await db.query(
      "INSERT INTO volumes (uuid, last_mount, last_seen) VALUES ('offline', '/gone', now())",
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c021', $1, 'offline', 'old.bin', now())`,
      [id],
    );

    await expect(
      resolveContentIdentity(db, candidate, identity, "new", "candidate.bin", {
        locate: async () => {
          throw new Error("unused");
        },
        resolve: async () => ({ mount: null, path: null, online: false }),
      }),
    ).rejects.toMatchObject({ code: "file_offline" });
    const stored = await db.query<{ content_hash: string | null }>(
      "SELECT content_hash FROM photos WHERE id = $1",
      [id],
    );
    expect(stored.rows).toEqual([{ content_hash: null }]);
  } finally {
    await db.close();
    await rm(root, { recursive: true });
  }
});

test("a missing locator is relocation only on its confirmed-online volume", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-relocation-boundary-"));
  const candidate = join(root, "renamed.bin");
  const db = await PGlite.create();
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c030";
  try {
    await writeFile(candidate, Buffer.alloc(2 * 1024 * 1024 + 1, 9));
    await migrate(db);
    const identity = await identifyFile(candidate);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, $2, $3, 1, 1, 1)`,
      [id, identity.contentKey, identity.size],
    );
    await db.query(
      "INSERT INTO volumes (uuid, last_mount, last_seen) VALUES ('volume', $1, now())",
      [root],
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c031', $1, 'volume', 'old.bin', now())`,
      [id],
    );
    const onlineMissing = {
      locate: async () => {
        throw new Error("unused");
      },
      resolve: async () => ({ mount: root, path: null, online: false }),
    };

    await expect(
      resolveContentIdentity(db, candidate, identity, "volume", "renamed.bin", onlineMissing),
    ).resolves.toEqual({ photoId: id, contentHash: null });
    await expect(
      resolveContentIdentity(db, candidate, identity, "other", "renamed.bin", onlineMissing),
    ).rejects.toMatchObject({ code: "file_offline" });
  } finally {
    await db.close();
    await rm(root, { recursive: true });
  }
});

test("an exact unpromoted locator accepts stable mtime and refuses replacement in place", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-exact-sampled-"));
  const candidate = join(root, "frame.bin");
  const firstBytes = Buffer.alloc(2 * 1024 * 1024 + 64, 4);
  const secondBytes = Buffer.from(firstBytes);
  secondBytes.fill(8, 1024 * 1024, 1024 * 1024 + 64);
  const db = await PGlite.create();
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c040";
  try {
    await writeFile(candidate, firstBytes);
    const firstIdentity = await identifyFile(candidate);
    await migrate(db);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, $2, $3, 1, 1, 1)`,
      [id, firstIdentity.contentKey, firstIdentity.size],
    );
    await db.query(
      "INSERT INTO volumes (uuid, last_mount, last_seen) VALUES ('volume', $1, now())",
      [root],
    );
    await db.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91c041', $1, 'volume', 'frame.bin', $2)`,
      [id, firstIdentity.mtime.toISOString()],
    );
    const resolver = {
      locate: async () => {
        throw new Error("unused");
      },
      resolve: async () => ({ mount: root, path: candidate, online: true }),
    };
    await expect(
      resolveContentIdentity(db, candidate, firstIdentity, "volume", "frame.bin", resolver),
    ).resolves.toEqual({ photoId: id, contentHash: null });

    await writeFile(candidate, secondBytes);
    const changedTime = new Date(firstIdentity.mtime.getTime() + 2_000);
    await utimes(candidate, changedTime, changedTime);
    const secondIdentity = await identifyFile(candidate);
    expect(secondIdentity.contentKey).toBe(firstIdentity.contentKey);
    await expect(
      resolveContentIdentity(db, candidate, secondIdentity, "volume", "frame.bin", resolver),
    ).rejects.toMatchObject({ code: "unsupported_file" });
  } finally {
    await db.close();
    await rm(root, { recursive: true });
  }
});
