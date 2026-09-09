import { initializeLibrary } from "@photoctl/library";
import { generateDataSchema } from "@photoctl/protocol";
import { inspectGraphNode } from "@photoctl/render";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { dispatch } from "./dispatch.js";

test.each([0, 0.25, 1])(
  "generate records reference strength %s as transmitted variation guidance",
  async (strength) => {
    const parent = await mkdtemp(join(tmpdir(), "photoctl-strength-"));
    const handle = (await initializeLibrary(join(parent, "library"))).handle;
    const requests: Array<{ path: string; fields: Readonly<Record<string, unknown>> }> = [];
    const gateway = await startGatewayFixture(0, {
      onImageRequest: ({ path, fields }) => requests.push({ path, fields }),
    });
    try {
      const address = gateway.address();
      if (!address || typeof address === "string") throw new Error("Fixture unavailable");
      const reference = join(parent, "reference.png");
      const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
        .png()
        .toBuffer();
      await writeFile(reference, bytes);
      const requestedPrompt =
        strength === 0
          ? "Create a new variation of the reference image. Preserve its main subject and composition while varying visual details."
          : "a vase";
      const envelope = await dispatch(
        {
          verb: "generate",
          args: [
            ...(strength === 0 ? [] : ["--prompt", requestedPrompt]),
            "--ref",
            reference,
            "--strength",
            String(strength),
            "--size",
            "4x4",
            "--model",
            "photoctl/fake-image-edit-v1",
            ...(strength === 1 ? ["--neg", "text"] : []),
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
      expect(envelope, JSON.stringify(envelope)).toMatchObject({ ok: true });
      if (!envelope.ok || !("data" in envelope)) throw new Error("Expected generation");
      const result = generateDataSchema.parse(envelope.data);
      const prompt = `${requestedPrompt}${strength === 1 ? "\r\n[photoctl:negative-guidance:v1]\r\nAvoid these things: text" : ""}\r\n[photoctl:reference-strength:v1]\r\nReference variation strength: ${strength} on a 0 to 1 scale. At 0, preserve the reference as closely as possible; at 1, allow the greatest variation. Use intermediate values for proportionate freedom to vary.`;
      expect(requests).toEqual([
        { path: "/v1/images/edits", fields: expect.objectContaining({ prompt }) },
      ]);
      expect(requests[0]!.fields).not.toHaveProperty("strength");
      expect(result).toMatchObject({
        reference_strength: {
          requested: strength,
          applied: "prompt-guidance",
          version: 1,
          provider_prompt: prompt,
        },
      });
      if (strength === 1)
        expect(result.negative_prompt).toEqual({
          requested: "text",
          applied: "prompt-guidance",
          version: 1,
          provider_prompt: prompt,
        });
      const node = await inspectGraphNode(handle, {
        photoId: result.id,
        nodeId: result.generation.node,
      });
      expect(node.parameters).toMatchObject({
        prompt: requestedPrompt,
        prompt_version: 1,
        request: { reference_strength: result.reference_strength },
      });
      if (strength === 1)
        expect(node.parameters).toMatchObject({
          request: { negative_prompt: result.negative_prompt },
        });
      expect(
        (await handle.query<{ request: unknown }>("SELECT request FROM provider_image_attempts"))
          .rows,
      ).toEqual([
        {
          request: expect.objectContaining({
            prompt: requestedPrompt,
            provider_prompt: prompt,
            reference_strength: result.reference_strength,
            ...(strength === 1 ? { negative_prompt: result.negative_prompt } : {}),
          }),
        },
      ]);
      expect(await readFile(reference)).toEqual(bytes);
    } finally {
      await new Promise<void>((resolve) => gateway.close(() => resolve()));
      await handle.close();
      await rm(parent, { recursive: true });
    }
  },
);

test.each(["", "  ", "NaN", "Infinity", "-0.1", "1.1"])(
  "generate rejects invalid strength %j before library or reference work",
  async (strength) => {
    const result = await dispatch(
      {
        verb: "generate",
        args: ["--prompt", "a vase", "--ref", "/nonexistent-reference.png", "--strength", strength],
        cwd: tmpdir(),
        env: { noDaemon: true, libraryPath: "/nonexistent-photoctl-strength-library" },
      },
      { version: "test" },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "usage",
      data: { message: expect.stringContaining("--strength") },
    });
  },
);

test("generate strength requires a reference before opening a library", async () => {
  const result = await dispatch(
    {
      verb: "generate",
      args: ["--prompt", "a vase", "--strength", "0.5"],
      cwd: tmpdir(),
      env: { noDaemon: true, libraryPath: "/nonexistent-photoctl-strength-library" },
    },
    { version: "test" },
  );
  expect(result).toMatchObject({
    ok: false,
    code: "usage",
    data: { message: "--strength requires --ref" },
  });
});
