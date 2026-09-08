import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function root(files: Record<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-check-links-"));
  temporaryDirectories.push(directory);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  return directory;
}

async function check(directory: string): Promise<{ code: number | null; output: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/check-links.mjs", directory], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

test("a relative markdown link to a missing file fails the check and names the file and target", async () => {
  const directory = await root({
    "docs/a.md": [
      "[ok](b.md) [anchored](b.md#section) [web](https://example.com) [self](#top)",
      "[gone](./missing.md)",
    ].join("\n"),
    "docs/b.md": "# b",
  });

  const result = await check(directory);

  expect(result.code).toBe(1);
  expect(result.output).toContain("docs/a.md");
  expect(result.output).toContain("./missing.md");
  expect(result.output).not.toContain("b.md#section");
});

test("closed specs, dependencies and build output are never checked", async () => {
  const directory = await root({
    "README.md": "[record](specs/done/feature/README.md)",
    "specs/done/feature/README.md":
      "[stale](../../gone.md) [absolute](/Users/nobody/repo/file.ts:1)",
    "node_modules/dep/README.md": "[broken](nowhere.md)",
    "packages/foo/dist/README.md": "[broken](nowhere.md)",
    "crates/lib/vendor/README.md": "[broken](nowhere.md)",
  });

  const result = await check(directory);

  expect(result.code, result.output).toBe(0);
});

test("a clean tree reports the number of links it verified", async () => {
  const directory = await root({ "README.md": "[a](a.md)", "a.md": "[back](README.md)" });

  const result = await check(directory);

  expect(result.code).toBe(0);
  expect(result.output).toMatch(/2 links/);
});
