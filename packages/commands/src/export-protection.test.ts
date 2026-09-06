import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test, vi } from "vitest";
import { EnvVolumeResolver, initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test.each([
  "self",
  "other",
  "copied",
  "file-alias",
  "directory-alias",
  "missing",
  "companion",
  "prior-volume",
])(
  "export overwrite preserves the %s catalog original",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-export-protection-"));
    const drive = join(root, "drive");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      const env = {
        noDaemon: true,
        cacheRoot: join(root, "cache"),
        volumeMap: `${drive}=drive:online`,
      };
      const context = { version: "test", library: library.handle };
      const command = (verb: string, args: string[]) =>
        dispatch({ verb, args, cwd: root, env }, context);
      const source = join(drive, "source.png");
      await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } })
        .png()
        .toFile(source);
      const imported = await command("import", [source, "--link"]);
      if (!imported.ok || !("data" in imported)) throw new Error("source import failed");
      const id = (imported.data as { ids: string[] }).ids[0];
      let original = source;
      if (kind === "companion") {
        const pair = join(drive, "pair");
        await mkdir(pair);
        await copyFile(resolve("fixtures/camera/DSC08819.ARW"), join(pair, "frame.ARW"));
        original = join(pair, "frame.jpg");
        await copyFile(resolve("fixtures/camera/DSC08819.JPG"), original);
        expect(await command("import", [pair, "--link"])).toMatchObject({
          ok: true,
          data: { imported: 1 },
        });
        expect(
          (
            await library.handle.query(
              "SELECT o.kind, p.primary_original_id = o.id AS primary FROM files f JOIN originals o ON o.id = f.original_id JOIN photos p ON p.id = o.photo_id WHERE f.rel_path = 'pair/frame.jpg'",
            )
          ).rows,
        ).toEqual([{ kind: "jpeg", primary: false }]);
      } else if (kind !== "self") {
        original = join(drive, "other.jpg");
        await sharp({ create: { width: 3, height: 2, channels: 3, background: "#b32" } })
          .jpeg()
          .toFile(original);
        const other = await command("import", [original, kind === "copied" ? "--copy" : "--link"]);
        if (!other.ok || !("data" in other)) throw new Error("target import failed");
        if (kind === "copied") {
          const otherId = (other.data as { ids: string[] }).ids[0];
          const files = await library.handle.query<{ rel_path: string }>(
            "SELECT f.rel_path FROM files f JOIN originals o ON o.id = f.original_id WHERE o.photo_id = $1 AND f.volume_uuid = 'photoctl-library'",
            [otherId],
          );
          original = join(library.handle.path, files.rows[0].rel_path);
        }
      }
      const bytes = await readFile(original);
      let target = original;
      if (kind === "file-alias") {
        target = join(root, "alias.jpg");
        await symlink(original, target);
      } else if (kind === "directory-alias") {
        await symlink(dirname(original), join(root, "alias"));
        target = join(root, "alias", basename(original));
      } else if (kind === "missing") await rm(original);
      if (kind === "prior-volume") {
        const otherDrive = join(root, "new-drive");
        await mkdir(otherDrive);
        env.volumeMap = `${otherDrive}=new-drive:online`;
        expect(await command("show", [original])).toMatchObject({
          ok: false,
          code: "file_offline",
        });
      }
      const result = await command("export", [
        id,
        "--to",
        dirname(target),
        "--template",
        basename(target, extname(target)),
        "--format",
        extname(target) === ".png" ? "png" : "jpeg",
        "--on-collision",
        "overwrite",
      ]);
      expect.soft(result).toMatchObject({
        ok: false,
        results: [{ id, ok: false, code: "volume_readonly", path: target }],
      });
      if (kind === "missing")
        await expect(readFile(original)).rejects.toMatchObject({ code: "ENOENT" });
      else expect((await readFile(original)).equals(bytes)).toBe(true);
      expect((await library.handle.query("SELECT path FROM exports")).rows).toEqual([]);
    } finally {
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
  30_000,
);

test.each([false, true])(
  "delivery overwrite fails closed only when location lookup fails: %s",
  async (failLookup) => {
    const root = await mkdtemp(join(tmpdir(), "photoctl-export-delivery-"));
    const drive = join(root, "drive");
    const delivery = join(root, "delivery");
    const library = await initializeLibrary(join(root, "library"));
    try {
      await mkdir(drive);
      await mkdir(delivery);
      const source = join(drive, "source.png");
      const target = join(delivery, "source.jpg");
      await sharp({ create: { width: 4, height: 3, channels: 3, background: "#456" } })
        .png()
        .toFile(source);
      await sharp({ create: { width: 1, height: 1, channels: 3, background: "#b32" } })
        .jpeg()
        .toFile(target);
      const bytes = await readFile(target);
      const original = await readFile(source);
      const env = {
        noDaemon: true,
        cacheRoot: join(root, "cache"),
        volumeMap: `${drive}=drive:online`,
      };
      const context = { version: "test", library: library.handle };
      const imported = await dispatch(
        { verb: "import", args: [source, "--link"], cwd: root, env },
        context,
      );
      if (!imported.ok || !("data" in imported)) throw new Error("import failed");
      const id = (imported.data as { ids: string[] }).ids[0];
      if (failLookup)
        vi.spyOn(EnvVolumeResolver.prototype, "locate").mockRejectedValue(
          new Error("volume lookup failed"),
        );
      const exported = await dispatch(
        {
          verb: "export",
          args: [id, "--to", delivery, "--on-collision", "overwrite"],
          cwd: root,
          env,
        },
        context,
      );
      if (failLookup) {
        expect(exported).toMatchObject({
          ok: false,
          results: [{ ok: false, code: "volume_readonly", path: target }],
        });
        expect(await readFile(target)).toEqual(bytes);
        expect((await library.handle.query("SELECT path FROM exports")).rows).toEqual([]);
      } else {
        expect(exported).toMatchObject({
          ok: true,
          results: [{ ok: true, file: target, skipped: false }],
        });
        expect(await sharp(target).metadata()).toMatchObject({ width: 4, height: 3 });
        expect(await readFile(target)).not.toEqual(bytes);
        expect((await library.handle.query("SELECT path FROM exports")).rows).toEqual([
          { path: target },
        ]);
      }
      expect(await readFile(source)).toEqual(original);
    } finally {
      vi.restoreAllMocks();
      await library.handle.close();
      await rm(root, { recursive: true });
    }
  },
);
