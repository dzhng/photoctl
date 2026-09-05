import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createSam2OnnxRuntime } from "../packages/img/dist/index.js";
import { Sam2Segmenter } from "../packages/render/dist/sam2-runtime.js";

// Explicit model paths permit checking a candidate before publishing its release manifest.
// Synthetic input measures the segmenter, not image quality or whole-command memory.
const { values } = parseArgs({ options: { models: { type: "string" } } });
assert(values.models, "Usage: node scripts/probe-sam2.mjs --models <ONNX directory>");
const encoder = await readFile(join(values.models, "encoder.onnx"));
const decoder = await readFile(join(values.models, "decoder.onnx"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runtime = createSam2OnnxRuntime(encoder, decoder);
const image = {
  w: 1024,
  h: 1024,
  data: Float32Array.from({ length: 3 * 1024 * 1024 }, (_, i) => (Math.sin(i * 0.001) + 1) / 2),
};
const samples = [];
let maskHash;
let encodeMs;
let decodeMs;
const segmenter = new Sam2Segmenter(async () => ({
  runEncoder: async (...args) => {
    const started = performance.now();
    const result = await runtime.runEncoder(...args);
    encodeMs = performance.now() - started;
    return result;
  },
  runDecoder: async (...args) => {
    const started = performance.now();
    const result = await runtime.runDecoder(...args);
    decodeMs = performance.now() - started;
    return result;
  },
}));
for (let run = 0; run < 16; run += 1) {
  encodeMs = undefined;
  decodeMs = undefined;
  const mask = await segmenter.segment({
    photoId: `probe-${run}`,
    tier: "develop",
    image,
    points: [[512, 512]],
  });
  assert.equal(mask.w, image.w);
  assert.equal(mask.h, image.h);
  assert(
    Number.isFinite(encodeMs) && Number.isFinite(decodeMs),
    "each sample must execute both models",
  );
  assert(
    mask.data.every((value) => value === 0 || value === 1),
    "mask must be binary",
  );
  const currentHash = hash(
    new Uint8Array(mask.data.buffer, mask.data.byteOffset, mask.data.byteLength),
  );
  maskHash ??= currentHash;
  assert.equal(currentHash, maskHash, "repeated inference must preserve exact masks");
  samples.push({ run, encodeMs, decodeMs, rssBytes: process.memoryUsage().rss });
}
const maxRssBytes = process.resourceUsage().maxRSS * 1024;
const limits = { encodeMs: 4000, maxRssBytes: 3_000_000_000 };
const passed =
  samples.every((sample) => sample.encodeMs <= limits.encodeMs) &&
  maxRssBytes <= limits.maxRssBytes;
console.log(
  JSON.stringify(
    {
      cpu: cpus()[0]?.model,
      platform: process.platform,
      arch: process.arch,
      modelHashes: { encoder: hash(encoder), decoder: hash(decoder) },
      qualityVerified: false,
      samples,
      maxRssBytes,
      maskHash,
      limits,
      passed,
    },
    null,
    2,
  ),
);
process.exitCode = passed ? 0 : 1;
