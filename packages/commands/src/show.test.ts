import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { showDataSchema, type StderrEvent } from "@photoctl/protocol";
import { PreviewCoordinator, srgb2014ProfilePath } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

test("unedited default show uses the pinned overview without publishing full graph artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-cheap-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const source = join(directory, "photo.png");
  const initialized = await initializeLibrary(libraryPath);
  const env = {
    noDaemon: true,
    libraryPath,
    cacheRoot,
    volumeMap: `${directory}=fixture-volume:online`,
  };
  try {
    await sharp({ create: { width: 64, height: 48, channels: 3, background: "red" } })
      .png()
      .toFile(source);
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0]!;
    const shown = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(shown.ok).toBe(true);
    if (!shown.ok || !("data" in shown)) throw new Error("show failed");
    const data = showDataSchema.parse(shown.data);
    expect(data.preview_info).toMatchObject({
      source_tier: "pinned-preview",
      actual: { w: 64, h: 48 },
    });
    expect((await sharp(data.preview).stats()).channels[0]!.mean).toBeGreaterThan(240);
    expect(
      (await initialized.handle.query("SELECT count(*)::text AS count FROM node_executions")).rows,
    ).toEqual([{ count: "0" }]);
    await writeFile(
      join(cacheRoot, initialized.libraryId, "emb", `${id}.jpg`),
      "corrupt pinned JPEG",
    );
    await rm(data.preview);
    const recovered = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    expect(recovered.ok).toBe(true);
    if (!recovered.ok || !("data" in recovered)) throw new Error("show recovery failed");
    const restored = showDataSchema.parse(recovered.data);
    expect(restored.preview_info.source_tier).toBe("online-file");
    expect((await sharp(restored.preview).stats()).channels[0]!.mean).toBeGreaterThan(240);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test.each([
  {
    label: "reduced",
    sourceW: 31,
    sourceH: 23,
    w: 16,
    h: 15,
    detailRegion: [5, 2, 11, 9],
    expected: {
      a: -0.06680308846083141,
      b: 0.47532867299595377,
      c: -0.47997687005331213,
      d: -0.06745634995513376,
      e: 21.158361440517286,
      f: -5.676947178910977,
    },
  },
  {
    label: "full",
    sourceW: 63,
    sourceH: 47,
    w: 34,
    h: 33,
    detailRegion: [12, 4, 20, 19],
    expected: {
      a: -0.14102874230619966,
      b: 1.003471642991458,
      c: -0.9852156806357459,
      d: -0.13846303411843244,
      e: 44.13037323417792,
      f: -11.409124844599408,
    },
  },
])(
  "show preserves the exact $label frame through native and cached detail",
  async ({ sourceW, sourceH, w, h, detailRegion, expected }) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-show-reduced-frame-"));
    const libraryPath = join(directory, "library");
    const cacheRoot = join(directory, "cache");
    const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
    const initialized = await initializeLibrary(libraryPath);
    try {
      await initialized.handle.query(
        `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, 'ck_0000000000000001', 1, 63, 47, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
        [id],
      );
      const pinnedDirectory = join(cacheRoot, initialized.libraryId, "emb");
      await mkdir(pinnedDirectory, { recursive: true });
      const pixels = Buffer.alloc(sourceW * sourceH * 3);
      for (let y = 0; y < sourceH; y++)
        for (let x = 0; x < sourceW; x++) {
          pixels.set(
            [Math.round((x * 255) / (sourceW - 1)), Math.round((y * 255) / (sourceH - 1)), 75],
            (y * sourceW + x) * 3,
          );
          const baseX = ((x + 0.5) * 63) / sourceW;
          const baseY = ((y + 0.5) * 47) / sourceH;
          if (baseX >= 28 && baseX <= 38 && baseY >= 23 && baseY <= 33)
            pixels.set([30, 40, 245], (y * sourceW + x) * 3);
        }
      await sharp(pixels, { raw: { width: sourceW, height: sourceH, channels: 3 } })
        .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
        .toFile(join(pinnedDirectory, `${id}.jpg`));
      const env = { noDaemon: true, libraryPath, cacheRoot };
      const developed = await dispatch(
        {
          verb: "develop",
          args: [
            id,
            "--set",
            'crop={"x":12.25,"y":3.5,"w":37.5,"h":39.2}',
            "rotate=90",
            "straighten_deg=8",
          ],
          cwd: directory,
          env,
        },
        { version: "test", library: initialized.handle },
      );
      expect(developed.ok).toBe(true);
      const shown = await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: directory, env },
        { version: "test", library: initialized.handle },
      );
      expect(shown.ok).toBe(true);
      if (!shown.ok || !("data" in shown)) throw new Error("show failed");
      const data = showDataSchema.parse(shown.data);
      expect(data.preview_info.actual).toMatchObject({ w, h });
      // Independent affine arithmetic retains integer crop dimensions before straightening;
      // the reduced raster is not a scaled full-resolution crop.
      for (const coefficient of Object.keys(expected) as Array<keyof typeof expected>)
        expect(data.preview_info.base_to_view[coefficient]).toBeCloseTo(expected[coefficient], 10);
      expect(await sharp(data.preview).metadata()).toMatchObject({ width: w, height: h });
      const matrix = data.preview_info.base_to_view;
      const landmarkX = Math.floor(matrix.a * 33 + matrix.c * 28 + matrix.e);
      const landmarkY = Math.floor(matrix.b * 33 + matrix.d * 28 + matrix.f);
      const rendered = await sharp(data.preview).toColourspace("srgb").raw().toBuffer();
      const landmark = rendered.subarray(
        (landmarkY * w + landmarkX) * 3,
        (landmarkY * w + landmarkX) * 3 + 3,
      );
      expect(landmark[2]).toBeGreaterThan(landmark[0] + 50);
      expect(landmark[2]).toBeGreaterThan(landmark[1] + 50);
      await rm(join(pinnedDirectory, `${id}.jpg`));
      const cached = await dispatch(
        { verb: "show", args: [id, "--preview-size", "native"], cwd: directory, env },
        { version: "test", library: initialized.handle },
      );
      if (!cached.ok || !("data" in cached)) throw new Error(JSON.stringify(cached));
      const cachedData = showDataSchema.parse(cached.data);
      expect(cachedData.preview_info).toEqual({ ...data.preview_info, cache_source: "exact_view" });
      const detail = await dispatch(
        { verb: "show", args: [id, "--region", "20,10,15,17"], cwd: directory, env },
        { version: "test", library: initialized.handle },
      );
      if (!detail.ok || !("data" in detail)) throw new Error(JSON.stringify(detail));
      const detailData = showDataSchema.parse(detail.data);
      const [left, top, width, height] = detailRegion;
      expect(detailData.preview_info.actual).toMatchObject({ w: width, h: height });
      const expectedDetail = { ...expected, e: expected.e - left, f: expected.f - top };
      for (const coefficient of Object.keys(expectedDetail) as Array<keyof typeof expectedDetail>)
        expect(detailData.preview_info.base_to_view[coefficient]).toBeCloseTo(
          expectedDetail[coefficient],
          10,
        );
      expect(detailData.preview_info.source_dimensions).toEqual({ w, h });
      expect(detailData.preview_info.source_tier).toBe("pinned-preview");
      expect(detailData.preview_info.cache_source).toBe("sufficient_full_frame");
      const expectedJpeg = await sharp(data.preview)
        .extract({ left, top, width, height })
        .jpeg({ quality: 88 })
        .withIccProfile(srgb2014ProfilePath)
        .toBuffer();
      expect(await readFile(detailData.preview)).toEqual(expectedJpeg);
    } finally {
      await initialized.handle.close();
      await rm(directory, { recursive: true });
    }
  },
);

function imageMean(channels: Array<{ mean: number }>): number {
  return channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
}

test("show normalizes empty stored metadata to the public nullable shape", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-metadata-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  try {
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation, camera, exposure) AS (VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1, '{}'::jsonb, '{}'::jsonb)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation, camera, exposure) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer, camera::jsonb, exposure::jsonb FROM seed`,
      [id],
    );
    await writePinnedPreview(cacheRoot, initialized.libraryId, id);
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "show",
        args: [id],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      { version: "test" },
    );

    expect(result).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        camera: { make: null, model: null, lens: null },
        exposure: { shutter: null, f: null, iso: null, focal_mm: null, wb: null },
      },
      warnings: [{ code: "source_offline", id }],
    });
    const clipped = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "-1,0,2,1"],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      { version: "test" },
    );
    expect(clipped).toMatchObject({
      schema: 1,
      ok: true,
      data: { preview_info: { actual: { region: [0, 0, 1, 1], w: 1, h: 1 } } },
    });
    const outside = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "2,0,1,1"],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      { version: "test" },
    );
    expect(outside).toMatchObject({ schema: 1, ok: false, code: "usage" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("show warns when an online locator cannot provide the catalogued source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-offline-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const mount = join(directory, "card");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  try {
    await mkdir(join(mount, "DCIM"), { recursive: true });
    await writeFile(join(mount, "DCIM", "a7c2.ARW"), "changed source");
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
      [id],
    );
    await writePinnedPreview(cacheRoot, initialized.libraryId, id);
    await initialized.handle.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('fixture-volume', 'card', $1, now())`,
      [mount],
    );
    await initialized.handle.query(
      `INSERT INTO files (id, original_id, volume_uuid, rel_path, mtime)
       VALUES ('0199a7c2-3b1e-7c40-8f2a-1d0e5a91f001', $1, 'fixture-volume',
               'DCIM/a7c2.ARW', now())`,
      [id],
    );
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "show",
        args: [id],
        cwd: directory,
        env: {
          noDaemon: true,
          libraryPath,
          cacheRoot,
          volumeMap: `${mount}=fixture-volume:online`,
        },
      },
      { version: "test" },
    );

    expect(result).toMatchObject({
      schema: 1,
      ok: true,
      data: {
        id,
        locators: [{ volume: "fixture-volume", path: "DCIM/a7c2.ARW", online: true }],
      },
      warnings: [{ code: "source_offline", id }],
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("show preserves a preview-cache destination failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-cache-error-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  try {
    const initialized = await initializeLibrary(libraryPath);
    await initialized.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
      [id],
    );
    await writePinnedPreview(cacheRoot, initialized.libraryId, id);
    await writeFile(join(cacheRoot, initialized.libraryId, "view"), "occupied");
    await initialized.handle.close();

    const result = await dispatch(
      {
        verb: "show",
        args: [id],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      { version: "test" },
    );
    expect(result).toMatchObject({ schema: 1, ok: false, code: "volume_readonly" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("show indexes a derived preview only after returning a readable artifact", async () => {
  const events: StderrEvent[] = [];
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-index-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const initialized = await initializeLibrary(libraryPath);
  const coordinator = new PreviewCoordinator();
  try {
    await initialized.handle.query(
      `WITH seed (id, content_key, size, w, h, orientation) AS (VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)), inserted AS (INSERT INTO photos (id, primary_original_id, w, h, orientation) SELECT id::uuid, id::uuid, w::integer, h::integer, orientation::integer FROM seed RETURNING id) INSERT INTO originals (id, photo_id, kind, content_key, size, w, h, orientation) SELECT id::uuid, id::uuid, 'image', content_key, size::bigint, w::integer, h::integer, orientation::integer FROM seed`,
      [id],
    );
    await writePinnedPreview(cacheRoot, initialized.libraryId, id);
    const before = Date.now();

    const result = await dispatch(
      {
        verb: "show",
        args: [id],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      {
        version: "test",
        library: initialized.handle,
        previewCoordinator: coordinator,
        emit: (event) => {
          events.push(event);
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(events[0]).toEqual({ event: "progress", phase: "preview", done: 0, total: 1 });
    expect(events.at(-1)).toEqual({ event: "progress", phase: "preview", done: 1, total: 1 });
    if (!result.ok || !("data" in result)) throw new Error("show failed");
    const path = (result.data as { preview: string }).preview;
    const bytes = (await stat(path)).size + (await stat(`${path}.json`)).size;
    const indexed = await initialized.handle.query<{
      bytes: string;
      last_used: Date | string;
      pinned: boolean;
    }>("SELECT bytes::text, last_used, pinned FROM cache_index WHERE path = $1", [
      relative(join(cacheRoot, initialized.libraryId), path),
    ]);
    expect(indexed.rows).toHaveLength(1);
    expect(indexed.rows[0]).toMatchObject({ bytes: String(bytes), pinned: false });
    expect(new Date(indexed.rows[0]!.last_used).getTime()).toBeGreaterThanOrEqual(before);
    await expect(access(`${path}.json`)).resolves.toBeUndefined();
    const graphState = await initialized.handle.query<{
      executions: string;
      artifacts: string;
      available: boolean | null;
    }>(
      `SELECT
         (SELECT count(*)::text FROM node_executions) AS executions,
         (SELECT count(*)::text FROM image_artifacts) AS artifacts,
         bool_and(artifact_available) AS available
       FROM image_artifacts`,
    );
    expect(graphState.rows).toEqual([{ executions: "0", artifacts: "0", available: null }]);
    const repeated = await dispatch(
      {
        verb: "show",
        args: [id],
        cwd: directory,
        env: { noDaemon: true, libraryPath, cacheRoot },
      },
      { version: "test", library: initialized.handle, previewCoordinator: coordinator },
    );
    expect(repeated).toMatchObject({
      ok: true,
      data: { render_hash: (result.data as { render_hash: string }).render_hash },
    });
    expect(
      (
        await initialized.handle.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM node_executions",
        )
      ).rows,
    ).toEqual([{ count: "0" }]);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("show materializes pixels from the active global develop node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-develop-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const source = join(directory, "photo.png");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 32, height: 24, channels: 3, background: "#45566a" } })
      .png()
      .toFile(source);
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0];
    const neutral = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    await dispatch(
      { verb: "develop", args: [id, "--set", "exposure=1"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    const edited = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!neutral.ok || !("data" in neutral) || !edited.ok || !("data" in edited)) {
      throw new Error("show failed");
    }
    const neutralData = neutral.data as { preview: string; render_hash: string };
    const editedData = edited.data as { preview: string; render_hash: string };
    const [neutralStats, editedStats] = await Promise.all([
      sharp(neutralData.preview).stats(),
      sharp(editedData.preview).stats(),
    ]);
    expect(editedData.render_hash).not.toBe(neutralData.render_hash);
    expect(editedData.preview).not.toBe(neutralData.preview);
    expect(imageMean(editedStats.channels)).toBeGreaterThan(imageMean(neutralStats.channels) * 1.2);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("show derives overview and detail from the current native master", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-master-projections-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const source = join(directory, "photo.png");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const pixels = Buffer.alloc(320 * 180 * 3);
    for (let y = 0; y < 180; y += 1) {
      for (let x = 0; x < 320; x += 1) {
        const offset = (y * 320 + x) * 3;
        pixels[offset] = Math.round((x / 319) * 255);
        pixels[offset + 1] = Math.round((y / 179) * 255);
        pixels[offset + 2] = (x + y) % 2 === 0 ? 64 : 192;
      }
    }
    await sharp(pixels, { raw: { width: 320, height: 180, channels: 3 } })
      .png()
      .toFile(source);
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0]!;
    await dispatch(
      { verb: "develop", args: [id, "--set", "exposure=0.5"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );

    const native = await dispatch(
      { verb: "show", args: [id, "--preview-size", "native"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!native.ok || !("data" in native)) throw new Error("native show failed");
    const executionCount = async () =>
      Number(
        (
          await initialized.handle.query<{ count: string }>(
            "SELECT count(*)::text AS count FROM node_executions",
          )
        ).rows[0]!.count,
      );
    const before = await executionCount();
    const detail = await dispatch(
      { verb: "show", args: [id, "--region", "40,30,80,60"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    const overview = await dispatch(
      { verb: "show", args: [id], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!detail.ok || !("data" in detail) || !overview.ok || !("data" in overview)) {
      throw new Error("derived show failed");
    }
    const nativeData = showDataSchema.parse(native.data);
    const detailData = showDataSchema.parse(detail.data);
    const overviewData = showDataSchema.parse(overview.data);

    expect(await executionCount()).toBe(before);
    expect(nativeData.preview_info.actual).toEqual({ region: [0, 0, 320, 180], w: 320, h: 180 });
    expect(detailData.preview_info).toMatchObject({
      actual: { region: [40, 30, 80, 60], w: 80, h: 60 },
      cache_source: "sufficient_full_frame",
    });
    expect(overviewData.preview_info).toMatchObject({
      actual: { region: [0, 0, 320, 180], w: 320, h: 180 },
      cache_source: "sufficient_full_frame",
    });
    expect(new Set([nativeData.preview, detailData.preview, overviewData.preview]).size).toBe(3);

    const [masterPixels, overviewPixels] = await Promise.all([
      sharp(nativeData.preview).raw().toBuffer(),
      sharp(overviewData.preview).raw().toBuffer(),
    ]);
    const meanAbsoluteDifference =
      masterPixels.reduce(
        (sum, value, index) => sum + Math.abs(value - overviewPixels[index]!),
        0,
      ) / masterPixels.length;
    expect(meanAbsoluteDifference).toBeLessThan(1);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

test("show reports and renders the active base-space crop and quarter-turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-geometry-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const source = join(directory, "photo.png");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 40, height: 30, channels: 3, background: "#45566a" } })
      .png()
      .toFile(source);
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const imported = await dispatch(
      { verb: "import", args: [source, "--link"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );
    if (!imported.ok || !("data" in imported)) throw new Error("import failed");
    const id = (imported.data as { ids: string[] }).ids[0]!;
    await dispatch(
      {
        verb: "develop",
        args: [id, "--set", 'crop={"x":10,"y":0,"w":20,"h":30}', "rotate=90"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );

    const shown = await dispatch(
      { verb: "show", args: [id, "--preview-size", "native"], cwd: directory, env },
      { version: "test", library: initialized.handle },
    );

    expect(shown).toMatchObject({
      ok: true,
      data: {
        dims: { w: 40, h: 30 },
        crop: {
          rect: { x: 10, y: 0, w: 20, h: 30 },
          rotate: 90,
          straighten_deg: 0,
          aspect_ratio: null,
        },
        preview_info: { actual: { w: 30, h: 20 } },
      },
    });
    expect((shown as { data: { preview_info: unknown } }).data.preview_info).toMatchObject({
      base_to_view: { a: 0, b: 1, c: -1, d: 0, e: 30, f: -10 },
      view_to_base: { a: 0, b: -1, c: 1, d: 0, e: 10, f: 30 },
      visible_base_polygon: [
        [10, 30],
        [10, 0],
        [30, 0],
        [30, 30],
      ],
    });

    const region = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "10,0,10,15", "--preview-size", "native"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    expect(region).toMatchObject({
      ok: true,
      data: {
        preview_info: {
          requested: { region: [10, 0, 10, 15] },
          actual: { region: [10, 0, 10, 15], w: 15, h: 10 },
          base_to_view: { a: 0, b: 1, c: -1, d: 0, e: 15, f: -10 },
          view_to_base: { a: 0, b: -1, c: 1, d: 0, e: 10, f: 15 },
        },
      },
    });
    const partial = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "5,0,10,10", "--preview-size", "native"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    expect(partial).toMatchObject({
      ok: true,
      data: { preview_info: { actual: { region: [10, 0, 5, 10], w: 10, h: 5 } } },
    });
    const fractional = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "10.2,0.2,1,1", "--preview-size", "native"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    expect(fractional).toMatchObject({
      ok: true,
      data: { preview_info: { actual: { region: [10, 0, 2, 2], w: 2, h: 2 } } },
    });
    const outside = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "0,0,5,5", "--preview-size", "native"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    expect(outside).toMatchObject({ ok: false, code: "usage" });
    const touching = await dispatch(
      {
        verb: "show",
        args: [id, "--region", "0,0,10,5", "--preview-size", "native"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    expect(touching).toMatchObject({ ok: false, code: "usage" });
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
});

async function writePinnedPreview(cacheBase: string, libraryId: string, id: string): Promise<void> {
  const path = join(cacheBase, libraryId, "emb", `${id}.jpg`);
  await mkdir(join(cacheBase, libraryId, "emb"), { recursive: true });
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .toFile(path);
}
