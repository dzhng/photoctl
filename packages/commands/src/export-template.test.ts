import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test("export applies a library preset, lets CLI options override it, resolves collisions, and records writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-command-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const source = join(directory, "portrait.jpg");
  const output = join(directory, "delivery");
  const initialized = await initializeLibrary(libraryPath);
  try {
    await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#467" } })
      .jpeg()
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
    if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
    const id = (imported.data as { ids: string[] }).ids[0];
    await initialized.handle.query(
      `INSERT INTO volumes (uuid, label, last_mount, last_seen)
       VALUES ('offline-volume', 'missing card', $1, now())`,
      [join(directory, "offline")],
    );
    await initialized.handle.query(
      `INSERT INTO files (id, photo_id, volume_uuid, rel_path, mtime)
       VALUES ('00000000-0000-0000-0000-000000000001', $1, 'offline-volume',
               'DCIM/offline-first.jpg', now())`,
      [id],
    );
    await initialized.handle.query(
      "UPDATE photos SET shot_at = '2023-10-02T16:18:37Z', shot_offset_min = 120, rating = 5 WHERE id = $1",
      [id],
    );
    await mkdir(join(libraryPath, "presets", "export"), { recursive: true });
    await writeFile(
      join(libraryPath, "presets", "export", "client.json"),
      JSON.stringify({
        to: output,
        format: "jpeg",
        quality: 70,
        resize: 600,
        template: "{date}_{seq:03}_{stem}",
        "on-collision": "rename",
        iptc: { creator: "Preset Creator", copyright: "Copyright 2026" },
      }),
    );

    const first = await dispatch(
      {
        verb: "export",
        args: [id, "--preset", "client", "--resize", "400", "--iptc", "creator=CLI Creator"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );
    const second = await dispatch(
      {
        verb: "export",
        args: [id, "--to", output, "--preset", "client", "--resize", "400"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );

    const firstPath = join(output, "2023-10-02_001_portrait.jpg");
    const renamedPath = join(output, "2023-10-02_001_portrait_2.jpg");
    expect(first).toMatchObject({
      schema: 1,
      ok: true,
      results: [
        {
          id,
          ok: true,
          file: firstPath,
          w: 400,
          h: 267,
          render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/u),
          skipped: false,
        },
      ],
    });
    expect(second).toMatchObject({
      schema: 1,
      ok: true,
      results: [{ id, file: renamedPath, skipped: false }],
    });
    const firstMetadata = await sharp(firstPath).metadata();
    expect(firstMetadata).toMatchObject({ width: 400, height: 267, hasProfile: true });
    expect(firstMetadata.xmp?.toString()).toContain("CLI Creator");
    expect(firstMetadata.xmp?.toString()).toContain("Copyright 2026");
    const history = await initialized.handle.query<{
      path: string;
      render_hash: string;
      bytes: string;
    }>("SELECT path, render_hash, bytes::text FROM exports ORDER BY id");
    expect(history.rows).toEqual([
      {
        path: firstPath,
        render_hash: (first as { results: Array<{ render_hash: string }> }).results[0].render_hash,
        bytes: String((await readFile(firstPath)).length),
      },
      {
        path: renamedPath,
        render_hash: (second as { results: Array<{ render_hash: string }> }).results[0].render_hash,
        bytes: String((await readFile(renamedPath)).length),
      },
    ]);
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 30_000);

test("a truncated skipped JPEG becomes a per-item failure and the batch continues", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-export-skip-corrupt-"));
  const libraryPath = join(directory, "library");
  const cacheRoot = join(directory, "cache");
  const output = join(directory, "delivery");
  const initialized = await initializeLibrary(libraryPath);
  try {
    const env = {
      noDaemon: true,
      libraryPath,
      cacheRoot,
      volumeMap: `${directory}=fixture-volume:online`,
    };
    const importFixture = async (stem: string, background: string): Promise<string> => {
      const source = join(directory, `${stem}.jpg`);
      await sharp({ create: { width: 20, height: 10, channels: 3, background } })
        .jpeg()
        .toFile(source);
      const imported = await dispatch(
        { verb: "import", args: [source, "--link"], cwd: directory, env },
        { version: "test", library: initialized.handle },
      );
      if (!imported.ok || !("data" in imported)) throw new Error("fixture import failed");
      return (imported.data as { ids: string[] }).ids[0];
    };
    const ids = [await importFixture("broken", "#467"), await importFixture("healthy", "#c42")];
    await mkdir(output);
    const corruptPath = join(output, "broken.jpg");
    const completeJpeg = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#246" },
    })
      .jpeg()
      .toBuffer();
    const truncatedJpeg = completeJpeg.subarray(0, -2);
    await writeFile(corruptPath, truncatedJpeg);

    const exported = await dispatch(
      {
        verb: "export",
        args: [...ids, "--to", output, "--on-collision", "skip"],
        cwd: directory,
        env,
      },
      { version: "test", library: initialized.handle },
    );

    expect(exported).toMatchObject({
      schema: 1,
      ok: false,
      code: "partial",
      summary: { ok: 1, failed: 1 },
      results: [
        { id: ids[0], ok: false, code: "volume_readonly", path: corruptPath },
        { id: ids[1], ok: true, file: join(output, "healthy.jpg"), skipped: false },
      ],
    });
    await expect(readFile(corruptPath)).resolves.toEqual(truncatedJpeg);
    await expect(sharp(join(output, "healthy.jpg")).metadata()).resolves.toMatchObject({
      format: "jpeg",
    });
  } finally {
    await initialized.handle.close();
    await rm(directory, { recursive: true });
  }
}, 30_000);
