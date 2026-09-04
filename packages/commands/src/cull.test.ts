import { initializeLibrary, newLibraryEntityId } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { rollbackReceiptsOrThrow } from "./handlers/cull.js";

test("rate reports a missing item without starving valid photos", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-cull-"));
  const library = await initializeLibrary(join(root, "library"));
  const first = newLibraryEntityId();
  const second = newLibraryEntityId();
  try {
    await seedPhoto(library.handle, first, "ck_1000000000000001", "2025-01-01T10:00:00Z");
    await seedPhoto(library.handle, second, "ck_1000000000000002", "2025-01-01T11:00:00Z");

    const result = await dispatch(request("rate", [first, "ffffffff", second, "--stars", "5"]), {
      version: "test",
      library: library.handle,
    });

    expect(result).toMatchObject({
      schema: 1,
      ok: false,
      code: "partial",
      summary: { ok: 2, failed: 1 },
      results: [
        { id: first, ok: true },
        { id: "ffffffff", ok: false, code: "not_found" },
        { id: second, ok: true },
      ],
    });
    const rows = await library.handle.query<{ id: string; rating: number }>(
      "SELECT id::text, rating FROM photos ORDER BY shot_at, id",
    );
    expect(rows.rows).toEqual([
      { id: first, rating: 5 },
      { id: second, rating: 5 },
    ]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("list filters and orders catalog rows while resolving current online state", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-list-"));
  const mount = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  const first = newLibraryEntityId();
  const second = newLibraryEntityId();
  const literal = newLibraryEntityId();
  try {
    await mkdir(join(mount, "wedding"), { recursive: true });
    await writeFile(join(mount, "wedding", "first.jpg"), "one");
    await writeFile(join(mount, "wedding", "second.jpg"), "two");
    await seedPhoto(library.handle, second, "ck_2000000000000002", "2025-01-01T11:00:00Z");
    await seedPhoto(library.handle, first, "ck_2000000000000001", "2025-01-01T10:00:00Z");
    await seedLocator(library.handle, first, "wedding/first.jpg");
    await seedLocator(library.handle, second, "wedding/second.jpg");
    await library.handle.query("UPDATE photos SET rating = 4, flag = 'pick' WHERE id = $1", [
      first,
    ]);
    await library.handle.query("UPDATE photos SET rating = 5, flag = 'pick' WHERE id = $1", [
      second,
    ]);

    const result = await dispatch(
      request(
        "list",
        ["--rating", ">=4", "--flag", "pick", "--folder", "wedding"],
        `${mount}=test-volume:online`,
      ),
      { version: "test", library: library.handle },
    );

    expect(result).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        total: 2,
        rows: [
          { id: first, file: "first.jpg", rating: 4, flag: "pick", online: true },
          { id: second, file: "second.jpg", rating: 5, flag: "pick", online: true },
        ],
      },
    });
    await mkdir(join(mount, "wed_ing"));
    await writeFile(join(mount, "wed_ing", "literal.jpg"), "three");
    await seedPhoto(library.handle, literal, "ck_2000000000000003", "2025-01-01T12:00:00Z");
    await seedLocator(library.handle, literal, "wed_ing/literal.jpg");
    const escaped = await dispatch(
      request("list", ["--folder", "wed_ing"], `${mount}=test-volume:online`),
      { version: "test", library: library.handle },
    );
    expect(escaped).toMatchObject({ data: { total: 1, rows: [{ id: literal }] } });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("next keeps an independent ordered cursor per filter and reset rewinds it", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-next-"));
  const mount = join(root, "drive");
  const cache = join(root, "cache");
  const library = await initializeLibrary(join(root, "library"));
  const first = newLibraryEntityId();
  const second = newLibraryEntityId();
  const third = newLibraryEntityId();
  try {
    await mkdir(mount);
    await writeFile(join(mount, "first.jpg"), "one");
    await writeFile(join(mount, "second.jpg"), "two");
    await writeFile(join(mount, "third.jpg"), "three");
    await seedPhoto(library.handle, first, "ck_3000000000000001", "2025-01-01T10:00:00Z");
    await seedPhoto(library.handle, second, "ck_3000000000000002", "2025-01-01T11:00:00Z");
    await seedPhoto(library.handle, third, "ck_3000000000000003", "2025-01-01T12:00:00Z");
    await seedLocator(library.handle, first, "first.jpg");
    await seedLocator(library.handle, second, "second.jpg");
    await seedLocator(library.handle, third, "third.jpg");
    const libraryCache = join(cache, library.libraryId, "emb");
    await mkdir(libraryCache, { recursive: true });
    await writeFile(join(libraryCache, `${first}.jpg`), "preview one");
    await writeFile(join(libraryCache, `${second}.jpg`), "preview two");
    await writeFile(join(libraryCache, `${third}.jpg`), "preview three");
    const nextRequest = (extra: string[] = []) => ({
      ...request("next", ["--unrated", ...extra], `${mount}=test-volume:online`),
      env: {
        noDaemon: true,
        volumeMap: `${mount}=test-volume:online`,
        cacheRoot: cache,
      },
    });

    const one = await dispatch(nextRequest(), { version: "test", library: library.handle });
    const two = await dispatch(nextRequest(), { version: "test", library: library.handle });
    await library.handle.query("UPDATE photos SET rating = 5 WHERE id = $1", [second]);
    const three = await dispatch(nextRequest(), { version: "test", library: library.handle });
    const reset = await dispatch(nextRequest(["--reset"]), {
      version: "test",
      library: library.handle,
    });

    expect(one).toMatchObject({ ok: true, data: { id: first, remaining: 2 } });
    expect(two).toMatchObject({ ok: true, data: { id: second, remaining: 1 } });
    expect(three).toMatchObject({ ok: true, data: { id: third, remaining: 0 } });
    expect(reset).toMatchObject({ ok: true, data: { id: first, remaining: 1 } });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("next advances its cursor only after the pinned preview is deliverable", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-next-preview-"));
  const mount = join(root, "drive");
  const cache = join(root, "cache");
  const library = await initializeLibrary(join(root, "library"));
  const first = newLibraryEntityId();
  const second = newLibraryEntityId();
  try {
    await mkdir(mount);
    await writeFile(join(mount, "first.jpg"), "one");
    await writeFile(join(mount, "second.jpg"), "two");
    await seedPhoto(library.handle, first, "ck_3100000000000001", "2025-01-01T10:00:00Z");
    await seedPhoto(library.handle, second, "ck_3100000000000002", "2025-01-01T11:00:00Z");
    await seedLocator(library.handle, first, "first.jpg");
    await seedLocator(library.handle, second, "second.jpg");
    const libraryCache = join(cache, library.libraryId, "emb");
    await mkdir(libraryCache, { recursive: true });
    await writeFile(join(libraryCache, `${second}.jpg`), "preview two");
    const nextRequest = {
      ...request("next", [], `${mount}=test-volume:online`),
      env: {
        noDaemon: true,
        volumeMap: `${mount}=test-volume:online`,
        cacheRoot: cache,
      },
    };

    const unavailable = await dispatch(nextRequest, { version: "test", library: library.handle });
    await writeFile(join(libraryCache, `${first}.jpg`), "preview one");
    const retried = await dispatch(nextRequest, { version: "test", library: library.handle });

    expect(unavailable).toMatchObject({ ok: false, code: "file_offline", data: { id: first } });
    expect(retried).toMatchObject({ ok: true, data: { id: first, remaining: 1 } });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("streamed list pages rows in order and waits for each consumer", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-list-stream-pages-"));
  const library = await initializeLibrary(join(root, "library"));
  const ids = Array.from({ length: 70 }, () => newLibraryEntityId());
  try {
    await library.handle.query(
      "INSERT INTO volumes (uuid, last_mount, last_seen) VALUES ('page-volume', $1, now())",
      [root],
    );
    await library.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation, shot_at)
       SELECT id, content_key, 1, 1, 1, 1, shot_at
       FROM unnest($1::uuid[], $2::text[], $3::timestamptz[])
         AS input(id, content_key, shot_at)`,
      [
        ids,
        ids.map((_id, index) => `ck_${index.toString(16).padStart(16, "0")}`),
        ids.map((_id, index) => new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()),
      ],
    );
    await library.handle.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       SELECT file_id, photo_id, 'page-volume', rel_path, now()
       FROM unnest($1::uuid[], $2::uuid[], $3::text[])
         AS input(file_id, photo_id, rel_path)`,
      [
        ids.map(() => newLibraryEntityId()),
        ids,
        ids.map((_id, index) => `${index.toString().padStart(2, "0")}.jpg`),
      ],
    );
    const streamed: string[] = [];
    let active = 0;
    let highWater = 0;
    const result = await dispatch(request("list", ["--stream"], `${root}=page-volume:online`), {
      version: "test",
      library: library.handle,
      stream: async (row) => {
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        streamed.push((row as { id: string }).id);
        active -= 1;
      },
    });

    expect(highWater).toBe(1);
    expect(streamed).toEqual(ids);
    expect(result).toMatchObject({ ok: true, data: { rows: [], total: 70 } });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test.each([[["--from-disk"]], [[]]])(
  "removing several photos requires explicit confirmation before any mutation (%j)",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-remove-confirm-"));
    const library = await initializeLibrary(join(root, "library"));
    const first = newLibraryEntityId();
    const second = newLibraryEntityId();
    try {
      await seedPhoto(library.handle, first, "ck_5000000000000001", "2025-01-01T10:00:00Z");
      await seedPhoto(library.handle, second, "ck_5000000000000002", "2025-01-01T11:00:00Z");

      const result = await dispatch(request("remove", [first, second, ...mode]), {
        version: "test",
        library: library.handle,
      });

      expect(result).toMatchObject({
        ok: false,
        code: "usage",
        data: { message: "removing several photos requires --yes" },
      });
      const count = await library.handle.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM photos",
      );
      expect(count.rows).toEqual([{ count: "2" }]);
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
);

test("remove commits catalog deletion only after source trash and cache staging succeed", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-remove-"));
  const mount = join(root, "drive");
  const cache = join(root, "cache");
  const library = await initializeLibrary(join(root, "library"));
  const id = newLibraryEntityId();
  const source = join(mount, "frame.jpg");
  try {
    await mkdir(mount);
    await writeFile(source, "source");
    await seedPhoto(library.handle, id, "ck_6000000000000001", "2025-01-01T10:00:00Z");
    await seedLocator(library.handle, id, "frame.jpg");
    const preview = join(cache, library.libraryId, "emb", `${id}.jpg`);
    await mkdir(join(cache, library.libraryId, "emb"), { recursive: true });
    await writeFile(preview, "preview");
    await library.handle.query(
      "INSERT INTO cache_index (path, bytes, last_used, pinned) VALUES ($1, 7, now(), true)",
      [`emb/${id}.jpg`],
    );

    const result = await dispatch(
      {
        ...request("remove", [id, "--from-disk"], `${mount}=test-volume:online`),
        env: {
          noDaemon: true,
          volumeMap: `${mount}=test-volume:online`,
          cacheRoot: cache,
        },
      },
      { version: "test", library: library.handle },
    );

    expect(result).toMatchObject({ ok: true, summary: { ok: 1, failed: 0 } });
    await expect(access(source)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(preview)).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await readdir(join(mount, ".trash"))).some((name) => name.startsWith("frame.jpg.")),
    ).toBe(true);
    const count = await library.handle.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM photos",
    );
    expect(count.rows).toEqual([{ count: "0" }]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("rollback failure is surfaced with every path that could not be restored", async () => {
  await expect(
    rollbackReceiptsOrThrow(
      [
        {
          original: "/drive/frame.jpg",
          destination: "/drive/.trash/frame.jpg",
          commit: async () => undefined,
          rollback: async () => {
            throw new Error("volume disappeared");
          },
        },
      ],
      new Error("catalog failed"),
    ),
  ).rejects.toMatchObject({
    code: "volume_readonly",
    data: {
      cause: "catalog failed",
      rollback_failures: [{ path: "/drive/frame.jpg", message: "volume disappeared" }],
    },
  });
});

function request(verb: string, args: string[], volumeMap?: string): CommandRequest {
  return { verb, args, cwd: process.cwd(), env: { noDaemon: true, volumeMap } };
}

async function seedLocator(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  photoId: string,
  relPath: string,
): Promise<void> {
  await handle.query(
    `INSERT INTO volumes (uuid, label, last_mount, last_seen)
     VALUES ('test-volume', 'drive', '/unused', now()) ON CONFLICT DO NOTHING`,
  );
  await handle.query(
    `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
     VALUES ($1, $2, 'test-volume', $3, now())`,
    [newLibraryEntityId(), photoId, relPath],
  );
}

async function seedPhoto(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  id: string,
  contentKey: string,
  shotAt: string,
): Promise<void> {
  await handle.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation, shot_at)
     VALUES ($1, $2, 1, 1, 1, 1, $3)`,
    [id, contentKey, shotAt],
  );
}
