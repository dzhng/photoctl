import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "vitest";
import { openLibrary } from "@photoctl/library";

const execute = promisify(execFile);

test("the keyless gold exam imports, lists, rates, exports, and reports ten photos", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-gold-dry-"));
  const source = join(directory, "source");
  const existing = join(directory, "existing");
  const output = join(directory, "delivery");
  const library = join(directory, "library");
  const cache = join(directory, "cache");
  await Promise.all([mkdir(source), mkdir(existing)]);
  try {
    await Promise.all(
      Array.from(
        { length: 10 },
        async (_, index) =>
          await sharp({
            create: {
              width: 120 + index,
              height: 80,
              channels: 3,
              background: { r: 20 * index, g: 100, b: 180 },
            },
          })
            .jpeg()
            .toFile(join(source, `frame-${String(index + 1).padStart(2, "0")}.jpg`)),
      ),
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
      export: {
        summary: { ok: number };
        results: Array<{ id: string; render_hash: string }>;
      };
    };
    expect(report.import.data.imported).toBe(10);
    expect(report.list.data.rows).toHaveLength(10);
    expect(report.rate.summary.ok).toBe(10);
    expect(report.export.summary.ok).toBe(10);
    expect(report.export.results.map((item) => item.id).toSorted()).toEqual(
      report.import.data.ids.toSorted(),
    );
    expect(report.export.results.every((item) => /^r_[0-9a-f]{64}$/u.test(item.render_hash))).toBe(
      true,
    );
    expect((await readdir(output)).filter((name) => name.endsWith(".jpg"))).toHaveLength(10);
    await expect(readFile(join(directory, "out", "wb", "export.html"), "utf8")).resolves.toContain(
      "10 delivery files",
    );
  } finally {
    await rm(directory, { recursive: true });
  }
}, 60_000);
