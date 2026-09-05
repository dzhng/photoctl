import { access, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { PreviewCoordinator } from "@photoctl/render";
import { dispatch } from "./dispatch.js";

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
      `INSERT INTO photos (id, content_key, size, w, h, orientation, camera, exposure)
       VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1, '{}'::jsonb, '{}'::jsonb)`,
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
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)`,
      [id],
    );
    await writePinnedPreview(cacheRoot, initialized.libraryId, id);
    await initialized.handle.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('fixture-volume', 'card', $1, now())`,
      [mount],
    );
    await initialized.handle.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
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
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)`,
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
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-index-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const id = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c001";
  const initialized = await initializeLibrary(libraryPath);
  const coordinator = new PreviewCoordinator();
  try {
    await initialized.handle.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_0000000000000001', 1, 1, 1, 1)`,
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
      { version: "test", library: initialized.handle, previewCoordinator: coordinator },
    );

    expect(result.ok).toBe(true);
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
      available: boolean;
    }>(
      `SELECT
         (SELECT count(*)::text FROM node_executions) AS executions,
         (SELECT count(*)::text FROM image_artifacts) AS artifacts,
         bool_and(artifact_available) AS available
       FROM image_artifacts`,
    );
    expect(graphState.rows).toEqual([{ executions: "2", artifacts: "1", available: true }]);
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
    ).toEqual([{ count: "2" }]);
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
