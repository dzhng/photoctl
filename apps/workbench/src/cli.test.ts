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

test("race renders observed contention and retry wording from the latest probe", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "photoctl-workbench-race-"));
  temporaryDirectories.push(cwd);
  await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
    await mkdir(join(cwd, "out", "wb"), { recursive: true });
    await writeFile(
      join(cwd, "out", "wb", "race.json"),
      JSON.stringify({
        clients: 24,
        rowsPerClient: 25,
        expectedRows: 600,
        successfulWrites: 225,
        foundRows: 225,
        failures: { library_locked: 15 },
        clientsObserved: [{ client: 0, ok: 9, failed: 16, elapsedMs: 431 }],
      }),
    );
  });

  const output = await runWorkbench(["race"], cwd);
  const html = await readFile(output, "utf8");

  expect(output).toBe(join(cwd, "out", "wb", "race.html"));
  expect(html).toContain("225 / 225 accepted rows persisted");
  expect(html).toContain("Library busy — retry this command.");
  expect(html).toContain("library_locked");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/u);
});
