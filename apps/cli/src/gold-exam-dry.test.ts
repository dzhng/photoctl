import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "vitest";
import { openLibrary } from "@photoctl/library";

const execute = promisify(execFile);

test("the keyless gold exam develops three people presets before exporting ten photos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-gold-dry-"));
  const source = join(directory, "source");
  const existing = join(directory, "existing");
  const output = join(directory, "delivery");
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  await Promise.all([mkdir(source), mkdir(existing)]);
  try {
    await Promise.all(
      Array.from({ length: 10 }, async (_, index) => {
        const width = 120 + index;
        const height = 80;
        const pixels = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * 3;
            const value = Math.round(40 + (215 * x) / (width - 1));
            pixels[offset] = value;
            pixels[offset + 1] = Math.max(0, value - 12);
            pixels[offset + 2] = Math.max(0, value - 24);
          }
        }
        await sharp(pixels, { raw: { width, height, channels: 3 } })
          .jpeg({ quality: 95 })
          .toFile(join(source, `frame-${String(index + 1).padStart(2, "0")}.jpg`));
      }),
    );

    const env = {
      ...process.env,
      PATH: `${resolve("node_modules/.bin")}:${process.env.PATH ?? ""}`,
      PHOTOCTL_NO_DAEMON: "1",
      PHOTOCTL_LIBRARY: library,
      PHOTOCTL_CACHE: cache,
      PHOTOCTL_VOLUME_MAP: `${directory}=fixture-volume:online`,
    };
    await execute(resolve("node_modules/.bin/photoctl"), ["init", "--path", library], {
      cwd: directory,
      env,
    });
    const existingFile = join(existing, "already-here.jpg");
    await sharp({ create: { width: 90, height: 60, channels: 3, background: "#246" } })
      .jpeg()
      .toFile(existingFile);
    const existingImport = JSON.parse(
      (
        await execute(resolve("node_modules/.bin/photoctl"), ["import", existingFile, "--link"], {
          cwd: directory,
          env,
        })
      ).stdout,
    ) as { data: { ids: string[] } };
    const opened = await openLibrary(library);
    await opened.query(`UPDATE photos SET shot_at = '2000-01-01T00:00:00Z' WHERE id = $1`, [
      existingImport.data.ids[0],
    ]);
    await opened.close();
    await execute(resolve("scripts/gold-exam.sh"), [source, "--out", output], {
      cwd: directory,
      env,
      timeout: 60_000,
    });

    const report = JSON.parse(await readFile(join(output, "gold-exam-report.json"), "utf8")) as {
      import: { data: { imported: number; ids: string[] } };
      list: { data: { rows: unknown[] } };
      rate: { summary: { ok: number } };
      develop: { summary: { ok: number }; results: Array<{ id: string }> };
      export: {
        summary: { ok: number };
        results: Array<{ id: string; render_hash: string }>;
      };
    };
    expect(report.import.data.imported).toBe(10);
    expect(report.list.data.rows).toHaveLength(10);
    expect(report.rate.summary.ok).toBe(10);
    expect(report.develop.summary.ok).toBe(3);
    expect(report.develop.results.map((item) => item.id).toSorted()).toEqual(
      report.import.data.ids.slice(0, 3).toSorted(),
    );
    expect(report.export.summary.ok).toBe(10);
    expect(report.export.results.map((item) => item.id).toSorted()).toEqual(
      report.import.data.ids.toSorted(),
    );
    expect(report.export.results.every((item) => /^r_[0-9a-f]{64}$/u.test(item.render_hash))).toBe(
      true,
    );
    expect((await readdir(output)).filter((name) => name.endsWith(".jpg"))).toHaveLength(10);
    const highlights = await Promise.all(
      [1, 2, 3].map(async (index) => {
        const name = `frame-${String(index).padStart(2, "0")}.jpg`;
        return {
          developed: await luminanceP98(join(output, name)),
          neutral: await luminanceP98(join(source, name)),
        };
      }),
    );
    expect(highlights.every(({ developed, neutral }) => developed < neutral)).toBe(true);
    await expect(readFile(join(directory, "out", "wb", "export.html"), "utf8")).resolves.toContain(
      "10 delivery files",
    );
  } finally {
    await rm(directory, { recursive: true });
  }
}, 60_000);

async function luminanceP98(path: string): Promise<number> {
  const { data } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 3) {
    values.push(0.2126 * data[offset]! + 0.7152 * data[offset + 1]! + 0.0722 * data[offset + 2]!);
  }
  values.sort((left, right) => left - right);
  return values[Math.floor((values.length - 1) * 0.98)]!;
}
