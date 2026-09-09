import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { fetchPinnedModels, modelSourceBaseUrl, type ModelManifest } from "./models.js";

const temporaryDirectories: string[] = [];

test("upstream acquisition resolves the pinned model subdirectory", () => {
  expect(
    modelSourceBaseUrl({
      schema: 1,
      source: { repository: "author/model", revision: "a".repeat(40), directory: "released_pair" },
      artifacts: [],
    }),
  ).toBe(`https://huggingface.co/author/model/resolve/${"a".repeat(40)}/released_pair/`);
});

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
    baseUrl: "https://models.example.test/photoctl/v1",
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
  expect(requested.toSorted()).toEqual([
    "https://models.example.test/photoctl/v1/decoder.onnx",
    "https://models.example.test/photoctl/v1/encoder.onnx",
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

test("a failed model cancels the other download and settles its temporary-file cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-models-batch-failed-"));
  temporaryDirectories.push(root);
  const manifest: ModelManifest = {
    schema: 1,
    source: { repository: "test/model", revision: "a".repeat(40) },
    artifacts: [
      artifact("encoder.onnx", Buffer.from("encoder")),
      artifact("decoder.onnx", Buffer.from("decoder")),
    ],
  };
  let cancelled = false;
  const started = Promise.withResolvers<void>();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  try {
    await expect(
      fetchPinnedModels({
        manifest,
        baseUrl: "https://mirror.example.test/",
        directory: root,
        fetch: async (url, options) => {
          if (String(url).endsWith("decoder.onnx")) {
            await started.promise;
            return new Response("failed", { status: 500 });
          }
          return new Response(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
                value.enqueue(Buffer.from("partial encoder"));
                options?.signal?.addEventListener(
                  "abort",
                  () => {
                    cancelled = true;
                    value.error(options.signal!.reason);
                  },
                  { once: true },
                );
                started.resolve();
              },
            }),
          );
        },
      }),
    ).rejects.toThrow("decoder.onnx: HTTP 500");
    expect(cancelled).toBe(true);
    expect(await readdir(root)).toEqual([]);
  } finally {
    if (!cancelled) controller!.error(new Error("test cleanup"));
  }
});

test("interrupted replacement preserves the previous model and leaves no partial artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "photoctl-models-interrupted-"));
  temporaryDirectories.push(root);
  const previous = Buffer.from("previous verified release");
  await writeFile(join(root, "encoder.onnx"), previous);
  const manifest: ModelManifest = {
    schema: 1,
    source: { repository: "test/model", revision: "a".repeat(40) },
    artifacts: [artifact("encoder.onnx", Buffer.from("complete next release"))],
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from("partial next release"));
      controller.error(new Error("connection interrupted"));
    },
  });
  await expect(
    fetchPinnedModels({
      manifest,
      baseUrl: "https://mirror.example.test/",
      directory: root,
      fetch: async () => new Response(body),
    }),
  ).rejects.toThrow("connection interrupted");
  expect(await readFile(join(root, "encoder.onnx"))).toEqual(previous);
  expect(await readdir(root)).toEqual(["encoder.onnx"]);
});

function artifact(file: string, bytes: Uint8Array) {
  return {
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    opset: 17,
  };
}
