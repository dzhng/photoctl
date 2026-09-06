import { openLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import {
  exportResultSchema,
  fillStrictDataSchema,
  importDataSchema,
  showDataSchema,
} from "@photoctl/protocol";
import { loadActiveDocument, readValidPreviewArtifact } from "@photoctl/render";
import { spawnPhotoctl, startGatewayFixture } from "@photoctl/test-harness";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";

export function registerColdOutpaintJourney(invoke: typeof spawnPhotoctl = spawnPhotoctl) {
  test("cold offline outpaint retains its native border and promotes original detail after reconnect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-outpaint-cold-"));
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
      if (!address || typeof address === "string") throw new Error("Missing fixture gateway");
      const env = {
        AI_GATEWAY_API_KEY: "fixture-key",
        PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=fixture-volume:online`,
      };
      const pixels = Buffer.alloc(2000 * 1320 * 3);
      for (let y = 0; y < 1320; y++)
        for (let x = 0; x < 2000; x++) {
          const at = (y * 2000 + x) * 3;
          pixels[at] = x % 2 ? 180 : 35;
          pixels[at + 1] = 40 + (y % 97);
          pixels[at + 2] = 60 + (x % 113);
        }
      await sharp(pixels, { raw: { width: 2000, height: 1320, channels: 3 } })
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
      const single = async (args: string[]) => {
        const response = await run(args);
        if (!("data" in response)) throw new Error("Expected single-result command response");
        return response;
      };
      await run(["init", "--path", library]);
      const handle = await openLibrary(library, { noDaemon: true });
      try {
        await handle.query(
          "INSERT INTO settings (key, value) VALUES ('models', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [JSON.stringify({ edit: FAKE_IMAGE_EDIT_MODEL })],
        );
      } finally {
        await handle.close();
      }
      const id = importDataSchema.parse((await single(["import", source, "--link"])).data).ids[0]!;
      await run([
        "develop",
        id,
        "--set",
        'crop={"x":40,"y":30,"w":83,"h":61}',
        "--set",
        "rotate=90",
        "--set",
        "straighten_deg=5",
      ]);
      const border = fillStrictDataSchema.parse(
        (
          await single([
            "fill",
            id,
            "--outpaint",
            "--px",
            "7",
            "--prompt",
            "continue the scene",
            "--no-upscale",
          ])
        ).data,
      );
      await run(["develop", id, "--set", "exposure=0.5"]);
      const inspect = await openLibrary(library, { noDaemon: true });
      try {
        const document = (await loadActiveDocument(inspect, id))!;
        const rows = await inspect.query(
          "SELECT execution_id FROM node_executions WHERE photo_id = $1 AND node_id = $2",
          [id, document.roots.output],
        );
        expect(rows.rows).toEqual([]);
      } finally {
        await inspect.close();
      }
      await rename(source, `${source}.disconnected`);
      env.PHOTOCTL_VOLUME_MAP = `${directory}=fixture-volume:offline`;
      const shownResponse = await single(["show", id, "--preview-size", "native"]);
      const shown = showDataSchema.parse(shownResponse.data);
      expect(shownResponse.warnings).toContainEqual(
        expect.objectContaining({ code: "source_offline" }),
      );
      expect(shown.preview_info).toMatchObject({
        source_tier: "pinned-preview",
        pixel_scale: 1,
        resolution_limited: false,
      });
      const offlineFrame = (await readValidPreviewArtifact(shown.preview))!.frame;
      expect(offlineFrame.source).toEqual({ w: 1616, h: 1067 });
      expect(shown.preview_info.actual).toMatchObject(border.generation.returned);
      const exported = async (name: string) => {
        const processResult = await invoke(
          ["export", id, "--to", join(directory, name), "--format", "png"],
          { libraryDir: library, env },
        );
        expect(processResult.code, JSON.stringify(processResult.json)).toBe(0);
        const response = processResult.json;
        if (!("results" in response) || !response.results)
          throw new Error("Expected export result response");
        const result = exportResultSchema.parse(response.results[0]);
        const capture = process.env.PHOTOCTL_OUTPAINT_CAPTURE_DIR;
        if (capture) {
          await mkdir(capture, { recursive: true });
          await copyFile(result.file, join(capture, `${name}.png`));
        }
        return {
          response,
          result,
          image: await sharp(result.file).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
        };
      };
      const offline = await exported("offline");
      expect(offline.result.render_hash).toBe(shown.render_hash);
      expect([offline.image.info.width, offline.image.info.height]).toEqual([
        offlineFrame.raster.w,
        offlineFrame.raster.h,
      ]);
      expect(calls).toBe(1);
      const refreshed = await single(["layer", "refresh", id, border.graph.layer]);
      expect(refreshed.data).toMatchObject({
        source_context: { tier: "pinned-preview", resolution_limited: true },
      });
      expect(calls).toBe(2);
      await run(["develop", id, "--set", "exposure=0.75"]);
      const coldExportHandle = await openLibrary(library, { noDaemon: true });
      try {
        const document = (await loadActiveDocument(coldExportHandle, id))!;
        const rows = await coldExportHandle.query(
          "SELECT execution_id FROM node_executions WHERE photo_id = $1 AND node_id = $2",
          [id, document.roots.output],
        );
        expect(rows.rows).toEqual([]);
      } finally {
        await coldExportHandle.close();
      }
      const refreshedOffline = await exported("cold-refreshed-offline");
      expect(refreshedOffline.response.warnings).toContainEqual(
        expect.objectContaining({ code: "source_offline" }),
      );
      const refreshedShown = showDataSchema.parse(
        (await single(["show", id, "--preview-size", "native"])).data,
      );
      expect(refreshedShown.preview_info.source_tier).toBe("pinned-preview");
      expect((await readValidPreviewArtifact(refreshedShown.preview))!.frame.source).toEqual({
        w: 1616,
        h: 1067,
      });
      expect(refreshedOffline.result.render_hash).toBe(refreshedShown.render_hash);
      expect(calls).toBe(2);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await run(["layer", "set", id, border.graph.layer, "--enabled", "false"]);
      const disabled = showDataSchema.parse(
        (await single(["show", id, "--preview-size", "native"])).data,
      );
      expect(disabled.preview_info.source_tier).toBe("pinned-preview");
      expect(disabled.preview_info.pixel_scale).toBeLessThan(1);
      expect(disabled.preview_info.resolution_limited).toBe(true);
      const disabledExport = await exported("disabled");
      expect(disabledExport.image.info.width).toBe(disabled.preview_info.actual.w);
      expect(disabledExport.image.info.height).toBe(disabled.preview_info.actual.h);
      await run(["undo", id]);
      expect((await exported("undone")).image.data).toEqual(refreshedOffline.image.data);
      await rename(`${source}.disconnected`, source);
      env.PHOTOCTL_VOLUME_MAP = `${directory}=fixture-volume:online`;
      const reconnected = showDataSchema.parse(
        (await single(["show", id, "--preview-size", "native"])).data,
      );
      expect(reconnected.render_hash).toBe(refreshedShown.render_hash);
      expect(reconnected.preview_info.source_tier).toBe("online-file");
      expect((await readValidPreviewArtifact(reconnected.preview))!.frame.source).toEqual({
        w: 2000,
        h: 1320,
      });
      const online = await exported("reconnected");
      expect(online.image.data.equals(refreshedOffline.image.data)).toBe(false);
      expect(online.image.info).toEqual(refreshedOffline.image.info);
      expect(online.image.data.subarray(0, online.image.info.width * 2 * 3)).toEqual(
        refreshedOffline.image.data.subarray(0, refreshedOffline.image.info.width * 2 * 3),
      );
      expect(calls).toBe(2);
    } finally {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
}
