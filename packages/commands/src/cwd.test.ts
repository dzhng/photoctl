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
      ok: false,
      code: "unsupported_file",
      data: { path: sourcePath },
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});
