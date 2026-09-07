import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import {
  exportResultSchema,
  graphShowDataSchema,
  showDataSchema,
  undoDataSchema,
  redoDataSchema,
} from "@photoctl/protocol";

test("public undo and redo restore saved edit pixels across daemon restarts and stop at history boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-undo-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: join(directory, "cache"),
    PHOTOCTL_VOLUME_MAP: `${directory}=undo-fixture:online`,
  };
  const run = async (args: string[]) => {
    const result = await spawnPhotoctl(args, { libraryDir: library, env });
    expect(result.code, JSON.stringify(result.json)).toBe(0);
    return result.json;
  };
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: "#304050" } })
      .png()
      .toFile(source);
    expect((await spawnPhotoctl(["init", "--path", library])).code).toBe(0);
    const imported = await run(["import", source, "--link"]);
    const id = (imported.data as { ids: string[] }).ids[0]!;
    const untouched = undoDataSchema.parse((await run(["undo", id])).data);
    expect(untouched.undone).toBe(false);
    const original = showDataSchema.parse(
      (await run(["show", id, "--preview-size", "native"])).data,
    );
    expect(original.render_hash).toBe(untouched.render_hash);
    await run(["develop", id, "--set", "exposure=0.5"]);
    const first = showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data);
    const firstPixels = await readFile(first.preview);
    const firstExport = exportResultSchema.parse(
      (await run(["export", id, "--to", join(directory, "first-delivery")])).results?.[0],
    );
    const firstExportPixels = await sharp(firstExport.file).raw().toBuffer();
    const graph = graphShowDataSchema.parse((await run(["graph", "show", id])).data);
    await run(["develop", id, "--set", "exposure=1"]);
    const second = showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data);
    expect(await readFile(second.preview)).not.toEqual(firstPixels);

    expect(await run(["undo", id])).toMatchObject({
      data: {
        id,
        undone: true,
        revision_id: graph.revision_id,
        render_hash: first.render_hash,
      },
    });
    const restored = showDataSchema.parse(
      (await run(["show", id, "--preview-size", "native"])).data,
    );
    expect(restored.develop).toEqual({ exposure: 0.5 });
    expect(await readFile(restored.preview)).toEqual(firstPixels);
    const restoredExport = await run(["export", id, "--to", join(directory, "delivery")]);
    expect(restoredExport).toMatchObject({
      results: [{ ok: true, render_hash: first.render_hash }],
    });
    expect(
      await sharp(exportResultSchema.parse(restoredExport.results?.[0]).file).raw().toBuffer(),
    ).toEqual(firstExportPixels);
    expect(await run(["undo", id])).toMatchObject({
      data: { undone: true, render_hash: original.render_hash },
    });
    const stopped = undoDataSchema.parse((await run(["undo", id])).data);
    expect(stopped).toMatchObject({ undone: false, render_hash: original.render_hash });
    expect(undoDataSchema.parse((await run(["undo", id])).data)).toEqual(stopped);
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
    expect(redoDataSchema.parse((await run(["redo", id])).data)).toEqual({
      id,
      redone: true,
      revision_id: graph.revision_id,
      render_hash: first.render_hash,
    });
    expect(
      await readFile(
        showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data).preview,
      ),
    ).toEqual(firstPixels);
    expect(redoDataSchema.parse((await run(["redo", id])).data)).toMatchObject({
      redone: true,
      render_hash: second.render_hash,
    });
    const redoStopped = redoDataSchema.parse((await run(["redo", id])).data);
    expect(redoStopped).toMatchObject({ redone: false, render_hash: second.render_hash });
    expect(redoDataSchema.parse((await run(["redo", id])).data)).toEqual(redoStopped);
    await run(["undo", id]);
    expect(
      (
        await spawnPhotoctl(["develop", id, "--set", "exposure=invalid"], {
          libraryDir: library,
          env,
        })
      ).code,
    ).toBe(2);
    expect(redoDataSchema.parse((await run(["redo", id])).data)).toMatchObject({
      redone: true,
      render_hash: second.render_hash,
    });
    await run(["undo", id]);
    await run(["develop", id, "--set", "exposure=0.75"]);
    const branch = graphShowDataSchema.parse((await run(["graph", "show", id])).data);
    expect(redoDataSchema.parse((await run(["redo", id])).data)).toMatchObject({
      redone: false,
      revision_id: branch.revision_id,
    });
    const invalidResults = await Promise.all(
      [
        ["undo"],
        ["undo", id, id],
        ["undo", id, "--redo"],
        ["redo"],
        ["redo", id, id],
        ["redo", id, "--undo"],
      ].map(async (args) => await spawnPhotoctl(args, { libraryDir: library, env })),
    );
    for (const invalid of invalidResults) {
      expect(invalid.code).toBe(2);
      expect(invalid.json).toMatchObject({ ok: false, code: "usage" });
    }
  } finally {
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
    await rm(directory, { recursive: true });
  }
}, 30_000);
