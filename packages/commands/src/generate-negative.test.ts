import { initializeLibrary } from "@photoctl/library";
import { inspectGraphNode } from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import sharp from "sharp";
import { generateDataSchema } from "@photoctl/protocol";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each(["", "  "])(
  "generate refuses empty negative guidance before opening a library: %j",
  async (negative) => {
    const result = await dispatch(
      {
        verb: "generate",
        args: ["--prompt", "a vase", "--neg", negative],
        cwd: tmpdir(),
        env: { noDaemon: true },
      },
      { version: "test" },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "usage",
      data: { message: expect.stringContaining("--neg") },
    });
  },
);

test.each([false, true])(
  "generate records negative guidance and the actual transmitted prompt (reference=%s)",
  async (reference) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-negative-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const requests: Array<{ path: string; fields: Readonly<Record<string, unknown>> }> = [];
    const gateway = await startGatewayFixture(0, {
      onImageRequest: ({ path, fields }) => requests.push({ path, fields }),
    });
    try {
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("Fixture unavailable");
      const referencePath = join(parent, "reference.png");
      const referenceBytes = await sharp({
        create: { width: 2, height: 2, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      if (reference) await writeFile(referencePath, referenceBytes);
      const envelope = await dispatch(
        {
          verb: "generate",
          args: [
            "--prompt",
            "a vase",
            "--neg",
            "text, logos",
            "--size",
            "4x4",
            ...(reference
              ? ["--ref", referencePath, "--model", "photoctl/fake-image-edit-v1"]
              : []),
          ],
          cwd: parent,
          env: {
            noDaemon: true,
            cacheRoot: join(parent, "cache"),
            gatewayApiKey: "fixture",
            gatewayUrl: `http://127.0.0.1:${address.port}`,
          },
        },
        { version: "test", library: handle },
      );
      expect(envelope, JSON.stringify(envelope)).toMatchObject({
        ok: true,
        data: {
          negative_prompt: { requested: "text, logos", applied: "prompt-guidance", version: 1 },
        },
      });
      if (!envelope.ok || !("data" in envelope)) throw new Error("Expected generation");
      const result = generateDataSchema.parse(envelope.data);
      expect(requests).toEqual([
        {
          path: reference ? "/v1/images/edits" : "/v1/images/generations",
          fields: expect.objectContaining({
            prompt: reference
              ? "a vase\r\n[photoctl:negative-guidance:v1]\r\nAvoid these things: text, logos\r\n[photoctl:instruction-composite:v1]\r\nOnly perform the generate inside the supplied crop."
              : "a vase\n[photoctl:negative-guidance:v1]\nAvoid these things: text, logos",
          }),
        },
      ]);
      expect(requests[0]!.fields).not.toHaveProperty("negative_prompt");
      expect(result.negative_prompt).toEqual({
        requested: "text, logos",
        applied: "prompt-guidance",
        version: 1,
        provider_prompt: requests[0]!.fields.prompt,
      });
      const node = await inspectGraphNode(handle, {
        photoId: result.id,
        nodeId: result.generation.node,
      });
      expect(node.parameters).toMatchObject({
        prompt: "a vase",
        prompt_version: 1,
        request: { negative_prompt: result.negative_prompt },
      });
      const attempts = await handle.query<{ request: unknown }>(
        "SELECT request FROM provider_image_attempts",
      );
      expect(attempts.rows).toEqual([
        {
          request: expect.objectContaining({
            prompt: "a vase",
            provider_prompt: requests[0]!.fields.prompt,
            negative_prompt: result.negative_prompt,
          }),
        },
      ]);
      if (reference) expect(await readFile(referencePath)).toEqual(referenceBytes);
    } finally {
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await handle.close();
      await rm(parent, { recursive: true });
    }
  },
);
