import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import sharp from "sharp";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary, openLibrary } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { dispatch } from "./dispatch.js";

test("copy import catalogs an already-in-place original without duplicating it on repeat", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-copy-in-place-"));
  const library = await initializeLibrary(join(root, "library"));
  try {
    const folder = join(library.handle.path, "originals", "undated");
    await mkdir(folder, { recursive: true });
    const source = join(folder, "edited.jpg");
    await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } })
      .jpeg()
      .toFile(source);
    const bytes = await readFile(source);
    const request: CommandRequest = {
      verb: "import",
      args: [source, "--copy"],
      cwd: root,
      env: {
        noDaemon: true,
        cacheRoot: join(root, "cache"),
        volumeMap: `${root}=fixture-volume:online`,
      },
    };
    const first = await dispatch(request, { version: "test", library: library.handle });
    expect(first).toMatchObject({ ok: true, data: { imported: 1 } });
    const second = await dispatch(request, { version: "test", library: library.handle });
    expect(second).toMatchObject({ ok: true, data: { already_present: 1 } });
    if (!first.ok || !("data" in first)) throw new Error("import failed");
    expect(second).toMatchObject({ data: { ids: (first.data as { ids: string[] }).ids } });
    expect(await readdir(folder)).toEqual(["edited.jpg"]);
    expect(await readFile(source)).toEqual(bytes);
    expect((await library.handle.query("SELECT volume_uuid, rel_path FROM files")).rows).toEqual([
      { volume_uuid: "photoctl-library", rel_path: "originals/undated/edited.jpg" },
    ]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("reimport restores a missing cache index without rewriting a valid preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-cache-index-repair-"));
  const libraryPath = join(directory, "library");
  const fixture = resolve("fixtures/a7c2.ARW");
  const request: CommandRequest = {
    verb: "import",
    args: [fixture, "--link"],
    cwd: process.cwd(),
    env: {
      noDaemon: true,
      libraryPath,
      cacheRoot: join(directory, "cache"),
      volumeMap: `${process.cwd()}=fixture-volume:online`,
    },
  };
  try {
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.close();
    const first = await dispatch(request, { version: "test" });
    expect(first).toMatchObject({ schema: 1, ok: true });
    const expectedBytes = (first as { data: { previews: { bytes: number } } }).data.previews.bytes;

    const handle = await openLibrary(libraryPath, { noDaemon: true });
    await handle.query("DELETE FROM cache_index");
    await handle.close();

    const second = await dispatch(request, { version: "test" });
    expect(second).toMatchObject({
      schema: 1,
      ok: true,
      data: { already_present: 1, previews: { embedded_extracted: 0 } },
    });

    const verified = await openLibrary(libraryPath, { noDaemon: true });
    const index = await verified.query<{ bytes: string; pinned: boolean }>(
      "SELECT bytes::text, pinned FROM cache_index",
    );
    await verified.close();
    expect(index.rows).toEqual([{ bytes: String(expectedBytes), pinned: true }]);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 30_000);
