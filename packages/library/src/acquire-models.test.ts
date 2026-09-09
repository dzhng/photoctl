import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

test("acquisition command verifies mirror bytes and includes noncommercial attribution", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-acquire-"));
  const bytes = Buffer.from("model response from mirror");
  const requested: string[] = [];
  const server = createServer((request, response) => {
    requested.push(request.url!);
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test address");
  try {
    const manifest = join(root, "manifest.json");
    await writeFile(
      manifest,
      JSON.stringify({
        schema: 1,
        source: { repository: "test/model", revision: "a".repeat(40) },
        artifacts: [
          {
            file: "encoder.onnx",
            sha256: createHash("sha256").update(bytes).digest("hex"),
            opset: 15,
          },
        ],
      }),
    );
    const directory = join(root, "models");
    await promisify(execFile)(process.execPath, [
      "scripts/fetch-models.mjs",
      directory,
      "--base-url",
      `http://127.0.0.1:${address.port}/mirror/`,
      "--manifest",
      manifest,
    ]);
    expect(await readFile(join(directory, "encoder.onnx"))).toEqual(bytes);
    expect(requested).toEqual(["/mirror/encoder.onnx"]);
    expect(await readFile(join(directory, "ZIM-LICENSE"), "utf8")).toContain(
      "Attribution-NonCommercial 4.0 International",
    );
    expect(await readFile(join(directory, "ZIM-NOTICE"), "utf8")).toContain("Naver Cloud Corp.");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true });
  }
});

test("large model fetch and cache inspection retain bounded memory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-model-stream-"));
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { createHash } from 'node:crypto';
      import { fetchPinnedModels, inspectPinnedModels } from './packages/library/dist/index.js';
      const chunk = Buffer.alloc(1024 * 1024, 7);
      const hash = createHash('sha256');
      for (let i = 0; i < 128; i++) hash.update(chunk);
      const manifest = {schema: 1, source: {repository: 'test/model', revision: 'a'.repeat(40)},
        artifacts: [{file: 'encoder.onnx', sha256: hash.digest('hex'), opset: 15}]};
      const before = process.resourceUsage().maxRSS;
      let remaining = 128;
      await fetchPinnedModels({manifest, directory: process.argv[1], baseUrl: 'https://fixture.test/',
        fetch: async () => new Response(new ReadableStream({pull(controller) {
          if (remaining-- > 0) controller.enqueue(chunk); else controller.close();
        }}))});
      const inspected = await inspectPinnedModels(manifest, process.argv[1]);
      console.log(JSON.stringify({extraBytes: (process.resourceUsage().maxRSS - before) * 1024,
        cached: inspected[0].cached}));
    `,
      directory,
    ]);
    const result = JSON.parse(stdout) as { extraBytes: number; cached: boolean };
    expect(result.cached).toBe(true);
    // A whole 128 MiB body (or cache read) cannot fit inside this incremental allowance.
    expect(result.extraBytes).toBeLessThan(96 * 1024 * 1024);
  } finally {
    await rm(directory, { recursive: true });
  }
});
