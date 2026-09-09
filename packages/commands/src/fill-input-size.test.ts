import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLibrary } from "@photoctl/library";
import { GatewayClient, GatewayImageModelAdapter } from "@photoctl/providers";
import { fillStrictDataSchema } from "@photoctl/protocol";
import { artifactPath, readArtifactLinear } from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([false, true])(
  "fill caps provider inputs while full-res and refresh preserve the chosen sampling (cropped: %s)",
  async (cropped) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-input-size-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const server = await startGatewayFixture();
    try {
      const source = join(parent, "source.png");
      await sharp({ create: { width: 2048, height: 32, channels: 3, background: "#864" } })
        .png()
        .toFile(source);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Gateway unavailable");
      const gateway = new GatewayClient({
        apiKey: "fixture",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
      const sent: Array<{ image: number[]; mask: number[] }> = [];
      const outsideSamples: Array<{ image: number[]; mask: number }> = [];
      const context = {
        version: "test",
        library: handle,
        fill: {
          model: "fixture/native-image-v1",
          adapter: new GatewayImageModelAdapter({
            model: "fixture/native-image-v1",
            mask: "native",
            maskPolarity: "white-edits",
          }),
          gateway: {
            imageEdits: async (form: FormData) => {
              const dimensions = async (name: string) => {
                const file = form.get(name) as File;
                const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata();
                return [meta.width!, meta.height!];
              };
              sent.push({ image: await dimensions("image"), mask: await dimensions("mask") });
              const image = await sharp(
                Buffer.from(await (form.get("image") as File).arrayBuffer()),
              )
                .raw()
                .toBuffer({ resolveWithObject: true });
              const mask = await sharp(Buffer.from(await (form.get("mask") as File).arrayBuffer()))
                .extractChannel(0)
                .raw()
                .toBuffer();
              const row = image.info.height === 24 ? 8 : 12;
              outsideSamples.push({
                image: [
                  ...image.data.subarray(
                    row * image.info.width * 3,
                    row * image.info.width * 3 + 3,
                  ),
                ],
                mask: mask[row * image.info.width]!,
              });
              return await gateway.imageEdits(form);
            },
          },
        },
      };
      const command = async (verb: string, args: string[]) => {
        const result = await dispatch(
          {
            verb,
            args,
            cwd: parent,
            env: {
              noDaemon: true,
              cacheRoot: join(parent, "cache"),
              volumeMap: `${parent}=fixture:online`,
            },
          },
          context,
        );
        expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
        if (!result.ok) throw new Error("Expected success");
        return "data" in result ? result.data : result;
      };
      const { ids } = (await command("import", [source, "--link"])) as { ids: string[] };
      const id = ids[0]!;
      if (cropped) await command("develop", [id, "--set", 'crop={"x":1,"y":0,"w":2047,"h":32}']);
      const { layer_id: layer } = (await command("segment", [
        id,
        "--box",
        cropped ? "0,8,2016,8" : "16,8,2000,8",
      ])) as {
        layer_id: string;
      };
      const filled = fillStrictDataSchema.parse(
        await command("fill", [id, "--layer", layer, "--remove", "--no-upscale"]),
      );
      expect(sent).toEqual([{ image: [1536, 24], mask: [1536, 24] }]);
      if (cropped) expect(outsideSamples[0]).toEqual({ image: [0, 0, 0], mask: 0 });
      expect(filled.upscale.target).toEqual({ w: 2048, h: 32 });
      const node = (await command("graph", ["node", id, filled.generation.node])) as {
        parameters: { request: unknown };
        input_node_ids: string[];
      };
      expect(node.parameters.request).toMatchObject({
        crop: [0, 0, 2048, 32],
        sent: [1536, 24],
        full_res: false,
      });
      await command("show", [id, "--preview-size", "native"]);
      const cachedPixels = async (nodeId: string) => {
        const executions = await handle.query<{ output_artifact_hash: `a_${string}` }>(
          "SELECT DISTINCT output_artifact_hash FROM node_executions WHERE photo_id = $1 AND node_id = $2",
          [id, nodeId],
        );
        expect(executions.rows).toHaveLength(1);
        const hash = executions.rows[0]!.output_artifact_hash;
        return await readArtifactLinear(artifactPath(handle.path, hash, "tif"), hash);
      };
      const base = await cachedPixels(node.input_node_ids[0]!);
      const output = await cachedPixels(filled.graph.output_node);
      expect([output.w, output.h]).toEqual([cropped ? 2047 : 2048, 32]);
      expect(output.data.slice(0, 3)).toEqual(base.data.slice(0, 3));
      const inside = (12 * output.w + 1024) * 3;
      expect(output.data.slice(inside, inside + 3)).not.toEqual(
        base.data.slice(inside, inside + 3),
      );
      await command("layer", ["refresh", id, layer, "--from", filled.generation.node]);
      expect(sent.at(-1)).toEqual({ image: [1536, 24], mask: [1536, 24] });
      const full = fillStrictDataSchema.parse(
        await command("fill", [id, "--layer", layer, "--remove", "--no-upscale", "--full-res"]),
      );
      expect(sent).toHaveLength(3);
      expect(sent.at(-1)).toEqual({ image: [2048, 32], mask: [2048, 32] });
      await command("layer", ["refresh", id, layer, "--from", full.generation.node]);
      expect(sent).toHaveLength(4);
      expect(sent.at(-1)).toEqual({ image: [2048, 32], mask: [2048, 32] });
      if (cropped)
        expect(outsideSamples).toEqual(
          Array.from({ length: 4 }, () => ({ image: [0, 0, 0], mask: 0 })),
        );
    } finally {
      await handle.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(parent, { recursive: true });
    }
  },
);
