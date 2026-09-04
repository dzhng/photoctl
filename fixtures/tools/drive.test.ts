import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);

test("the drive fixture creates padded RAW copies with Classic sidecars", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-drive-fixture-"));
  try {
    await execFileAsync(process.execPath, [
      resolve("fixtures/tools/drive.mjs"),
      "--count",
      "1",
      "--out",
      root,
    ]);

    const sourceSize = (await stat(resolve("fixtures/a7c2.ARW"))).size;
    expect((await stat(join(root, "DSC00001.ARW"))).size).toBeGreaterThan(sourceSize);
    expect(await readFile(join(root, "DSC00001.xmp"), "utf8")).toContain("lr:hierarchicalSubject");
  } finally {
    await rm(root, { recursive: true });
  }
}, 20_000);
