import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect, test } from "vitest";

test("release publishes public native dependencies before making the CLI installable", () => {
  const root = mkdtempSync(join(tmpdir(), "openphoto-publish-test-"));
  try {
    mkdirSync(join(root, "packages/img-darwin-arm64"), { recursive: true });
    mkdirSync(join(root, "packages/img-private"), { recursive: true });
    mkdirSync(join(root, "out/packages"), { recursive: true });
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }));
    writeFileSync(
      join(root, "packages/img-darwin-arm64/package.json"),
      JSON.stringify({ name: "@dzhng/openphoto-img-darwin-arm64" }),
    );
    writeFileSync(
      join(root, "packages/img-private/package.json"),
      JSON.stringify({ name: "@dzhng/openphoto-img-private", private: true }),
    );
    for (const name of [
      "dzhng-openphoto-img-darwin-arm64-1.2.3.tgz",
      "dzhng-openphoto-1.2.3.tgz",
    ]) {
      writeFileSync(join(root, "out/packages", name), "fixture");
    }
    const calls = join(root, "calls.jsonl");
    writeFileSync(
      join(root, "bin/npm"),
      `#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.PUBLISH_CALLS, JSON.stringify(process.argv.slice(2))+'\\n');\n`,
      { mode: 0o755 },
    );
    execFileSync(process.execPath, [resolve("scripts/publish-npm.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        PUBLISH_CALLS: calls,
      },
    });
    const argumentsByCall = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(argumentsByCall.map((args) => basename(args[1]))).toEqual([
      "dzhng-openphoto-img-darwin-arm64-1.2.3.tgz",
      "dzhng-openphoto-1.2.3.tgz",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
