import {
  EnvVolumeResolver,
  identifyFile,
  initializeLibrary,
  newLibraryEntityId,
} from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { ensurePhotoDocument } from "@photoctl/render";
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
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
      "SELECT p.id::text, p.rating FROM photos p JOIN originals o ON o.id = p.primary_original_id ORDER BY o.shot_at, p.id",
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

test("limited list checks only returned originals and refreshes volume availability", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-list-work-"));
  const mount = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  const ids = Array.from({ length: 3 }, () => newLibraryEntityId());
  const resolveOriginal = EnvVolumeResolver.prototype.resolve;
  const resolve = vi.spyOn(EnvVolumeResolver.prototype, "resolve");
  try {
    await mkdir(mount);
    for (const [index, id] of ids.entries()) {
      await seedPhoto(
        library.handle,
        id,
        `ck_220000000000000${index}`,
        `2025-01-01T1${index}:00:00Z`,
      );
      if (index === 0) continue;
      await seedLocator(library.handle, id, `${index}.jpg`);
      await writeFile(join(mount, `${index}.jpg`), "original");
    }
    for (const [volume, online] of [
      ["test-volume:online", true],
      ["test-volume:offline", false],
      ["other-volume:online", false],
      ["test-volume:online", true],
    ] as const) {
      resolve.mockClear();
      const result = await dispatch(request("list", ["--limit", "1"], `${mount}=${volume}`), {
        version: "test",
        library: library.handle,
      });
      expect(result).toMatchObject({
        ok: true,
        data: { total: 2, rows: [{ id: ids[1], file: "1.jpg", online }] },
      });
      expect(resolve.mock.calls).toEqual([["test-volume", "1.jpg"]]);
    }
    let active = 0;
    let highWater = 0;
    resolve.mockImplementation(async function (this: EnvVolumeResolver, volume, path) {
      active += 1;
      highWater = Math.max(highWater, active);
      try {
        return await resolveOriginal.call(this, volume, path);
      } finally {
        active -= 1;
      }
    });
    const complete = await dispatch(request("list", [], `${mount}=test-volume:online`), {
      version: "test",
      library: library.handle,
    });
    expect(complete).toMatchObject({
      ok: true,
      data: {
        total: 2,
        rows: [
          { id: ids[1], online: true },
          { id: ids[2], online: true },
        ],
      },
    });
    expect(highWater).toBe(2);
  } finally {
    resolve.mockRestore();
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("limited stale-XMP list counts every match before materializing availability", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-list-stale-work-"));
  const library = await initializeLibrary(join(root, "library"));
  const ids = Array.from({ length: 3 }, () => newLibraryEntityId());
  const resolve = vi.spyOn(EnvVolumeResolver.prototype, "resolve");
  try {
    for (const [index, id] of ids.entries()) {
      await seedPhoto(
        library.handle,
        id,
        `ck_230000000000000${index}`,
        `2025-01-01T1${index}:00:00Z`,
      );
      await seedLocator(library.handle, id, `${index}.jpg`);
      await writeFile(join(root, `${index}.jpg`), "original");
      const sidecar = join(root, `${index}.xmp`);
      await writeFile(sidecar, "sidecar");
      await library.handle.query(
        "INSERT INTO xmp_state (photo_id, sidecar_path, read_at, sidecar_mtime) VALUES ($1, $2, now(), $3)",
        [
          id,
          sidecar,
          index === 0 ? (await stat(sidecar)).mtime.toISOString() : new Date(0).toISOString(),
        ],
      );
    }
    const query = request("list", ["--xmp-stale", "--limit", "1"], `${root}=test-volume:online`);
    const result = await dispatch(query, { version: "test", library: library.handle });
    expect(result).toMatchObject({
      ok: true,
      data: { total: 2, rows: [{ id: ids[1], online: true }] },
    });
    expect(resolve.mock.calls).toEqual([["test-volume", "1.jpg"]]);
    await rm(join(root, "0.xmp"));
    resolve.mockClear();
    const changed = await dispatch(query, { version: "test", library: library.handle });
    expect(changed).toMatchObject({
      ok: true,
      data: { total: 3, rows: [{ id: ids[0], online: true }] },
    });
    expect(resolve.mock.calls).toEqual([["test-volume", "0.jpg"]]);
  } finally {
    resolve.mockRestore();
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
  const resolve = vi.spyOn(EnvVolumeResolver.prototype, "resolve");
  try {
    await mkdir(mount);
    await writeFile(join(mount, "first.jpg"), "one");
    await writeFile(join(mount, "second.jpg"), "two");
    await writeFile(join(mount, "third.jpg"), "three");
    await seedPhoto(library.handle, first, "ck_3000000000000001", "2025-01-01T10:00:00Z");
    await seedPhoto(library.handle, second, "ck_3000000000000002", "2025-01-01T10:00:00Z");
    await seedPhoto(library.handle, third, "ck_3000000000000003", null);
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
    const exhausted = await dispatch(nextRequest(), { version: "test", library: library.handle });
    const reset = await dispatch(nextRequest(["--reset"]), {
      version: "test",
      library: library.handle,
    });

    expect(one).toMatchObject({ ok: true, data: { id: first, remaining: 2 } });
    expect(two).toMatchObject({ ok: true, data: { id: second, remaining: 1 } });
    expect(three).toMatchObject({ ok: true, data: { id: third, remaining: 0 } });
    expect(exhausted).toMatchObject({ ok: false, code: "not_found" });
    expect(reset).toMatchObject({ ok: true, data: { id: first, remaining: 1 } });
    expect(resolve.mock.calls).toEqual([
      ["test-volume", "first.jpg"],
      ["test-volume", "second.jpg"],
      ["test-volume", "third.jpg"],
      ["test-volume", "first.jpg"],
    ]);
  } finally {
    resolve.mockRestore();
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
  const resolve = vi.spyOn(EnvVolumeResolver.prototype, "resolve");
  try {
    await library.handle.query(
      "INSERT INTO volumes (uuid, last_mount, last_seen) VALUES ('page-volume', $1, now())",
      [root],
    );
    await library.handle.query(
      `WITH inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation)
         SELECT id, id, 1, 1, 1 FROM unnest($1::uuid[]) AS input(id) RETURNING id)
       INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation, shot_at)
       SELECT id, id, 'jpeg', content_key, 1, 1, 1, 1, shot_at
       FROM unnest($1::uuid[], $2::text[], $3::timestamptz[])
         AS input(id, content_key, shot_at)`,
      [
        ids,
        ids.map((_id, index) => `ck_${index.toString(16).padStart(16, "0")}`),
        ids.map((_id, index) => new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString()),
      ],
    );
    await library.handle.query(
      `INSERT INTO files (id, original_id, volume_uuid, rel_path, mtime)
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
        expect(resolve.mock.calls).toHaveLength(streamed.length + 1);
        active += 1;
        highWater = Math.max(highWater, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(resolve.mock.calls).toHaveLength(streamed.length + 1);
        streamed.push((row as { id: string }).id);
        active -= 1;
      },
    });

    expect(highWater).toBe(1);
    expect(streamed).toEqual(ids);
    expect(result).toMatchObject({ ok: true, data: { rows: [], total: 70 } });
    resolve.mockClear();
    const limited: string[] = [];
    const page = await dispatch(
      request("list", ["--stream", "--limit", "2"], `${root}=page-volume:online`),
      {
        version: "test",
        library: library.handle,
        stream: (row) => {
          limited.push((row as { id: string }).id);
        },
      },
    );
    expect(limited).toEqual(ids.slice(0, 2));
    expect(page).toMatchObject({ ok: true, data: { rows: [], total: 70 } });
    expect(resolve.mock.calls).toEqual([
      ["page-volume", "00.jpg"],
      ["page-volume", "01.jpg"],
    ]);
  } finally {
    resolve.mockRestore();
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

test.each([false, true])(
  "remove restores source, cache and graph when post-teardown failure is %s",
  async (failDelete) => {
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
      const identity = await identifyFile(source);
      await library.handle.query("UPDATE originals SET content_key = $2, size = $3 WHERE id = $1", [
        id,
        identity.contentKey,
        identity.size,
      ]);
      await seedLocator(library.handle, id, "frame.jpg");
      const graph = await ensurePhotoDocument(library.handle, { photoId: id, orientation: 1 });
      if (failDelete) {
        await library.handle.query(
          "CREATE FUNCTION reject_photo_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced photo delete failure'; END $$",
        );
        await library.handle.query(
          "CREATE TRIGGER reject_photo_delete BEFORE DELETE ON photos FOR EACH ROW EXECUTE FUNCTION reject_photo_delete()",
        );
      }
      const preview = join(cache, library.libraryId, "emb", `${id}.jpg`);
      await mkdir(join(cache, library.libraryId, "emb"), { recursive: true });
      await writeFile(preview, "preview");
      await library.handle.query(
        "INSERT INTO cache_index (path, bytes, last_used, pinned) VALUES ($1, 7, now(), true)",
        [`emb/${id}.jpg`],
      );

      const pending = dispatch(
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

      if (failDelete) {
        await expect(pending).rejects.toThrow("forced photo delete failure");
        await expect(access(source)).resolves.toBeUndefined();
        await expect(access(preview)).resolves.toBeUndefined();
        expect(
          (
            await library.handle.query(
              "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
              [id],
            )
          ).rows,
        ).toEqual([{ active_revision_id: graph.revisionId }]);
        expect(
          (
            await library.handle.query(
              "SELECT node_id FROM document_revision_roots WHERE photo_id = $1 AND root_name = 'output'",
              [id],
            )
          ).rows,
        ).toEqual([{ node_id: graph.outputNodeId }]);
        expect((await library.handle.query("SELECT path FROM cache_index")).rows).toEqual([
          { path: `emb/${id}.jpg` },
        ]);
        return;
      }
      expect(await pending).toMatchObject({ ok: true, summary: { ok: 1, failed: 0 } });
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
  },
);

test("remove from disk preserves a replacement at the original locator", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-remove-replaced-"));
  const library = await initializeLibrary(join(root, "library"));
  const mount = join(root, "drive");
  const source = join(mount, "frame.jpg");
  const id = newLibraryEntityId();
  try {
    await mkdir(mount);
    await writeFile(source, "original");
    const identity = await identifyFile(source);
    await seedPhoto(library.handle, id, identity.contentKey, null);
    await library.handle.query("UPDATE originals SET size = $2 WHERE id = $1", [id, identity.size]);
    await seedLocator(library.handle, id, "frame.jpg");
    await writeFile(source, "replaced");
    const result = await dispatch(
      {
        ...request("remove", [id, "--from-disk"]),
        env: {
          noDaemon: true,
          volumeMap: `${mount}=test-volume:online`,
          cacheRoot: join(root, "cache"),
        },
      },
      { version: "test", library: library.handle },
    );
    expect(await readFile(source, "utf8")).toBe("replaced");
    expect(result).toMatchObject({
      ok: true,
      warnings: [
        {
          code: "source_offline",
          id,
          message:
            "The catalogued original could not be verified; the file at its locator was left untouched",
        },
      ],
    });
    expect((await library.handle.query("SELECT id FROM photos")).rows).toEqual([]);
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
    `INSERT INTO files (id, original_id, volume_uuid, rel_path, mtime)
     VALUES ($1, $2, 'test-volume', $3, now())`,
    [newLibraryEntityId(), photoId, relPath],
  );
}

async function seedPhoto(
  handle: Awaited<ReturnType<typeof initializeLibrary>>["handle"],
  id: string,
  contentKey: string,
  shotAt: string | null,
): Promise<void> {
  await handle.query(
    `WITH inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation)
       VALUES ($1, $1, 1, 1, 1) RETURNING id)
     INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation, shot_at)
     VALUES ($1, $1, 'jpeg', $2, 1, 1, 1, 1, $3)`,
    [id, contentKey, shotAt],
  );
}
