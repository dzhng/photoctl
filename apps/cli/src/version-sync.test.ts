import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
test("version check rejects drift; sync repairs package pins and the Swift release version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-version-"));
  try {
    await Promise.all([
      mkdir(join(directory, "apps")),
      mkdir(join(directory, "packages/img"), { recursive: true }),
      mkdir(join(directory, "helpers/mac/Sources/photoctl-mac"), { recursive: true }),
    ]);
    await writeFile(join(directory, "package.json"), JSON.stringify({ version: "9.8.7" }));
    await writeFile(
      join(directory, "packages/img/package.json"),
      JSON.stringify({
        name: "@photoctl/img",
        version: "0.1.0",
        optionalDependencies: { "@dzhng/openphoto-img-darwin-arm64": "0.1.0" },
      }),
    );
    const script = resolve("scripts/sync-versions.mjs");
    await expect(execute("node", [script, "--check"], { cwd: directory })).rejects.toMatchObject({
      code: 1,
    });
    await execute("node", [script], { cwd: directory });
    await execute("node", [script, "--check"], { cwd: directory });
    expect(
      JSON.parse(await readFile(join(directory, "packages/img/package.json"), "utf8")),
    ).toMatchObject({
      version: "9.8.7",
      optionalDependencies: { "@dzhng/openphoto-img-darwin-arm64": "9.8.7" },
    });
    expect(
      await readFile(
        join(directory, "helpers/mac/Sources/photoctl-mac/ReleaseVersion.swift"),
        "utf8",
      ),
    ).toContain('"9.8.7"');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("every packaged version agrees with the root release", async () => {
  await execute("node", ["scripts/sync-versions.mjs", "--check"]);
});
