import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary, openLibrary } from "@photoctl/library";
import type { CommandRequest } from "@photoctl/protocol";
import { dispatch } from "./dispatch.js";

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
