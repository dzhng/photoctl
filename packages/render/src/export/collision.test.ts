import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveExportCollision } from "./collision.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("rename chooses the first unused numbered sibling without replacing existing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-collision-"));
  directories.push(directory);
  await writeFile(join(directory, "photo.jpg"), "first");
  await writeFile(join(directory, "photo_2.jpg"), "second");

  await expect(resolveExportCollision(join(directory, "photo.jpg"), "rename")).resolves.toEqual({
    action: "write",
    path: join(directory, "photo_3.jpg"),
  });
});

test("skip and overwrite preserve the requested path while a directory is never treated as a file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-collision-policy-"));
  directories.push(directory);
  const path = join(directory, "photo.jpg");
  await writeFile(path, "first");

  await expect(resolveExportCollision(path, "skip")).resolves.toEqual({ action: "skip", path });
  await expect(resolveExportCollision(path, "overwrite")).resolves.toEqual({
    action: "write",
    path,
  });
  await mkdir(join(directory, "blocked.jpg"));
  await expect(resolveExportCollision(join(directory, "blocked.jpg"), "overwrite")).rejects.toThrow(
    /not a regular file/u,
  );
});
