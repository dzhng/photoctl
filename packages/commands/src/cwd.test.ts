import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test("relative command paths resolve from the request working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-request-cwd-"));
  const libraryPath = join(directory, "library");
  const sourcePath = join(directory, "broken.arw");
  try {
    await writeFile(sourcePath, "not a TIFF\n");
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "import",
        args: ["broken.arw", "--link"],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          volumeMap: `${directory}=fixture-volume:online`,
        },
      },
      { version: "test" },
    );

    expect(result).toMatchObject({
      schema: 1,
      ok: true,
      data: { imported: 0, skipped_unsupported: 1, ids: [] },
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("doctor resolves a relative cache root from the request working directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-doctor-cwd-"));
  const libraryPath = join(directory, "library");
  try {
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "doctor",
        args: [],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot: "relative-cache" },
      },
      { version: "test" },
    );

    expect(result).toMatchObject({ schema: 1, ok: true });
    if (!result.ok || !("data" in result)) throw new Error("Expected a successful doctor result");
    const data = result.data as { library_id: string; cache: { root: string } };
    expect(data.cache.root).toBe(join(directory, "relative-cache", data.library_id));
  } finally {
    await rm(directory, { recursive: true });
  }
});
