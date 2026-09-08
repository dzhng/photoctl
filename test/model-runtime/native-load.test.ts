import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("loading the native image API never writes unstructured diagnostics", () => {
  const loaded = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const { inspectNativeImageRuntime } = await import('@photoctl/img'); if (!inspectNativeImageRuntime().available) process.exit(1)",
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(loaded.stderr).toBe("");
  expect(loaded.status).toBe(0);
});

test("the packed platform addon loads quietly outside the checkout", () => {
  const scratch = mkdtempSync(join(tmpdir(), "photoctl-native-package-"));
  const platform = `${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}`;
  try {
    const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", scratch], {
      cwd: resolve(`packages/img-${platform}`),
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(packed.status, packed.stderr).toBe(0);
    const [{ filename }] = JSON.parse(packed.stdout) as { filename: string }[];
    const installed = spawnSync(
      "npm",
      [
        "install",
        "--offline",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        join(scratch, filename),
      ],
      { cwd: scratch, encoding: "utf8", timeout: 20_000 },
    );
    expect(installed.status, installed.stderr).toBe(0);
    const env = { ...process.env };
    delete env.NODE_PATH;
    const loaded = spawnSync(
      process.execPath,
      [
        "-e",
        `const name = '@dzhng/openphoto-img-${platform}'; const addon = require(name); process.stdout.write(JSON.stringify({version: addon.librawVersion(), path: require.resolve(name)}))`,
      ],
      { cwd: scratch, env, encoding: "utf8", timeout: 10_000 },
    );
    expect(loaded.stderr).toBe("");
    expect(loaded.status).toBe(0);
    const runtime = JSON.parse(loaded.stdout) as { version: string; path: string };
    expect(runtime.version).toMatch(/^\d+\.\d+\.\d+/u);
    if (process.platform === "darwin") {
      const policy = spawnSync(
        "python3",
        [
          "-c",
          "import os, tomllib; print(os.environ.get('MACOSX_DEPLOYMENT_TARGET') or tomllib.load(open('.cargo/config.toml', 'rb'))['env']['MACOSX_DEPLOYMENT_TARGET'])",
        ],
        { encoding: "utf8" },
      );
      expect(policy.status, policy.stderr).toBe(0);
      const linkage = spawnSync("otool", ["-l", runtime.path], { encoding: "utf8" });
      expect(linkage.status, linkage.stderr).toBe(0);
      const actual = /\bminos ([\d.]+)/u.exec(linkage.stdout)?.[1];
      expect(actual, "the packaged addon declares its minimum macOS version").toBeTruthy();
      const required = actual!.split(".").map(Number);
      const supported = policy.stdout.trim().split(".").map(Number);
      const difference =
        [0, 1, 2]
          .map((index) => (required[index] ?? 0) - (supported[index] ?? 0))
          .find((part) => part !== 0) ?? 0;
      expect(
        difference,
        `packaged macOS minimum ${actual}, policy ${policy.stdout.trim()}`,
      ).toBeLessThanOrEqual(0);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
