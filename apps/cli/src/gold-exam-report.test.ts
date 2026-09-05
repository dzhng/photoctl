import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, test } from "vitest";

const execute = promisify(execFile);

test("gold evidence labels unknown sources, links actual deliveries safely and detects changed bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-gold-report-"));
  const output = join(directory, "delivery");
  await mkdir(output);
  const name = "portrait & <review> #1\r\\\n.jpg";
  const file = join(output, name);
  const source = join(directory, "<unverified & source>");
  try {
    const pixels = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#c48662" },
    })
      .jpeg()
      .toBuffer();
    await writeFile(file, pixels);
    await writeFile(join(output, "unrelated.jpg"), pixels);
    for (const verb of ["import", "list", "rate", "develop", "export"]) {
      await writeFile(
        join(directory, `${verb}.json`),
        JSON.stringify({
          ok: true,
          results:
            verb === "export"
              ? [
                  {
                    id: "photo-id",
                    ok: true,
                    file,
                    w: 120,
                    h: 80,
                    bytes: 1,
                    render_hash: `r_${"a".repeat(64)}`,
                    skipped: true,
                  },
                ]
              : [],
        }),
      );
    }
    await execute(process.execPath, [
      resolve("scripts/gold-exam-report.mjs"),
      directory,
      output,
      source,
    ]);
    const report = JSON.parse(await readFile(join(output, "gold-exam-report.json"), "utf8"));
    expect(report).toMatchObject({
      source_kind: "unverified",
      photographic_acceptance: "not_recorded",
      deliveries: [
        {
          file: name,
          bytes: pixels.length,
          sha256: createHash("sha256").update(pixels).digest("hex"),
        },
      ],
    });
    const html = await readFile(join(output, "report.html"), "utf8");
    expect(html).toContain("Source kind unverified");
    expect(html).toContain("&lt;unverified &amp; source&gt;");
    expect(html).toContain(`href="${encodeURIComponent(name)}"`);
    expect(html).toContain(`src="${encodeURIComponent(name)}"`);
    expect(html).not.toContain("unrelated.jpg");
    expect(html).toContain("pre-existing file; current-render match not verified");
    await execute("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: output });
    await writeFile(file, Buffer.from("changed delivery bytes"));
    await expect(
      execute("shasum", ["-a", "256", "-c", "SHA256SUMS"], { cwd: output }),
    ).rejects.toMatchObject({ code: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
