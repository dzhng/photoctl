import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test.each(["0".repeat(64), undefined])(
  "remeasuring an image pinned as %s refuses without losing annotations",
  async (sha256) => {
    await withLibrary(async (directory) => {
      const image = join(directory, "a7c2.ARW");
      const manifest = join(directory, "a7c2.json");
      await symlink(resolve("fixtures/a7c2.ARW"), image);
      const authored = JSON.stringify({ ...fixture, sha256 });
      await writeFile(manifest, authored);
      const refused = spawnSync("python3", ["fixtures/tools/manifest.py", image], {
        encoding: "utf8",
      });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("review and remove the old manifest before regenerating");
      expect(await readFile(manifest, "utf8")).toBe(authored);

      await rm(manifest);
      execFileSync("python3", ["fixtures/tools/manifest.py", image]);
      const measured = JSON.parse(await readFile(manifest, "utf8"));
      expect(measured.sha256).toBe(fixture.sha256);
      expect(measured.sam_probes).toBeUndefined();
    });
  },
);
