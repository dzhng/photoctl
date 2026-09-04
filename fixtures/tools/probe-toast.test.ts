import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the TOAST probe records the tested workload and a write-strategy verdict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-toast-test-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "G5-halfvec.txt");

  const result = await runNode([
    "scripts/probe-toast.mjs",
    "--rows",
    "3",
    "--cycles",
    "2",
    "--evidence",
    evidence,
  ]);

  expect(result.code).toBe(0);
  const output = JSON.parse(result.stdout) as {
    status: string;
    rows: number;
    cycles: number;
    writeStrategy: string;
    verifiedRows: number;
  };
  expect(output).toMatchObject({
    status: "not_reproduced",
    rows: 3,
    cycles: 2,
    writeStrategy: "upsert",
    verifiedRows: 3,
  });
  const recorded = await readFile(evidence, "utf8");
  expect(recorded).toContain("status=not_reproduced\n");
  expect(recorded).toContain("rows=3\n");
  expect(recorded).toContain("cycles=2\n");
  expect(recorded).toContain("write_strategy=upsert\n");
  expect(recorded).toContain("verified_rows=3\n");
});

test("an unexpected database failure invalidates stale PASS evidence before exiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-toast-failure-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "G5-halfvec.txt");
  await writeFile(evidence, "PASS (TOAST not reproduced)\nwrite_strategy=upsert\n");

  const result = await runNode([
    "scripts/probe-toast.mjs",
    "--rows",
    "2147483648",
    "--cycles",
    "2",
    "--evidence",
    evidence,
  ]);

  expect(result.code).not.toBe(0);
  const recorded = await readFile(evidence, "utf8");
  expect(recorded).toContain("FAIL (probe unsettled)\n");
  expect(recorded).toContain("status=unsettled\n");
  expect(recorded).toContain("write_strategy=unsettled\n");
  expect(recorded).not.toContain("PASS");
});

function runNode(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
