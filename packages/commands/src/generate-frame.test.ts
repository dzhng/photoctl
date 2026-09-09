import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
import {
  artifactPath,
  inspectGraphNode,
  inspectProviderImageAttempt,
  readArtifactImage,
} from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([
  [1001, 1000, 1008, 1008, 1001, 1000],
  [383, 384, 1152, 1152, 1149, 1152],
])(
  "generated %sx%s content excludes declared padding while retaining the raw canvas",
  async (w, h, canvasW, canvasH, contentW, contentH) => {
    const directory = await mkdtemp(join(tmpdir(), "openphoto-generate-frame-"));
    const handle = (await initializeLibrary(join(directory, "library"))).handle;
    const requests: Readonly<Record<string, unknown>>[] = [];
    const gateway = await startGatewayFixture(0, {
      imageMode: "checkerboard",
      onImageRequest: ({ fields }) => requests.push(fields),
    });
    try {
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("Fixture unavailable");
      const envelope = await dispatch(
        {
          verb: "generate",
          args: [
            "--prompt",
            "a complete colorful vase",
            "--model",
            "openai/gpt-image-2",
            "--size",
            `${w}x${h}`,
            "--no-upscale",
          ],
          cwd: directory,
          env: {
            noDaemon: true,
            cacheRoot: join(directory, "cache"),
            gatewayApiKey: "fixture",
            gatewayUrl: `http://127.0.0.1:${address.port}`,
          },
        },
        { version: "test", library: handle },
      );
      expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
      const result = generateDataSchema.parse(envelope.data);
      expect(result).toMatchObject({
        requested: { w, h },
        artifact: { w: contentW, h: contentH },
        generation: { returned: { w: contentW, h: contentH } },
        upscale: { target: { w, h } },
      });
      expect(contentW * h).toBe(contentH * w);
      expect(requests).toEqual([
        expect.objectContaining({
          size: `${canvasW}x${canvasH}`,
          prompt: expect.stringContaining(`rectangle [0,0,${contentW},${contentH}]`),
        }),
      ]);
      const mapping = { source: [0, 0, w, h], output: [0, 0, contentW, contentH] };
      const node = await inspectGraphNode(handle, {
        photoId: result.id,
        nodeId: result.generation.node,
      });
      expect(node.parameters).toMatchObject({
        request: {
          requested: [w, h],
          provider_output: { w: canvasW, h: canvasH },
          frame_mapping: mapping,
        },
      });
      expect(node.executions[0]!.providerProvenance).toMatchObject({
        target_px: canvasW * canvasH,
        input_px: 0,
      });
      const attempt = await inspectProviderImageAttempt(
        handle,
        handle.path,
        node.executions[0]!.providerImageAttemptId!,
      );
      expect(attempt.request).toMatchObject({
        dimensions: { w: canvasW, h: canvasH },
        frame_mapping: mapping,
      });
      expect(attempt.original).toMatchObject({ w: canvasW, h: canvasH, available: true });
      const raw = await sharp(attempt.original!.path).removeAlpha().raw().toBuffer();
      const working = await readArtifactImage(
        artifactPath(handle.path, result.artifact.hash, "tif"),
        result.artifact.hash,
      );
      for (const [x, y] of [
        [0, 0],
        [Math.floor(contentW * 0.37), Math.floor(contentH * 0.61)],
        [contentW - 1, contentH - 1],
      ]) {
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = raw[(y! * canvasW + x!) * 3 + channel]! * 257;
          expect(
            Math.abs(working.data[(y! * contentW + x!) * 3 + channel]! - expected),
          ).toBeLessThan(2);
        }
      }
    } finally {
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await handle.close();
      await rm(directory, { recursive: true });
    }
  },
  30_000,
);
