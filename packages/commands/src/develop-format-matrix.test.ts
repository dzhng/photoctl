// oxlint-disable no-await-in-loop -- isolate the native decoder cases to bound peak memory
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { initializeLibrary } from "@photoctl/library";
import { dispatch } from "./dispatch.js";

test("develop renders whole-file, embedded-container, and extensionless inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-develop-formats-"));
  try {
    const whole = join(directory, "whole.png");
    const extensionless = join(directory, "extensionless");
    await sharp({ create: { width: 18, height: 12, channels: 3, background: "#456" } })
      .png()
      .toFile(whole);
    await copyFile(whole, extensionless);

    const cases = [
      { name: "whole-file", source: whole, volumeRoot: directory },
      {
        name: "embedded-container",
        source: resolve("fixtures/a7c2.ARW"),
        volumeRoot: resolve("."),
      },
      { name: "extensionless", source: extensionless, volumeRoot: directory },
    ];
    const results = [];
    for (const entry of cases) {
      const libraryPath = join(directory, `library-${entry.name}`);
      const initialized = await initializeLibrary(libraryPath);
      try {
        const env = {
          noDaemon: true,
          libraryPath,
          cacheRoot: join(directory, `cache-${entry.name}`),
          volumeMap: `${entry.volumeRoot}=fixture-volume:online`,
        };
        const imported = await dispatch(
          { verb: "import", args: [entry.source, "--link"], cwd: directory, env },
          { version: "test", library: initialized.handle },
        );
        if (!imported.ok || !("data" in imported)) throw new Error(`${entry.name} import failed`);
        const id = (imported.data as { ids: string[] }).ids[0];
        const developed = await dispatch(
          {
            verb: "develop",
            args: [
              id,
              "--set",
              "exposure=0.5",
              'selective_color={"blue":{"hue":15,"saturation":10,"luminance":-5}}',
            ],
            cwd: directory,
            env,
          },
          { version: "test", library: initialized.handle },
        );
        const rendered = await dispatch(
          {
            verb: "render",
            args: [id, "--linear", "--to", join(directory, `${entry.name}.tif`)],
            cwd: directory,
            env,
          },
          { version: "test", library: initialized.handle },
        );
        results.push({ developed, rendered });
      } finally {
        await initialized.handle.close();
      }
    }

    for (const result of results) {
      expect(result.developed).toMatchObject({
        schema: 1,
        ok: true,
        summary: { ok: 1, failed: 0 },
        results: [
          {
            ok: true,
            develop_hash: expect.stringMatching(/^h_[0-9a-f]{64}$/u),
            render_hash: expect.stringMatching(/^r_[0-9a-f]{64}$/u),
          },
        ],
      });
      expect(result.rendered).toMatchObject({
        schema: 1,
        ok: true,
        data: { w: expect.any(Number), h: expect.any(Number), space: "scene-linear-rec2020" },
      });
    }
  } finally {
    await rm(directory, { recursive: true });
  }
}, 90_000);
