import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

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
      warnings: [],
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

async function writePinnedPreview(cacheBase: string, libraryId: string, id: string): Promise<void> {
  const path = join(cacheBase, libraryId, "emb", `${id}.jpg`);
  await mkdir(join(cacheBase, libraryId, "emb"), { recursive: true });
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .toFile(path);
}
