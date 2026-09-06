import { openLibrary } from "@photoctl/library";
import { FAKE_IMAGE_EDIT_MODEL } from "@photoctl/providers";
import { reimagineDataSchema, showDataSchema, exportResultSchema } from "@photoctl/protocol";
import { spawnPhotoctl, startGatewayFixture } from "@photoctl/test-harness";
import { copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";

export function registerFullFrameJourney(
  invoke: typeof spawnPhotoctl = spawnPhotoctl,
  title = "built CLI preserves full-frame source promotion and explicit refresh lifecycle",
) {
  test(title, async () => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-full-frame-journey-"));
    const library = join(directory, "library");
    const source = join(directory, "source.png");
    let calls = 0;
    const server = await startGatewayFixture(0, {
      imageMode: "smallerdims",
      onRequest: ({ path }) => {
        if (path === "/v1/images/edits") calls++;
      },
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing gateway");
      const env = {
        AI_GATEWAY_API_KEY: "fixture",
        PHOTOCTL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        PHOTOCTL_CACHE: join(directory, "cache"),
        PHOTOCTL_VOLUME_MAP: `${directory}=fixture:online`,
      };
      const run = async (args: string[]) => {
        const result = await invoke(args, { libraryDir: library, env });
        expect(result.code, `${args.join(" ")}: ${JSON.stringify(result.json)}`).toBe(0);
        return result.json;
      };
      const pixels = Buffer.alloc(160 * 120 * 3);
      for (let y = 0; y < 120; y++)
        for (let x = 0; x < 160; x++) {
          const i = (y * 160 + x) * 3;
          pixels[i] = (x * 7 + y) % 256;
          pixels[i + 1] = (y * 11 + x) % 256;
          pixels[i + 2] = (x + y) % 2 ? 240 : 20;
        }
      await sharp(pixels, { raw: { width: 160, height: 120, channels: 3 } })
        .png()
        .toFile(source);
      await run(["init", "--path", library]);
      const configured = await openLibrary(library, { noDaemon: true });
      try {
        await configured.query(
          "INSERT INTO settings (key,value) VALUES ('models',$1::jsonb),('providers',$2::jsonb)",
          [
            JSON.stringify({ edit: FAKE_IMAGE_EDIT_MODEL, upscale: "photoctl/fake-upscale-v1" }),
            JSON.stringify({ upscale: { "photoctl/fake-upscale-v1": { configured: true } } }),
          ],
        );
      } finally {
        await configured.close();
      }
      const imported = await run(["import", source, "--link"]);
      const id = (imported.data as { ids: string[] }).ids[0]!;
      const libraryId = ((await run(["doctor"])).data as { library_id: string }).library_id;
      const pinned = join(env.PHOTOCTL_CACHE, libraryId, "emb");
      await mkdir(pinned, { recursive: true });
      await sharp(source)
        .resize(80, 60)
        .jpeg()
        .toFile(join(pinned, `${id}.jpg`));
      await rename(source, `${source}.offline`);
      await run(["develop", id, "--set", 'crop={"x":20,"y":30,"w":80,"h":60}', "rotate=90"]);
      const show = async () =>
        showDataSchema.parse((await run(["show", id, "--preview-size", "native"])).data);
      const delivery = async (name: string) => {
        const output = await run(["export", id, "--to", join(directory, name), "--format", "png"]);
        const file = exportResultSchema.parse(output.results![0]).file;
        const capture = process.env.PHOTOCTL_FULL_FRAME_CAPTURE_DIR;
        if (capture) {
          await mkdir(capture, { recursive: true });
          await copyFile(file, join(capture, `${name}.png`));
        }
        return sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      };
      const before = await delivery("reduced-before");
      await rm(join(pinned, `${id}.jpg`));
      const edit = reimagineDataSchema.parse(
        (await run(["reimagine", id, "--prompt", "painted twilight", "--strength", "0.5"])).data,
      );
      expect(edit.source_context).toMatchObject({
        tier: "pinned-preview",
        pixel_scale: 0.5,
        resolution_limited: true,
      });
      expect(calls).toBe(1);
      const offline = await show();
      expect(offline.preview_info.resolution_limited).toBe(true);
      expect(offline.preview_info.source_tier).toBe("pinned-preview");
      const reduced = await delivery("reduced-generated");
      const paidIds = async () => {
        const handle = await openLibrary(library, { noDaemon: true });
        try {
          return (
            await handle.query<{ execution_id: string }>(
              "SELECT execution_id FROM node_executions WHERE photo_id=$1 AND provider_execution IS NOT NULL ORDER BY execution_id",
              [id],
            )
          ).rows;
        } finally {
          await handle.close();
        }
      };
      const purchased = await paidIds();
      await rename(`${source}.offline`, source);
      const native = await show();
      expect(native.preview_info.source_tier).toBe("online-file");
      expect(native.preview_info.resolution_limited).toBe(false);
      expect(offline.preview_info.base_to_view).toEqual({
        a: 0,
        b: 0.5,
        c: -0.5,
        d: 0,
        e: 45,
        f: -10,
      });
      expect(native.preview_info.base_to_view).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 90, f: -20 });
      const online = await delivery("native-generated");
      expect(online.info).toMatchObject({ width: 60, height: 80 });
      expect(online.data).not.toEqual(reduced.data);
      expect(await paidIds()).toEqual(purchased);
      expect(calls).toBe(1);
      const refreshed = await run(["layer", "refresh", id, edit.layer_id]);
      expect(calls).toBe(2);
      const refresh = refreshed.data as {
        generation: { node: string };
        upscale: { node: string };
        render_hash: string;
      };
      expect(refresh.generation.node).not.toBe(edit.generation.node);
      expect(refresh.upscale.node).toEqual(expect.any(String));
      const updated = await delivery("native-refreshed");
      const upscale = await run([
        "layer",
        "refresh",
        id,
        edit.layer_id,
        "--from",
        refresh.upscale.node,
      ]);
      expect(upscale.data).toMatchObject({
        executions: [
          { kind: "generate", node: refresh.generation.node, reused: true },
          { kind: "upscale", reused: false },
        ],
      });
      expect(calls).toBe(2);
      await run(["undo", id]);
      expect((await delivery("undo-upscale")).data).toEqual(updated.data);
      await run(["layer", "remove", id, edit.layer_id]);
      const restored = await delivery("native-restored");
      expect(restored.info).toMatchObject({ width: 60, height: 80 });
      expect(restored.data).not.toEqual(before.data);
      await run(["undo", id]);
      expect((await delivery("undo-remove")).data).toEqual(updated.data);
      expect(calls).toBe(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true });
    }
  }, 120_000);
}
