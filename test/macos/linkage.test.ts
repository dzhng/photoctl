import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
test("linkage audit accepts a dylib's own build ID but rejects an external build dependency", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-linkage-"));
  const source = join(directory, "source.c");
  const dependency = join(directory, "libfixture.dylib");
  const consumer = join(directory, "consumer.dylib");
  const audit = resolve("scripts/audit-linkage.mjs");
  try {
    await writeFile(source, "int fixture(void) { return 1; }\n");
    await execute("clang", ["-dynamiclib", source, "-o", dependency]);
    await execute("node", [audit, dependency]);
    await writeFile(source, "extern int fixture(void); int consumer(void) { return fixture(); }\n");
    await execute("clang", ["-dynamiclib", source, dependency, "-o", consumer]);
    await expect(execute("node", [audit, consumer])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(dependency),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
