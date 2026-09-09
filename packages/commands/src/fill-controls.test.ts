import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLibrary } from "@photoctl/library";
import {
  FAKE_IMAGE_EDIT_MODEL,
  GatewayClient,
  GatewayImageModelAdapter,
} from "@photoctl/providers";
import { fillStrictDataSchema } from "@photoctl/protocol";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([
  { model: FAKE_IMAGE_EDIT_MODEL, supported: true },
  { model: "fixture/unsupported-init", supported: false },
])(
  "fill repeat and refresh retain immutable reference/init intent ($model)",
  async ({ model, supported }) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-fill-controls-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const server = await startGatewayFixture();
    try {
      const source = join(parent, "source.png");
      const reference = join(parent, "reference.png");
      await sharp({ create: { width: 32, height: 32, channels: 3, background: "#888" } })
        .png()
        .toFile(source);
      await sharp({ create: { width: 3, height: 2, channels: 4, background: "#ff000080" } })
        .png()
        .toFile(reference);
      const sent: Array<{ init: string | null; references: number[][]; referenceBytes: string[] }> =
        [];
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture unavailable");
      const gateway = new GatewayClient({
        apiKey: "fixture",
        baseUrl: `http://127.0.0.1:${address.port}`,
        fetch: async (url, options) => {
          const request = new Request(url, options);
          const form = await request.clone().formData();
          const references = await Promise.all(
            form
              .getAll("image[]")
              .slice(1)
              .map(async (file) => {
                const bytes = Buffer.from(await (file as File).arrayBuffer());
                const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
                return { pixels: Array.from(pixels), bytes: bytes.toString("base64") };
              }),
          );
          sent.push({
            init: form.get("init") as string | null,
            references: references.map(({ pixels }) => pixels),
            referenceBytes: references.map(({ bytes }) => bytes),
          });
          return await fetch(request);
        },
      });
      const context = {
        version: "test",
        library: handle,
        fill: {
          model,
          adapter: new GatewayImageModelAdapter({
            model,
            mask: "instruction+composite",
            maskPolarity: "unverified",
          }),
          gateway,
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
        if (!result.ok || !("data" in result)) throw new Error("Expected command success");
        if (verb === "fill" || (verb === "layer" && args[0] === "refresh")) {
          const requestedInit = args.includes("--init") ? args[args.indexOf("--init") + 1] : "fill";
          expect(
            result.warnings
              .filter(({ code }) => code === "provider_warning")
              .map(({ message }) => message),
          ).toEqual(
            supported
              ? []
              : [
                  `Initialization ${requestedInit} is unsupported by ${model}; original initialization was used`,
                ],
          );
        }
        return result.data;
      };
      const { ids } = (await command("import", [source, "--link"])) as { ids: string[] };
      const id = ids[0]!;
      const { layer_id: layer } = (await command("segment", [id, "--box", "8,8,8,8"])) as {
        layer_id: string;
      };
      const args = [
        id,
        "--layer",
        layer,
        "--prompt",
        "a red vase",
        "--fit",
        "strict",
        "--pad",
        "0",
        "--no-upscale",
        "--ref",
        reference,
        "--init",
        "noise",
      ];
      const first = fillStrictDataSchema.parse(await command("fill", args));
      const repeat = fillStrictDataSchema.parse(await command("fill", args));
      expect(repeat.generation.node).toBe(first.generation.node);
      expect(sent).toMatchObject([
        {
          init: supported ? "noise" : null,
          references: [Array.from({ length: 6 }, () => [255, 0, 0, 128]).flat()],
        },
      ]);
      const node = (await command("graph", ["node", id, first.generation.node])) as {
        input_node_ids: string[];
        parameters: { request: unknown };
      };
      expect(node.input_node_ids).toHaveLength(2);
      expect(node.parameters.request).toMatchObject({
        controls: {
          requested_init: "noise",
          applied_init: supported ? "noise" : "original",
          reference_used: true,
        },
      });
      await sharp({ create: { width: 3, height: 2, channels: 4, background: "#0000ff80" } })
        .png()
        .toFile(reference);
      const changedReference = fillStrictDataSchema.parse(await command("fill", args));
      expect(changedReference.generation.node).not.toBe(first.generation.node);
      expect(sent).toHaveLength(2);
      expect(sent[1]).toMatchObject({
        init: supported ? "noise" : null,
        references: [Array.from({ length: 6 }, () => [0, 0, 255, 128]).flat()],
      });
      const changedInit = fillStrictDataSchema.parse(
        await command("fill", [...args.slice(0, -1), "fill"]),
      );
      expect(changedInit.generation.node).not.toBe(changedReference.generation.node);
      expect(sent).toHaveLength(3);
      expect(sent[2]).toEqual({ ...sent[1], init: supported ? "fill" : null });
      await sharp({ create: { width: 3, height: 2, channels: 4, background: "#0000ff40" } })
        .png()
        .toFile(reference);
      const changedAlpha = fillStrictDataSchema.parse(
        await command("fill", [...args.slice(0, -1), "fill"]),
      );
      expect(changedAlpha.generation.node).not.toBe(changedInit.generation.node);
      expect(sent).toHaveLength(4);
      expect(sent[3]).toMatchObject({
        init: supported ? "fill" : null,
        references: [Array.from({ length: 6 }, () => [0, 0, 255, 64]).flat()],
      });
      await rm(reference);
      await command("layer", ["refresh", id, layer]);
      expect(sent).toEqual([sent[0], sent[1], sent[2], sent[3], sent[3]]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await handle.close();
      await rm(parent, { recursive: true });
    }
  },
);
