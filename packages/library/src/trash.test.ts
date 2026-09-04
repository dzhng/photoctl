import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DirTrash, stageFileRemoval } from "./trash.js";

test("trash and staged cache removals can roll back their filesystem effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-trash-"));
  const source = join(root, "photo.jpg");
  const cached = join(root, "cache", "preview.jpg");
  try {
    await mkdir(join(root, "cache"));
    await writeFile(source, "original");
    await writeFile(cached, "preview");
    const sourceReceipt = await new DirTrash(root).move(source);
    const cacheReceipt = await stageFileRemoval(cached);

    await sourceReceipt.rollback();
    await cacheReceipt.rollback();

    expect(await readFile(source, "utf8")).toBe("original");
    expect(await readFile(cached, "utf8")).toBe("preview");
  } finally {
    await rm(root, { recursive: true });
  }
});
