import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { materializePreview, renderStateHash, viewHash } from "./preview.js";
import { srgb2014ProfilePath } from "./color.js";

test("render and view hashes are stable canonical identities", () => {
  expect(renderStateHash({ contentKey: "ck_one", orientation: 1 })).toBe(
    renderStateHash({ contentKey: "ck_one", orientation: 1 }),
  );
  expect(viewHash({ region: [1, 2, 3, 4], longEdge: "native" })).not.toBe(
    viewHash({ region: [1, 2, 3, 4], longEdge: 4 }),
  );
});

test("native full-frame creates a master and later regions reuse it without the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-master-"));
  const sourcePath = join(directory, "source.png");
  const photo = { contentKey: "ck_one", orientation: 1 as const, w: 80, h: 60 };
  const renderHash = renderStateHash(photo);
  const source = {
    kind: "online-file" as const,
    path: sourcePath,
    mediaType: "image/png",
    w: 80,
    h: 60,
  };
  try {
    await sharp({ create: { width: 80, height: 60, channels: 3, background: "red" } })
      .png()
      .toFile(sourcePath);

    const overview = await materializePreview({
      cacheRoot: directory,
      photoId: "photo-one",
      renderHash,
      photo,
      source,
      view: { region: null, longEdge: 1616 },
    });
    const masterPath = join(directory, "view", "photo-one", renderHash, "master.jpg");
    await expect(access(masterPath)).rejects.toThrow();
    expect(overview.cacheSource).toBe("render_master");
    const overviewStats = await sharp(overview.path).stats();
    expect(overviewStats.channels[0].mean).toBeGreaterThan(240);
    expect(overviewStats.channels[1].mean).toBeLessThan(10);
    expect(overviewStats.channels[2].mean).toBeLessThan(10);
    const overviewMetadata = await sharp(overview.path).metadata();
    expect(overviewMetadata.hasProfile).toBe(true);
    expect(overviewMetadata.icc).toEqual(await readFile(srgb2014ProfilePath));

    const native = await materializePreview({
      cacheRoot: directory,
      photoId: "photo-one",
      renderHash,
      photo,
      source,
      view: { region: null, longEdge: "native" },
    });
    expect(native.path).toBe(masterPath);
    expect(native.cacheSource).toBe("render_master");

    await rm(sourcePath);
    const region = await materializePreview({
      cacheRoot: directory,
      photoId: "photo-one",
      renderHash,
      photo,
      source,
      view: { region: [10, 10, 20, 15], longEdge: "native" },
    });
    expect(region).toMatchObject({
      w: 20,
      h: 15,
      sourceDimensions: { w: 80, h: 60 },
      pixelScale: 1,
      resolutionLimited: false,
      cacheSource: "sufficient_full_frame",
    });
    await expect(sharp(region.path).metadata()).resolves.toMatchObject({ width: 20, height: 15 });
  } finally {
    await rm(directory, { recursive: true });
  }
});
