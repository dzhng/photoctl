import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { spawnPhotoctl } from "@photoctl/test-harness";
import { showDataSchema } from "@photoctl/protocol";

test("public crop auto levels a visible horizon without modifying the original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-crop-"));
  const library = join(directory, "library");
  const source = join(directory, "source.png");
  const env = {
    PHOTOCTL_NO_DAEMON: "0",
    PHOTOCTL_CACHE: join(directory, "cache"),
    PHOTOCTL_VOLUME_MAP: `${directory}=crop-fixture:online`,
  };
  const run = async (args: string[]) => {
    const result = await spawnPhotoctl(args, { libraryDir: library, env });
    expect(result.code, JSON.stringify(result.json)).toBe(0);
    return result.json;
  };
  try {
    const width = 320;
    const height = 240;
    const pixels = Buffer.alloc(width * height * 3);
    const radians = (12 * Math.PI) / 180;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u =
          Math.cos(radians) * (x - width / 2) + Math.sin(radians) * (y - height / 2) + width / 2;
        const v =
          -Math.sin(radians) * (x - width / 2) + Math.cos(radians) * (y - height / 2) + height / 2;
        let color = v < 100 ? [90, 165, 225] : [45, 75, 30];
        if ((u - 235) ** 2 + (v - 58) ** 2 < 13 ** 2) color = [245, 195, 55];
        if (u > 62 && u < 68 && v > 93 && v < 132) color = [105, 60, 35];
        if (Math.abs(u - 65) < (v - 55) * 0.45 && v > 55 && v < 101) color = [25, 95, 50];
        pixels.set(color, (y * width + x) * 3);
      }
    }
    await sharp(pixels, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(source);
    const original = await readFile(source);
    await run(["init", "--path", library]);
    const imported = await run(["import", source, "--link"]);
    const id = (imported.data as { ids: string[] }).ids[0]!;
    const before = showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data);
    const result = await run(["crop", id, "--auto"]);
    expect(result).toMatchObject({ data: { id, auto: { detected: true } } });
    expect((result.data as { auto: { correction_deg: number } }).auto.correction_deg).toBeCloseTo(
      -12,
      0,
    );
    const shown = showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data);
    expect(shown.develop.straighten_deg).toBeCloseTo(-12, 0);
    expect(await readFile(source)).toEqual(original);
    const exported = await run([
      "export",
      id,
      "--to",
      join(directory, "delivery"),
      "--format",
      "png",
    ]);
    expect(exported).toMatchObject({ results: [{ ok: true, render_hash: shown.render_hash }] });
    const exportPath = (exported.results as Array<{ file: string }>)[0]!.file;
    const previewPixels = await sharp(shown.preview).removeAlpha().raw().toBuffer();
    const exportPixels = await sharp(exportPath).removeAlpha().raw().toBuffer();
    expect(previewPixels.length).toBe(exportPixels.length);
    let total = 0;
    for (let i = 0; i < previewPixels.length; i++)
      total += Math.abs(previewPixels[i]! - exportPixels[i]!);
    expect(total / previewPixels.length).toBeLessThan(3);
    expect(await readFile(before.preview)).not.toEqual(await readFile(shown.preview));
    const destination = process.env.PHOTOCTL_CROP_CAPTURE_DIR;
    if (destination) {
      await mkdir(destination, { recursive: true });
      await Promise.all(
        Object.entries({
          before: before.preview,
          after: shown.preview,
          export: exportPath,
        }).map(async ([name, path]) => {
          await sharp(path)
            .png()
            .toFile(join(destination, `${name}.png`));
          const { width: w, height: h } = await sharp(path).metadata();
          await sharp(path)
            .extract({
              left: Math.floor(w! / 2) - 64,
              top: Math.floor(h! / 2) - 48,
              width: 128,
              height: 64,
            })
            .resize(512, 256, { kernel: "nearest" })
            .png()
            .toFile(join(destination, `${name}-detail.png`));
        }),
      );
    }
    await run(["undo", id]);
    const manual = await run(["crop", id, "--straighten", String(shown.develop.straighten_deg)]);
    expect(manual).toMatchObject({ data: { render_hash: shown.render_hash, auto: null } });
    const manualPreview = showDataSchema.parse(
      (await run(["show", id, "--preview-size", "native"])).data,
    );
    expect(await readFile(manualPreview.preview)).toEqual(await readFile(shown.preview));
  } finally {
    await spawnPhotoctl(["daemon", "stop"], { libraryDir: library, env });
    await rm(directory, { recursive: true });
  }
}, 30_000);
