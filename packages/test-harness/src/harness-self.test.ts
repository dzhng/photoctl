import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { expect, test } from "vitest";
test("the functional runner fails when it discovers zero tests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "photoctl-empty-tests-"));
  const config = join(dir, "vitest.config.mjs");
  await writeFile(config, "export default { test: { include: ['nothing/**/*.test.ts'] } }\n");
  const code = await new Promise<number>((resolve) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "--config", config],
      { stdio: "ignore" },
    );
    child.on("close", (value) => resolve(value ?? 1));
  });
  expect(code).not.toBe(0);
});
