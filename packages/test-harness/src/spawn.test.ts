import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "./spawn.js";

test("the CLI driver invokes a selected installed executable from an independent cwd", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-driver-"));
  const cliPath = join(directory, "cli.mjs");
  try {
    await writeFile(
      cliPath,
      "console.log(JSON.stringify({schema:1,ok:true,data:{cwd:process.cwd(),args:process.argv.slice(2)},warnings:[]}));",
    );
    const result = await spawnPhotoctl(["probe-installed"], { cliPath, cwd: directory });
    expect(result).toMatchObject({
      code: 0,
      json: {
        ok: true,
        data: { cwd: await realpath(directory), args: ["probe-installed"] },
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
