import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const { linkFile } = vi.hoisted(() => ({ linkFile: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  link: linkFile,
}));

import { exportImage } from "./run.js";

const directories: string[] = [];

afterEach(async () => {
  linkFile.mockReset();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("unsupported hard links fall back to exclusive publication without clobbering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-link-fallback-"));
  directories.push(directory);
  const outputPath = join(directory, "delivery.jpg");
  linkFile.mockRejectedValue(Object.assign(new Error("links unsupported"), { code: "ENOTSUP" }));
  const request = (red: number) => ({
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
  });

  await exportImage(request(65_535));
  const original = await readFile(outputPath);
  await expect(exportImage(request(0))).rejects.toMatchObject({ code: "volume_readonly" });

  expect(await readFile(outputPath)).toEqual(original);
  expect(await readdir(directory)).toEqual(["delivery.jpg"]);
  expect(linkFile).toHaveBeenCalledTimes(2);
});
