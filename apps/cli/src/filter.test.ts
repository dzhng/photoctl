import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { showDataSchema } from "@photoctl/protocol";

test("public filter shares develop state, repeat behavior and undo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-filter-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const env = {
    PHOTOCTL_CACHE: join(directory, "cache"),
    PHOTOCTL_VOLUME_MAP: `${directory}=filter-fixture:online`,
  };
  const command = (args: string[]) => spawnPhotoctl(args, { libraryDir: library, env });
  const show = async (id: string) => {
    const result = await command(["show", id, "--preview-size", "native"]);
    expect(result.code).toBe(0);
    return showDataSchema.parse((result.json as { data: unknown }).data);
  };
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#805020" } })
      .png()
      .toFile(source);
    const originalBytes = await readFile(source);
    expect((await command(["init", "--path", library])).code).toBe(0);
    const imported = await command(["import", source, "--link"]);
    expect(imported.code).toBe(0);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
    const original = await show(id);
    const originalPreview = await readFile(original.preview);
    const filtered = await command([
      "filter",
      id.slice(0, 12),
      "--name",
      "vivid",
      "--strength",
      "0.5",
    ]);
    expect(filtered.code).toBe(0);
    expect(filtered.json).toMatchObject({ ok: true, results: [{ id, ok: true }] });
    const applied = await show(id);
    expect(applied.develop).toMatchObject({ filter: { name: "vivid", strength: 0.5 } });
    expect(applied.render_hash).not.toBe(original.render_hash);
    const appliedPreview = await readFile(applied.preview);
    expect(appliedPreview).not.toEqual(originalPreview);
    expect(
      (await command(["develop", id, "--set", "filter.name=vivid", "--set", "filter.strength=0.5"]))
        .code,
    ).toBe(0);
    expect((await command(["filter", id, "--name", "vivid", "--strength", "0.5"])).code).toBe(0);
    const repeated = await show(id);
    expect(repeated.render_hash).toBe(applied.render_hash);
    expect(await readFile(repeated.preview)).toEqual(appliedPreview);
    const exported = await command([
      "export",
      id,
      "--to",
      join(directory, "delivery"),
      "--format",
      "png",
    ]);
    expect(exported.code).toBe(0);
    expect(exported.json).toMatchObject({
      results: [{ id, render_hash: applied.render_hash, w: 16, h: 12 }],
    });
    expect((await command(["undo", id])).code).toBe(0);
    const undone = await show(id);
    expect(undone.render_hash).toBe(original.render_hash);
    expect(await readFile(undone.preview)).toEqual(originalPreview);
    expect(await readFile(source)).toEqual(originalBytes);
    for (const args of [
      [id, "--name", "vivid"],
      [id, "--strength", "0.5"],
      [id, id, "--name", "vivid", "--strength", "0.5"],
      [id, "--name", "missing", "--strength", "0.5"],
      [id, "--name", "vivid", "--strength", "2"],
    ])
      expect((await command(["filter", ...args])).code).toBe(2);
    expect((await show(id)).render_hash).toBe(original.render_hash);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
