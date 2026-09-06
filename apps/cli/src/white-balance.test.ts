import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { exportResultSchema, showDataSchema, whiteBalanceDataSchema } from "@photoctl/protocol";

test("built eyedropper neutralizes delivery pixels and shares explicit develop and undo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-eyedropper-cli-"));
  const library = join(directory, "library");
  const source = join(directory, "patch.png");
  const command = (args: string[]) =>
    spawnPhotoctl(args, {
      libraryDir: library,
      env: {
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=wb-fixture:online`,
      },
    });
  try {
    await sharp({
      create: { width: 16, height: 12, channels: 3, background: { r: 125, g: 130, b: 135 } },
    })
      .png()
      .toFile(source);
    const bytes = await readFile(source);
    expect((await command(["init", "--path", library])).code).toBe(0);
    const imported = await command(["import", source, "--link"]);
    const id = (imported.json as { data: { ids: string[] } }).data.ids[0]!;
    const show = async () => {
      const response = await command(["show", id, "--preview-size", "native"]);
      expect(response.code).toBe(0);
      return showDataSchema.parse((response.json as { data: unknown }).data);
    };
    const before = await show();
    const response = await command(["white_balance", id.slice(0, 12), "--region", "0,0,16,12"]);
    expect(response.code).toBe(0);
    const fit = whiteBalanceDataSchema.parse((response.json as { data: unknown }).data);
    const after = await show();
    expect(after.develop.white_balance).toEqual(fit.white_balance);
    expect(
      (
        await command([
          "develop",
          id,
          "--set",
          `white_balance.temp_offset_k=${fit.white_balance.temp_offset_k}`,
          "--set",
          `white_balance.tint=${fit.white_balance.tint}`,
        ])
      ).code,
    ).toBe(0);
    expect((await show()).render_hash).toBe(after.render_hash);
    const delivery = await command([
      "export",
      id,
      "--to",
      join(directory, "delivery"),
      "--format",
      "png",
    ]);
    expect(delivery.code).toBe(0);
    const file = exportResultSchema.parse(
      (delivery.json as { results: unknown[] }).results[0],
    ).file;
    const rgb = await sharp(file).removeAlpha().raw().toBuffer();
    for (let i = 0; i < rgb.length; i += 3)
      expect(
        Math.max(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) - Math.min(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!),
      ).toBeLessThanOrEqual(1);
    expect((await command(["undo", id])).code).toBe(0);
    expect((await show()).render_hash).toBe(before.render_hash);
    expect(await readFile(source)).toEqual(bytes);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 30_000);
