import { fullFileHash, identifyFile, initializeLibrary } from "@photoctl/library";
import type { CommandRequest, ProgressEvent } from "@photoctl/protocol";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";
import { execute } from "./execute.js";
import { copyIntoLibrary } from "./handlers/import.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("recursive import admits content-probed unknown extensions and relocates idempotently", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-reimport-"));
  const drive = join(root, "drive");
  const library = await initializeLibrary(join(root, "library"));
  const cache = join(root, "cache");
  const events: ProgressEvent[] = [];
  const request: CommandRequest = {
    verb: "import",
    args: [drive, "--link", "--recursive"],
    cwd: process.cwd(),
    env: {
      noDaemon: true,
      cacheRoot: cache,
      volumeMap: `${drive}=drive-volume:online`,
    },
  };
  try {
    await mkdir(join(drive, "nested"), { recursive: true });
    await writeFile(join(drive, "nested", "frame.payload"), png);

    const first = await dispatch(request, {
      version: "test",
      library: library.handle,
      emit: (event) => {
        if (event.event === "progress") events.push(event);
      },
    });
    const firstId = (first as { data: { ids: string[] } }).data.ids[0];
    const second = await dispatch(request, { version: "test", library: library.handle });
    await rename(join(drive, "nested", "frame.payload"), join(drive, "nested", "renamed.bin"));
    const moved = await dispatch(request, { version: "test", library: library.handle });

    expect(first).toMatchObject({ ok: true, data: { imported: 1, already_present: 0 } });
    expect(second).toMatchObject({
      ok: true,
      data: { imported: 0, already_present: 1, ids: [firstId] },
    });
    expect(moved).toMatchObject({
      ok: true,
      data: { imported: 0, already_present: 1, ids: [firstId] },
    });
    expect(events).toMatchObject([
      { event: "progress", phase: "scan", done: 1, total: 1 },
      { event: "progress", phase: "import", done: 1, total: 1 },
    ]);
    const locators = await library.handle.query<{ rel_path: string }>(
      "SELECT rel_path FROM files ORDER BY rel_path",
    );
    expect(locators.rows).toEqual([{ rel_path: "nested/renamed.bin" }]);
    const cacheRows = await library.handle.query<{ path: string; pinned: boolean }>(
      "SELECT path, pinned FROM cache_index",
    );
    expect(cacheRows.rows).toEqual([{ path: `emb/${firstId}.jpg`, pinned: true }]);
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
}, 30_000);

test("copy imports use the stable internal-library volume after the source disappears", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-copy-"));
  const drive = join(root, "drive");
  const source = join(drive, "frame.png");
  const library = await initializeLibrary(join(root, "library"));
  const cache = join(root, "cache");
  try {
    await mkdir(drive);
    await writeFile(source, png);
    const imported = await dispatch(
      {
        verb: "import",
        args: [source, "--copy"],
        cwd: process.cwd(),
        env: {
          noDaemon: true,
          cacheRoot: cache,
          volumeMap: `${drive}=source-volume:online`,
        },
      },
      { version: "test", library: library.handle },
    );
    const id = (imported as { data: { ids: string[] } }).data.ids[0];
    await rm(source);

    const listed = await dispatch(
      { verb: "list", args: [], cwd: process.cwd(), env: { noDaemon: true } },
      { version: "test", library: library.handle },
    );

    expect(imported).toMatchObject({
      ok: true,
      data: { volume: { uuid: "photoctl-library", mount: library.handle.path, online: true } },
    });
    expect(listed).toMatchObject({ ok: true, data: { rows: [{ id, online: true }] } });
  } finally {
    await library.handle.close();
    await rm(root, { recursive: true });
  }
});

test("copy reuse verifies a promoted full hash instead of trusting the sample", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-copy-collision-"));
  const sourceDirectory = join(root, "source");
  const libraryPath = join(root, "library");
  const destinationDirectory = join(libraryPath, "originals", "undated");
  const source = join(sourceDirectory, "frame.bin");
  const preferred = join(destinationDirectory, "frame.bin");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c999";
  const collision = join(destinationDirectory, "frame_5a91c999.bin");
  const first = Buffer.alloc(2 * 1024 * 1024 + 64, 2);
  const second = Buffer.from(first);
  second.fill(7, 1024 * 1024, 1024 * 1024 + 64);
  try {
    await mkdir(sourceDirectory);
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(source, second);
    await writeFile(preferred, first);
    await writeFile(collision, first);
    const identity = await identifyFile(source);

    await expect(
      copyIntoLibrary(
        source,
        libraryPath,
        null,
        id,
        identity.contentKey,
        await fullFileHash(source),
      ),
    ).rejects.toMatchObject({ code: "volume_readonly" });
  } finally {
    await rm(root, { recursive: true });
  }
});

test("daemon import forwards progress before its terminal envelope without retaining it", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-import-events-"));
  const source = join(root, "frame.png");
  const libraryPath = join(root, "library");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await writeFile(source, png);
    await initialized.handle.close();
    let settled = false;
    const events: ProgressEvent[] = [];
    const result = await execute(
      {
        verb: "import",
        args: [source, "--link"],
        cwd: root,
        env: {
          noDaemon: false,
          libraryPath,
          cacheRoot: join(root, "cache"),
          volumeMap: `${root}=event-volume:online`,
        },
      },
      {
        version: "0.1.0",
        emit: async (event) => {
          expect(settled).toBe(false);
          if (event.event === "progress") events.push(event);
        },
      },
    );
    settled = true;

    expect(result.envelope).toMatchObject({ ok: true, data: { imported: 1 } });
    expect(result.events).toEqual([
      expect.objectContaining({ event: "daemon", action: "spawned" }),
    ]);
    expect(events).toMatchObject([
      { event: "progress", phase: "scan", done: 1, total: 1 },
      { event: "progress", phase: "import", done: 1, total: 1 },
    ]);
    await execute(
      { verb: "daemon", args: ["stop"], cwd: root, env: { noDaemon: false, libraryPath } },
      { version: "0.1.0" },
    );
  } finally {
    await initialized.handle.close().catch(() => undefined);
    await rm(root, { recursive: true });
  }
}, 30_000);
