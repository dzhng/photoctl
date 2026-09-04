import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as nativeImage from "@photoctl/img";
import { exportImage, publishFile } from "./run.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("atomic publication moves complete bytes and cleans its sibling temporary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-atomic-"));
  directories.push(directory);
  const outputPath = join(directory, "linear.tif");
  const intended = Buffer.from("the complete canonical artifact");

  await publishFile(outputPath, intended);

  expect(await readFile(outputPath)).toEqual(intended);
  expect(await readdir(directory)).toEqual(["linear.tif"]);
});

test("atomic publication preserves an occupied destination and cleans its temporary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-occupied-"));
  directories.push(directory);
  const outputPath = join(directory, "delivery.bin");
  const occupied = Buffer.from("unrelated complete destination");
  await writeFile(outputPath, occupied);

  await expect(publishFile(outputPath, Buffer.from("requested bytes"))).rejects.toThrow();

  expect(await readFile(outputPath)).toEqual(occupied);
  expect(await readdir(directory)).toEqual(["delivery.bin"]);
});

test("unsupported atomic installation fails safely and cleans its temporary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-unsupported-"));
  directories.push(directory);
  const outputPath = join(directory, "delivery.bin");
  vi.spyOn(nativeImage, "atomicRenameNoReplace").mockReturnValue("unsupported");

  await expect(publishFile(outputPath, Buffer.from("requested bytes"))).rejects.toThrow(
    "Atomic no-replace publication is unsupported",
  );

  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(directory)).toEqual([]);
});

test("delivery export keeps explicit replacement separate from no-clobber publication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-replace-"));
  directories.push(directory);
  const outputPath = join(directory, "delivery.jpg");
  const request = (red: number, replace = false) => ({
    id: "photo-id",
    image: {
      w: 1,
      h: 1,
      channels: 3 as const,
      data: new Uint16Array([red, 0, 0]),
      space: "display-srgb" as const,
      orientationApplied: true as const,
    },
    outputPath,
    format: "jpeg" as const,
    quality: 88,
    metadata: {},
    replace,
  });

  await exportImage(request(65_535));
  const original = await readFile(outputPath);
  await expect(exportImage(request(0))).rejects.toMatchObject({ code: "volume_readonly" });
  expect(await readFile(outputPath)).toEqual(original);

  await exportImage(request(0, true));
  expect(await readFile(outputPath)).not.toEqual(original);
  expect(await readdir(directory)).toEqual(["delivery.jpg"]);
});
