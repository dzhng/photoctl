import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { materializePreview, viewHash } from "./preview.js";
import { PreviewCoordinator, type PreviewIndexAdapter } from "./preview-coordinator.js";
import { srgb2014ProfilePath } from "./color.js";
import { developFrame } from "./graph/frame.js";
import type { SourceTreatment } from "@photoctl/protocol";

test("preview reuse requires the online decoder treatment and retains actual treatment offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-treatment-"));
  const treatment: SourceTreatment = {
    decoderId: "libraw",
    decoderVersion: "fixture",
    requested: "reconstruct",
    status: "applied",
    method: "spatial-v1",
    scale: 1,
  };
  const photo = { w: 2, h: 1, orientation: 1 as const };
  const image = {
    w: 2,
    h: 1,
    channels: 3 as const,
    data: new Uint16Array([65535, 0, 0, 65535, 0, 0]),
  };
  const request = {
    coordinator: new PreviewCoordinator(),
    index: { recordCompleted: async () => {}, touch: async () => {} },
    cacheRoot: directory,
    photoId: "treatment",
    renderHash: testRenderHash("9"),
    photo,
    source: {
      kind: "online-file" as const,
      path: join(directory, "absent.raw"),
      mediaType: "image/x-sony-arw",
      w: 2,
      h: 1,
    },
    view: { region: null, longEdge: "native" as const },
  };
  try {
    const first = await materializePreview({
      ...request,
      render: async () => ({
        image,
        frame: developFrame(photo, image),
        sourceTreatment: treatment,
      }),
    });
    const changed = { ...treatment, decoderVersion: "next" };
    const second = await materializePreview({
      ...request,
      requiredTreatment: changed,
      render: async () => ({ image, frame: developFrame(photo, image), sourceTreatment: changed }),
    });
    expect(second.sourceTreatment).toEqual(changed);
    expect(first.sourceTreatment).toEqual(treatment);
    const offline = await materializePreview({
      ...request,
      source: {
        kind: "pinned-preview",
        path: request.source.path,
        mediaType: "image/jpeg",
        orientation: 1,
      },
      render: async () => {
        throw new Error("No offline decoder");
      },
    });
    expect(offline.sourceTreatment).toEqual(changed);
    expect(offline.cacheSource).toBe("exact_view");
    const unknown = await materializePreview({
      ...request,
      renderHash: testRenderHash("a"),
      requiredTreatment: changed,
      render: async () => ({ image, frame: developFrame(photo, image) }),
    });
    expect(unknown.sourceTreatment).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function testRenderHash(hex: string): `r_${string}` {
  return `r_${hex.repeat(64)}`;
}

test("view hashes are stable canonical identities", () => {
  expect(viewHash({ region: null, longEdge: 1616 })).toBe(
    `v_${createHash("sha256")
      .update('{"kind":"view","long_edge":1616,"recipe_version":3,"region":null}')
      .digest("hex")}`,
  );
  expect(viewHash({ region: [1, 2, 3, 4], longEdge: "native" })).not.toBe(
    viewHash({ region: [1, 2, 3, 4], longEdge: 4 }),
  );
});

test("a native master at the best declared reduced tier serves detail without decoding again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-reduced-master-"));
  const sourcePath = join(directory, "source.png");
  try {
    await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } })
      .png()
      .toFile(sourcePath);
    const request = {
      coordinator: new PreviewCoordinator(),
      index: { recordCompleted: async () => {}, touch: async () => {} },
      cacheRoot: directory,
      photoId: "reduced-source",
      renderHash: testRenderHash("7"),
      photo: { w: 40, h: 20, orientation: 1 as const },
      source: {
        kind: "online-file" as const,
        path: sourcePath,
        mediaType: "image/png",
        w: 20,
        h: 10,
      },
    };
    await materializePreview({ ...request, view: { region: null, longEdge: "native" } });
    await rm(sourcePath);
    const detail = await materializePreview({
      ...request,
      view: { region: [0, 0, 20, 20], longEdge: "native" },
    });
    expect(detail).toMatchObject({
      w: 10,
      h: 10,
      cacheSource: "sufficient_full_frame",
      resolutionLimited: true,
    });
    expect((await sharp(detail.path).stats()).channels[0].mean).toBeGreaterThan(240);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test.each([20, 4])(
  "offline pinned fallback retains or improves a %i-pixel master",
  async (width) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-pinned-density-"));
    const sourcePath = join(directory, "source.png");
    const pinnedPath = join(directory, "pinned.png");
    try {
      await sharp({ create: { width, height: width / 2, channels: 3, background: "red" } })
        .png()
        .toFile(sourcePath);
      await sharp({ create: { width: 10, height: 5, channels: 3, background: "blue" } })
        .png()
        .toFile(pinnedPath);
      const request = {
        coordinator: new PreviewCoordinator(),
        index: { recordCompleted: async () => {}, touch: async () => {} },
        cacheRoot: directory,
        photoId: "offline-density",
        renderHash: testRenderHash("8"),
        photo: { w: 40, h: 20, orientation: 1 as const },
        source: {
          kind: "online-file" as const,
          path: sourcePath,
          mediaType: "image/png",
          w: width,
          h: width / 2,
        },
      };
      const view = { region: null, longEdge: "native" as const };
      const master = await materializePreview({ ...request, view });
      const masterBytes = await readFile(master.path);
      const detailView = {
        region: [0, 0, 20, 20] as [number, number, number, number],
        longEdge: "native" as const,
      };
      await materializePreview({ ...request, view: detailView });
      await rm(sourcePath);
      const offline = {
        ...request,
        source: {
          kind: "pinned-preview" as const,
          path: pinnedPath,
          mediaType: "image/png",
          orientation: 1 as const,
        },
      };
      const native = await materializePreview({ ...offline, view });
      const best = Math.max(width, 10);
      expect(native).toMatchObject({ w: best, h: best / 2 });
      expect((await sharp(native.path).stats()).channels[width > 10 ? 0 : 2].mean).toBeGreaterThan(
        240,
      );
      if (width > 10) expect(await readFile(native.path)).toEqual(masterBytes);
      const exact = await materializePreview({ ...offline, view: detailView });
      expect(exact).toMatchObject({ w: best / 2, h: best / 2 });
      await rm(pinnedPath);
      const warmed = await materializePreview({ ...offline, view });
      expect(warmed).toMatchObject({ w: best, h: best / 2, cacheSource: "exact_view" });
      const detail = await materializePreview({
        ...offline,
        view: { ...detailView, region: [20, 0, 20, 20] },
      });
      expect(detail).toMatchObject({
        w: best / 2,
        h: best / 2,
        cacheSource: "sufficient_full_frame",
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test("native full-frame creates a master and later regions reuse it without the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-master-"));
  const sourcePath = join(directory, "source.png");
  const photo = { contentKey: "ck_1111111111111111", orientation: 1 as const, w: 80, h: 60 };
  const renderHash = testRenderHash("1");
  const index: PreviewIndexAdapter = {
    recordCompleted: async () => {},
    touch: async () => {},
  };
  const coordinator = new PreviewCoordinator();
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
      coordinator,
      index,
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
      coordinator,
      index,
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
      coordinator,
      index,
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

test("default overview derives from a sufficient master without rendering again", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-overview-master-"));
  const photo = { contentKey: "ck_1111111111111112", orientation: 1 as const, w: 2000, h: 1000 };
  const renderHash = testRenderHash("3");
  const index: PreviewIndexAdapter = {
    recordCompleted: async () => {},
    touch: async () => {},
  };
  const coordinator = new PreviewCoordinator();
  let renderCount = 0;
  const pixels = new Uint16Array(photo.w * photo.h * 3).fill(32768);
  const base = {
    coordinator,
    index,
    cacheRoot: directory,
    photoId: "photo-overview-master",
    renderHash,
    photo,
    source: { kind: "online-file" as const, path: "unused", mediaType: "image/png" },
    render: async () => {
      renderCount += 1;
      return {
        image: { w: photo.w, h: photo.h, channels: 3 as const, data: pixels },
        frame: developFrame(photo, photo),
      };
    },
  };
  try {
    const master = await materializePreview({
      ...base,
      view: { region: null, longEdge: "native" },
    });
    const overview = await materializePreview({
      ...base,
      view: { region: null, longEdge: 1616 },
    });
    const detail = await materializePreview({
      ...base,
      view: { region: [200, 100, 400, 300], longEdge: "native" },
    });

    expect(renderCount).toBe(1);
    expect(overview).toMatchObject({
      w: 1616,
      h: 808,
      sourceDimensions: { w: 2000, h: 1000 },
      cacheSource: "sufficient_full_frame",
    });
    expect(detail).toMatchObject({ w: 400, h: 300, cacheSource: "sufficient_full_frame" });
    expect(overview.path).not.toBe(master.path);
    expect(detail.path).not.toBe(master.path);
    expect(detail.path).not.toBe(overview.path);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("default overview ignores a corrupt master and renders directly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-corrupt-master-"));
  const photo = { contentKey: "ck_1111111111111113", orientation: 1 as const, w: 80, h: 60 };
  const renderHash = testRenderHash("4");
  let renderCount = 0;
  const base = {
    coordinator: new PreviewCoordinator(),
    index: { recordCompleted: async () => {}, touch: async () => {} },
    cacheRoot: directory,
    photoId: "photo-corrupt-master",
    renderHash,
    photo,
    source: { kind: "online-file" as const, path: "unused", mediaType: "image/png" },
    render: async () => {
      renderCount += 1;
      return {
        frame: developFrame(photo, photo),
        image: {
          w: photo.w,
          h: photo.h,
          channels: 3 as const,
          data: new Uint16Array(photo.w * photo.h * 3).fill(32768),
        },
      };
    },
  };
  try {
    const master = await materializePreview({
      ...base,
      view: { region: null, longEdge: "native" },
    });
    await writeFile(master.path, "corrupt");
    const overview = await materializePreview({
      ...base,
      view: { region: null, longEdge: 1616 },
    });
    expect(renderCount).toBe(2);
    expect(overview).toMatchObject({ w: 80, h: 60, cacheSource: "render_master" });
    await expect(sharp(overview.path).metadata()).resolves.toMatchObject({ width: 80, height: 60 });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("overview, native, and overlapping regions share one full-frame master artifact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-preview-wave-"));
  const photo = { contentKey: "ck_2222222222222222", orientation: 1 as const, w: 80, h: 60 };
  const renderHash = testRenderHash("2");
  const records: string[] = [];
  const index: PreviewIndexAdapter = {
    recordCompleted: async (artifact) => {
      records.push(artifact.path);
    },
    touch: async () => {},
  };
  const coordinator = new PreviewCoordinator();
  const sourcePath = join(directory, "source.png");
  const base = {
    coordinator,
    index,
    cacheRoot: directory,
    photoId: "photo-wave",
    renderHash,
    photo,
    source: {
      kind: "online-file" as const,
      path: sourcePath,
      mediaType: "image/png",
      orientation: 1 as const,
    },
  };
  try {
    await sharp({ create: { width: 80, height: 60, channels: 3, background: "white" } }).toFile(
      sourcePath,
    );
    await materializePreview({ ...base, view: { region: null, longEdge: 1616 } });
    const [native, left, overlap] = await Promise.all([
      materializePreview({ ...base, view: { region: null, longEdge: "native" } }),
      materializePreview({ ...base, view: { region: [0, 0, 30, 30], longEdge: "native" } }),
      materializePreview({ ...base, view: { region: [20, 10, 30, 30], longEdge: "native" } }),
    ]);

    expect(native.path).toMatch(/master\.jpg$/);
    expect(left.path).not.toBe(overlap.path);
    expect(new Set(records).size).toBe(4);
    expect(records).toHaveLength(4);
    expect(records.filter((path) => path.endsWith("master.jpg"))).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true });
  }
});
