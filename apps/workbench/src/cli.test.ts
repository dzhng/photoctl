import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runWorkbench } from "./run.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("envelope writes a self-contained report of success, failure, and partial outcomes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-"));
  temporaryDirectories.push(cwd);

  const output = await runWorkbench(["envelope"], cwd);
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "envelope.html"));
  expect(html).toContain("Successful show");
  expect(html).toContain("Library locked");
  expect(html).toContain("Partial export");
  expect(html).toContain("Exit 0");
  expect(html).toContain("Exit 75");
  expect(html).toContain("Exit 65");
  expect(html).toContain("&quot;code&quot;: &quot;library_locked&quot;");
  expect(html).toContain("&quot;code&quot;: &quot;partial&quot;");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});
