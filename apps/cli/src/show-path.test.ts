import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { showDataSchema } from "@photoctl/protocol";

test("show resolves an existing photo by absolute, relative and symlink paths without importing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-path-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const command = (args: string[]) =>
    spawnPhotoctl(args, {
      cwd: args[0] === "init" ? process.cwd() : directory,
      libraryDir: library,
      env: {
        PHOTOCTL_NO_DAEMON: "0",
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=show-path-fixture:online`,
      },
    });
  const show = async (target: string) => {
    const result = await command(["show", target]);
    expect(result.code).toBe(0);
    return showDataSchema.parse((result.json as { data: unknown }).data);
  };
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#805020" } })
      .png()
      .toFile(source);
    await symlink(source, join(directory, "alias.png"));
    expect((await command(["init", "--path", library])).code).toBe(0);
    const imported = await command(["import", source, "--link"]);
    expect(imported.code).toBe(0);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
    expect((await command(["develop", id, "--set", "exposure=0.5"])).code).toBe(0);
    const byId = await show(id);
    const preview = await readFile(byId.preview);
    for (const target of [source, "source.png", "./alias.png", id.slice(0, 12)]) {
      const byPath = await show(target);
      expect(byPath.id).toBe(id);
      expect(byPath.render_hash).toBe(byId.render_hash);
      expect(byPath.develop).toEqual(byId.develop);
      expect(await readFile(byPath.preview)).toEqual(preview);
    }
    const listed = await command(["list"]);
    expect(listed.json).toMatchObject({ data: { total: 1, rows: [{ id }] } });
  } finally {
    await command(["daemon", "stop"]);
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("show does not import unknown paths or confuse volume identity, and IDs retain offline access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-path-boundary-"));
  const library = join(directory, "library");
  const source = join(directory, "abcdef");
  const unknown = join(directory, "unknown.png");
  const command = (args: string[], volume = "show-path-fixture:online") =>
    spawnPhotoctl(args, {
      cwd: directory,
      libraryDir: library,
      env: {
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=${volume}`,
      },
    });
  try {
    await sharp({ create: { width: 12, height: 8, channels: 3, background: "#806020" } })
      .png()
      .toFile(source);
    await sharp({ create: { width: 8, height: 12, channels: 3, background: "#208060" } })
      .png()
      .toFile(unknown);
    expect((await command(["init", "--path", library])).code).toBe(0);
    const imported = await command(["import", source, "--link"]);
    expect(imported.code).toBe(0);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
    const explicitPath = await command(["show", "./abcdef"]);
    expect(explicitPath.code).toBe(0);
    expect(explicitPath.json).toMatchObject({ data: { id } });
    const preview = await readFile(
      showDataSchema.parse((explicitPath.json as { data: unknown }).data).preview,
    );
    expect((await command(["show", "abcdef"])).json).toMatchObject({ code: "not_found" });
    expect((await command(["show", unknown])).json).toMatchObject({ code: "not_found" });
    expect((await command(["show", source], "different-volume:online")).json).toMatchObject({
      code: "not_found",
    });
    const mappedOffline = await command(["show", source], "show-path-fixture:offline");
    expect(mappedOffline.code).toBe(0);
    expect(mappedOffline.json).toMatchObject({
      data: { id },
      warnings: [{ code: "source_offline" }],
    });
    await rm(source);
    const missing = await command(["show", source]);
    expect(missing.code).toBe(69);
    expect(missing.json).toMatchObject({ code: "file_offline" });
    const offline = await command(["show", id], "show-path-fixture:offline");
    expect(offline.code).toBe(0);
    expect(offline.json).toMatchObject({ data: { id }, warnings: [{ code: "source_offline" }] });
    const offlineData = showDataSchema.parse((offline.json as { data: unknown }).data);
    expect(await readFile(offlineData.preview)).toEqual(preview);
    expect((await command(["list"])).json).toMatchObject({ data: { total: 1, rows: [{ id }] } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test("show resolves library-owned originals after the external source disappears", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-show-copy-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const command = (args: string[]) =>
    spawnPhotoctl(args, {
      libraryDir: library,
      env: {
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=show-copy-fixture:online`,
      },
    });
  try {
    await sharp({ create: { width: 12, height: 8, channels: 3, background: "#204080" } })
      .png()
      .toFile(source);
    expect((await command(["init", "--path", library])).code).toBe(0);
    const imported = await command(["import", source, "--copy"]);
    expect(imported.code).toBe(0);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
    const shown = await command(["show", id]);
    const byId = showDataSchema.parse((shown.json as { data: unknown }).data);
    expect(byId.locators[0]!.volume).toBe("photoctl-library");
    await rm(source);
    const byPath = await command(["show", join(library, byId.locators[0]!.path)]);
    expect(byPath.code).toBe(0);
    expect(byPath.json).toMatchObject({ data: { id, render_hash: byId.render_hash } });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
