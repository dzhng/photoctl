import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { scanCandidates } from "./scan.js";

test("recursive scanning is deterministic and does not extension-gate candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-scan-"));
  try {
    await mkdir(join(root, "b"));
    await writeFile(join(root, "unknown.payload"), "image bytes");
    await writeFile(join(root, "b", "z.JPG"), "image bytes");
    await writeFile(join(root, "b", "z.xmp"), "sidecar");
    await symlink(join(root, "unknown.payload"), join(root, "b", "nested-link"));
    const explicitLink = join(root, "explicit-link");
    await symlink(join(root, "unknown.payload"), explicitLink);

    expect(await scanCandidates(root)).toEqual([join(root, "unknown.payload")]);
    expect(await scanCandidates(root, true)).toEqual([
      join(root, "b", "z.JPG"),
      join(root, "unknown.payload"),
    ]);
    expect(await scanCandidates(explicitLink)).toEqual([explicitLink]);
  } finally {
    await rm(root, { recursive: true });
  }
});
