import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import {
  GatewayClient,
  createEmbeddingAdapter,
  EMBED_IMAGE_REQUEST_SHAPE,
} from "../packages/providers/dist/index.js";

const options = parseArgs(process.argv.slice(2));
// Explicit smoke consent only: never pick up an ambient or saved product key.
const key = process.env.PHOTOCTL_EMBED_SMOKE_API_KEY;
const model = process.env.PHOTOCTL_EMBED_SMOKE_MODEL ?? "google/gemini-embedding-2";
const gateway = new GatewayClient({
  apiKey: key,
  baseUrl: process.env.PHOTOCTL_EMBED_SMOKE_GATEWAY_URL,
  maxAttempts: 1,
});
const result = {
  schema: 1,
  status: "not_run",
  reason: "unconfigured",
  model,
  endpoint: redactUrl(gateway.baseUrl.replace(/\/v1$/u, "/v3/ai") + "/embedding-model"),
  requestShape: EMBED_IMAGE_REQUEST_SHAPE,
  acceptedRequest: null,
  dimensions: null,
  observed: null,
  requestId: null,
  imageWitness: null,
  sources: [
    "https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai",
    "https://github.com/vercel/ai/blob/ai%406.0.0/packages/gateway/src/gateway-embedding-model.ts",
  ],
};

if (key) {
  const adapter = createEmbeddingAdapter({
    model,
    request: (body, signal) => gateway.embeddings(body, signal),
    requestImages: (body, signal) => gateway.multimodalEmbeddings(body, signal),
  });
  try {
    const images = await Promise.all(
      ["#ff0000", "#0000ff"].map(
        async (background) =>
          await sharp({ create: { width: 128, height: 128, channels: 3, background } })
            .jpeg()
            .toBuffer(),
      ),
    );
    const vectors = [];
    // Identical caption, changed image, repeated original: detect caption-only success.
    for (const jpeg of [images[0], images[1], images[0]]) {
      const response = await adapter.images([jpeg]);
      vectors.push(response.vectors[0]);
      result.requestId = response.requestId;
    }
    const difference = (a, b) => Math.max(...a.map((value, index) => Math.abs(value - b[index])));
    result.imageWitness = {
      changedImageDifference: difference(vectors[0], vectors[1]),
      repeatedImageDifference: difference(vectors[0], vectors[2]),
    };
    const accepted =
      result.imageWitness.changedImageDifference >
      Math.max(1e-6, result.imageWitness.repeatedImageDifference * 10);
    result.status = accepted ? "accepted" : "rejected";
    result.reason = accepted ? null : "image_content_not_demonstrated";
    result.dimensions = vectors[0].length;
    result.acceptedRequest = accepted
      ? {
          imageSha256: images.map((jpeg) => createHash("sha256").update(jpeg).digest("hex")),
          caption: "A photograph indexed for cross-modal retrieval.",
        }
      : null;
  } catch (error) {
    result.status = "rejected";
    result.reason =
      error.message === "The provider returned invalid embeddings"
        ? "response_shape"
        : error.data?.status
          ? "HTTP " + error.data.status
          : "transport_failure";
    if (result.reason === "response_shape")
      result.observed = {
        embeddingCount: error.data.observed_count,
        embeddingDimensions: error.data.dimensions,
        truncated: error.data.truncated,
      };
    // Do not print provider bodies or exception messages, which can contain credentials.
  }
  if (result.status !== "accepted") process.exitCode = 1;
}
await mkdir(dirname(options.evidence), { recursive: true });
await writeFile(options.evidence, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");

function redactUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseArgs(args) {
  let evidence = resolve("specs/openphoto/assets/embed-shape.json");
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== "--evidence" || args[index + 1] === undefined) {
      throw new Error("usage: smoke:embed-shape [--evidence PATH]");
    }
    evidence = resolve(args[index + 1]);
  }
  return { evidence };
}
