import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const helper = join(directory, "photoctl-mac");
  try {
    await writeFile(helper, "#!/bin/sh\necho 'photoctl-mac 9.1'\n");
    await chmod(helper, 0o755);
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "doctor",
        args: [],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot: "relative-cache",
          macHelperPath: helper,
        },
      },
      { version: "test" },
    );

    expect(result).toMatchObject({ schema: 1, ok: true });
    if (!result.ok || !("data" in result)) throw new Error("Expected a successful doctor result");
    const data = result.data as {
      library_id: string;
      cache: { root: string };
      native_image: { available: boolean; package: string; required: boolean };
      decoders: unknown[];
    };
    expect(data.cache.root).toBe(join(directory, "relative-cache", data.library_id));
    expect(data.native_image).toEqual({
      available: true,
      package: `@photoctl/img-${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`,
      required: true,
    });
    expect(data.decoders).toContainEqual({
      id: "ciraw",
      available: true,
      version: "9.1",
      requires_window_server: null,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});
