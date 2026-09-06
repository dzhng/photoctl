import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { exportResultSchema, fillMoveDataSchema } from "@photoctl/protocol";

test("built combined move-scale changes delivery and one undo restores the original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-move-scale-cli-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const command = async (args: string[]) => {
    const response = await spawnPhotoctl(args, {
      libraryDir: library,
      env: {
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=move-fixture:online`,
      },
    });
    expect(response.code, JSON.stringify(response.json)).toBe(0);
    return response.json as { data: unknown; results: unknown[] };
  };
  try {
    const pixels = Buffer.alloc(80 * 60 * 3);
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 80; x++) {
        const subject = x < 20;
        pixels.set(subject ? [240, 30 + y * 2, 10] : [10, 20, 240], (y * 80 + x) * 3);
      }
    await sharp(pixels, { raw: { width: 80, height: 60, channels: 3 } })
      .png()
      .toFile(source);
    const original = await readFile(source);
    await command(["init", "--path", library]);
    const imported = await command(["import", source, "--link"]);
    const id = (imported.data as { ids: string[] }).ids[0]!;
    const segmented = await command(["segment", id, "--box", "0,0,20,60"]);
    const layer = (segmented.data as { layer_id: string }).layer_id;
    const deliver = async (name: string) => {
      const result = await command([
        "export",
        id,
        "--to",
        join(directory, name),
        "--format",
        "png",
      ]);
      return exportResultSchema.parse(result.results[0]).file;
    };
    const before = await sharp(await deliver("before"))
      .removeAlpha()
      .raw()
      .toBuffer();
    const moved = fillMoveDataSchema.parse(
      (await command(["fill", id, "--move", layer, "--to", "50,30", "--scale", "0.5"])).data,
    );
    expect(moved.matrix).toEqual([0.5, 0, 0, 0.5, 45, 15]);
    const after = await sharp(await deliver("after"))
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(after.equals(before)).toBe(false);
    const rgb = (x: number, y: number) => [
      ...after.subarray((y * 80 + x) * 3, (y * 80 + x) * 3 + 3),
    ];
    expect(rgb(10, 30)).toEqual([255, 0, 255]);
    expect(rgb(50, 30)[0]).toBeGreaterThan(rgb(50, 30)[2]! + 100);
    expect(rgb(50, 5)[2]).toBeGreaterThan(rgb(50, 5)[0]! + 100);
    expect(rgb(75, 30)).toEqual([...before.subarray((30 * 80 + 75) * 3, (30 * 80 + 75) * 3 + 3)]);
    await command(["undo", id]);
    expect(
      await sharp(await deliver("undone"))
        .removeAlpha()
        .raw()
        .toBuffer(),
    ).toEqual(before);
    expect(await readFile(source)).toEqual(original);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 30_000);
