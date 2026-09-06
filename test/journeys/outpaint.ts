import { openLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import {
  exportResultSchema,
  fillStrictDataSchema,
  importDataSchema,
  showDataSchema,
} from "@photoctl/protocol";
import { spawnPhotoctl, startGatewayFixture } from "@photoctl/test-harness";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";

export function registerOutpaintJourney(
  invoke: typeof spawnPhotoctl = spawnPhotoctl,
  title = "built CLI preserves outpaint pixels through repeat, removal, undo, refresh and offline export",
) {
  test(title, async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-outpaint-journey-"));
    const source = join(directory, "source.png");
    const library = join(directory, "library");
    let calls = 0;
    const server = await startGatewayFixture(0, {
      imageMode: "checkerboard",
      onRequest: ({ path }) => {
        if (path === "/v1/images/edits") calls++;
      },
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No fixture gateway");
      const env = {
        AI_GATEWAY_API_KEY: "fixture-key",
        PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=fixture-volume:online`,
      };
      const pixels = Buffer.alloc(192 * 128 * 3);
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 192; x++) {
          const index = (y * 192 + x) * 3;
          pixels[index] = x;
          pixels[index + 1] = y;
          pixels[index + 2] = (x + y) % 256;
        }
      await sharp(pixels, { raw: { width: 192, height: 128, channels: 3 } })
        .png()
        .toFile(source);
      const run = async (args: string[]) => {
        const result = await invoke(args, { libraryDir: library, env });
        expect(
          result.code,
          `${args.join(" ")}: ${JSON.stringify(result.json)} ${JSON.stringify(result.events)}`,
        ).toBe(0);
        return result.json;
      };
      await run(["init", "--path", library]);
      const handle = await openLibrary(library, { noDaemon: true });
      try {
        await handle.query(
          `INSERT INTO settings (key, value) VALUES ('models', $1::jsonb), ('providers', $2::jsonb)
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [
            JSON.stringify({ edit: FAKE_IMAGE_EDIT_MODEL, upscale: "photoctl/fake-upscale-v1" }),
            JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } }),
          ],
        );
      } finally {
        await handle.close();
      }
      const imported = await run(["import", source, "--link"]);
      const id = importDataSchema.parse(imported.data).ids[0]!;
      await run([
        "develop",
        id,
        "--set",
        'crop={"x":20,"y":30,"w":80,"h":60}',
        "--set",
        "rotate=90",
      ]);
      const exported = async (name: string) => {
        const result = await run(["export", id, "--to", join(directory, name), "--format", "png"]);
        const file = exportResultSchema.parse(result.results![0]).file;
        const capture = process.env.PHOTOCTL_OUTPAINT_CAPTURE_DIR;
        if (capture) {
          await mkdir(capture, { recursive: true });
          await copyFile(file, join(capture, `${name}.png`));
        }
        return await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      };
      const baseline = await exported("baseline");
      expect([baseline.info.width, baseline.info.height]).toEqual([60, 80]);
      const fill = async (px: number) => {
        const result = await run([
          "fill",
          id,
          "--outpaint",
          "--px",
          String(px),
          "--prompt",
          "continue the scene",
        ]);
        expect(result).toMatchObject({
          data: { upscale: { executed: false, density_satisfied: true } },
        });
        return fillStrictDataSchema.parse(result.data);
      };
      await fill(8);
      const aBefore = await exported("a-before-retouch");
      expect([aBefore.info.width, aBefore.info.height]).toEqual([76, 96]);
      expect(
        await sharp(aBefore.data, { raw: aBefore.info })
          .extract({ left: 8, top: 8, width: 60, height: 80 })
          .raw()
          .toBuffer(),
      ).toEqual(baseline.data);
      await run(["retouch", id, "--at", "18,34", "--radius", "1"]);
      const a = await exported("a-retouched");
      expect(a.data.equals(aBefore.data)).toBe(false);
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 76; x++) {
          // The authored quarter-turn puts this radius-one circle at raster center (64, 6).
          if ((x === 63 || x === 64) && (y === 5 || y === 6)) continue;
          const index = (y * 76 + x) * 3;
          expect(
            a.data.subarray(index, index + 3).equals(aBefore.data.subarray(index, index + 3)),
          ).toBe(true);
        }
      expect(
        await sharp(a.data, { raw: a.info })
          .extract({ left: 8, top: 8, width: 60, height: 80 })
          .raw()
          .toBuffer(),
      ).toEqual(baseline.data);
      expect(calls).toBe(1);
      const bLayer = (await fill(4)).graph.layer;
      const b = await exported("b");
      expect([b.info.width, b.info.height]).toEqual([84, 104]);
      expect(
        await sharp(b.data, { raw: b.info })
          .extract({ left: 4, top: 4, width: 76, height: 96 })
          .raw()
          .toBuffer(),
      ).toEqual(a.data);
      await run(["layer", "remove", id, bLayer]);
      expect((await exported("removed")).data).toEqual(a.data);
      await run(["undo", id]);
      expect((await exported("undone")).data).toEqual(b.data);
      expect(calls).toBe(2);
      await run(["layer", "refresh", id, bLayer]);
      const refreshed = await exported("refreshed");
      expect(refreshed.data).toEqual(b.data);
      expect(calls).toBe(3);
      const online = await run(["show", id, "--preview-size", "native"]);
      await rename(source, `${source}.disconnected`);
      env.PHOTOCTL_VOLUME_MAP = `${directory}=fixture-volume:offline`;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      const shownOffline = await run(["show", id, "--preview-size", "native"]);
      expect(shownOffline.data).toMatchObject({
        render_hash: showDataSchema.parse(online.data).render_hash,
        preview_info: { cache_source: "exact_view" },
      });
      expect(shownOffline.warnings).toContainEqual(
        expect.objectContaining({ code: "source_offline" }),
      );
      const offline = await exported("offline");
      expect(offline.data.equals(refreshed.data)).toBe(true);
      expect(calls).toBe(3);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
}
