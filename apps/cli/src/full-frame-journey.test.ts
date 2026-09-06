import { registerFullFrameJourney } from "../../../test/journeys/full-frame.js";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

registerFullFrameJourney(
  process.env.PHOTOCTL_FULL_FRAME_INSTALLED_CLI
    ? (args, options) =>
        spawnPhotoctl(args, { ...options, cliPath: process.env.PHOTOCTL_FULL_FRAME_INSTALLED_CLI })
    : undefined,
);

test("permanent unequal RAW/JPEG originals retain source membership at the full-frame input boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-full-frame-camera-"));
  try {
    const sources = join(directory, "sources");
    await mkdir(sources);
    await Promise.all(
      ["ARW", "JPG"].map((extension) =>
        copyFile(
          resolve(`fixtures/camera/DSC00103.${extension}`),
          join(sources, `frame.${extension}`),
        ),
      ),
    );
    const library = join(directory, "library");
    const env = {
      PHOTOCTL_CACHE: join(directory, "cache"),
      PHOTOCTL_VOLUME_MAP: `${directory}=fixture:online`,
    };
    const run = async (args: string[]) => {
      const result = await spawnPhotoctl(args, { libraryDir: library, env });
      expect(result.code, JSON.stringify(result.json)).toBe(0);
      return result.json;
    };
    await run(["init", "--path", library]);
    const imported = await run(["import", sources, "--link"]);
    expect(imported).toMatchObject({ data: { imported: 1 } });
    const id = (imported.data as { ids: string[] }).ids[0]!;
    const shown = await run(["show", id, "--source", "camera-jpeg", "--preview-size", "320"]);
    expect(shown).toMatchObject({
      data: {
        dims: { w: 7008, h: 4672, orientation: 1 },
        originals: [
          { kind: "raw", dims: { w: 3504, h: 2336 } },
          { kind: "jpeg", dims: { w: 7008, h: 4672 } },
        ],
      },
    });
    await run(["develop", id, "--set", 'crop={"x":20,"y":30,"w":160,"h":120}', "rotate=90"]);
    const current = await run(["show", id, "--preview-size", "320"]);
    expect(current).toMatchObject({
      data: {
        dims: { w: 3504, h: 2336, orientation: 1 },
        preview_info: { actual: { w: 120, h: 160 } },
      },
    });
    const camera = await run(["show", id, "--source", "camera-jpeg", "--preview-size", "320"]);
    expect(camera.data).toMatchObject({
      render_hash: (shown.data as { render_hash: string }).render_hash,
      crop: null,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
}, 60_000);
