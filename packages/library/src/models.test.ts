import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { fetchPinnedModels, type ModelManifest } from "./models.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { recursive: true })),
  );
});

test("model fetch publishes only hash-verified bytes and reuses a verified cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-models-"));
  temporaryDirectories.push(root);
  const encoder = new TextEncoder().encode("real exported encoder bytes");
  const decoder = new TextEncoder().encode("real exported decoder bytes");
  const manifest: ModelManifest = {
    schema: 1,
    source: {
      repository: "facebook/sam2.1-hiera-small",
      revision: "ee5bba1d82bb8749febdf90f45e84b687142ba03",
    },
    artifacts: [artifact("encoder.onnx", encoder), artifact("decoder.onnx", decoder)],
  };
  const requested: string[] = [];
  const fetchModel = async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const bytes = url.endsWith("encoder.onnx") ? encoder : decoder;
    return new Response(bytes);
  };

  const first = await fetchPinnedModels({
    manifest,
    baseUrl: "https://models.example.test/photoctl/v1/",
    directory: root,
    fetch: fetchModel,
  });
  expect(first).toEqual([
    { file: "encoder.onnx", sha256: manifest.artifacts[0]!.sha256, cached: false },
    { file: "decoder.onnx", sha256: manifest.artifacts[1]!.sha256, cached: false },
  ]);
  expect(new Uint8Array(await readFile(join(root, "encoder.onnx")))).toEqual(encoder);
  expect(new Uint8Array(await readFile(join(root, "decoder.onnx")))).toEqual(decoder);

  const second = await fetchPinnedModels({
    manifest,
    baseUrl: "https://models.example.test/photoctl/v1/",
    directory: root,
    fetch: async () => {
      throw new Error("verified cache must not fetch");
    },
  });
  expect(second.every(({ cached }) => cached)).toBe(true);
  expect(requested).toEqual([
    "https://models.example.test/photoctl/v1/encoder.onnx",
    "https://models.example.test/photoctl/v1/decoder.onnx",
  ]);
});

test("model fetch leaves no published file when downloaded bytes fail the manifest hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-models-bad-"));
  temporaryDirectories.push(root);
  const expected = new TextEncoder().encode("expected");
  const manifest: ModelManifest = {
    schema: 1,
    source: {
      repository: "facebook/sam2.1-hiera-small",
      revision: "ee5bba1d82bb8749febdf90f45e84b687142ba03",
    },
    artifacts: [artifact("encoder.onnx", expected)],
  };
  await expect(
    fetchPinnedModels({
      manifest,
      baseUrl: "https://models.example.test/",
      directory: root,
      fetch: async () => new Response("wrong"),
    }),
  ).rejects.toThrow("SHA-256 mismatch");
  await expect(readFile(join(root, "encoder.onnx"))).rejects.toMatchObject({ code: "ENOENT" });
});

function artifact(file: string, bytes: Uint8Array) {
  return {
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opset: 17,
  };
}
