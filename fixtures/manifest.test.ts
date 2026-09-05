import { execFileSync } from "node:child_process";
import { copyFile, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { withLibrary } from "@photoctl/test-harness";
import fixture from "./a7c2.json";

test("remeasuring the same image preserves independently authored segmentation probes", async () => {
  await withLibrary(async (directory) => {
    const image = join(directory, "a7c2.ARW");
    const manifest = join(directory, "a7c2.json");
    await symlink(resolve("fixtures/a7c2.ARW"), image);
    await copyFile(resolve("fixtures/a7c2.json"), manifest);
    execFileSync("python3", ["fixtures/tools/manifest.py", image]);
    const measured = JSON.parse(await readFile(manifest, "utf8"));
    expect(measured.sha256).toBe(fixture.sha256);
    expect(measured.sam_probes).toEqual(fixture.sam_probes);
  });
});

test("remeasuring different image bytes drops stale subject annotations", async () => {
  await withLibrary(async (directory) => {
    const image = join(directory, "a7c2.ARW");
    const manifest = join(directory, "a7c2.json");
    await symlink(resolve("fixtures/a7c2.ARW"), image);
    await writeFile(manifest, JSON.stringify({ ...fixture, sha256: "0".repeat(64) }));
    execFileSync("python3", ["fixtures/tools/manifest.py", image]);
    const measured = JSON.parse(await readFile(manifest, "utf8"));
    expect(measured.sha256).toBe(fixture.sha256);
    expect(measured.sam_probes).toBeUndefined();
  });
});
