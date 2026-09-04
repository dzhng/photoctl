import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const options = parseArgs(process.argv.slice(2));
const key = process.env.PHOTOCTL_EMBED_SMOKE_API_KEY;
const model = process.env.PHOTOCTL_EMBED_SMOKE_MODEL ?? "google/gemini-embedding-2";
const baseUrl = (
  process.env.PHOTOCTL_EMBED_SMOKE_GATEWAY_URL ?? "https://ai-gateway.vercel.sh/v1"
).replace(/\/$/u, "");
const requestUrl = `${baseUrl}/embeddings`;
const evidenceEndpoint = redactUrl(requestUrl);
const sources = [
  "https://vercel.com/docs/ai-gateway",
  "https://vercel.com/ai-gateway/models/gemini-embedding-2",
  "https://ai.google.dev/gemini-api/docs/embeddings",
];

if (!key) {
  await finish({
    schema: 1,
    status: "not_run",
    reason: "unconfigured",
    model,
    endpoint: evidenceEndpoint,
    requestShape: "openai-compatible-content-parts-candidate-v1",
    acceptedRequest: null,
    dimensions: null,
    observed: null,
    requestId: null,
    sources,
  });
} else {
  const jpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ED//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ED//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ED//2Q==",
    "base64",
  );
  const imageUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const request = {
    model,
    dimensions: 3_072,
    input: [
      {
        content: [
          { type: "text", text: "A photograph indexed for cross-modal retrieval." },
          { type: "image_url", image_url: imageUrl },
        ],
      },
    ],
  };
  let response;
  try {
    response = await fetch(requestUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    await finish({
      schema: 1,
      status: "rejected",
      reason: "transport_failure",
      model,
      endpoint: evidenceEndpoint,
      requestShape: "openai-compatible-content-parts-candidate-v1",
      acceptedRequest: null,
      dimensions: null,
      observed: null,
      requestId: null,
      sources,
    });
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
  if (response) {
    const body = await response.json().catch(() => ({ error: "non-JSON response" }));
    const embedding = body?.data?.[0]?.embedding;
    const accepted =
      response.ok &&
      Array.isArray(body?.data) &&
      body.data.length === 1 &&
      Array.isArray(embedding) &&
      embedding.length === 3_072 &&
      embedding.every(Number.isFinite);
    const observed = observeEmbeddingShape(body?.data);
    const result = {
      schema: 1,
      status: accepted ? "accepted" : "rejected",
      reason: accepted ? null : response.ok ? "response_shape" : `HTTP ${response.status}`,
      model,
      endpoint: evidenceEndpoint,
      requestShape: "openai-compatible-content-parts-candidate-v1",
      acceptedRequest: accepted ? redactRequest(request, jpeg) : null,
      dimensions: accepted ? embedding.length : null,
      observed: accepted ? null : observed,
      requestId: response.headers.get("x-request-id"),
      sources,
    };
    await finish(result);
    if (!accepted) {
      process.stderr.write(`${JSON.stringify({ status: response.status, body })}\n`);
      process.exitCode = 1;
    }
  }
}

function observeEmbeddingShape(data) {
  if (!Array.isArray(data)) {
    return { embeddingCount: 0, embeddingDimensions: [], truncated: false };
  }
  return {
    embeddingCount: data.length,
    embeddingDimensions: data
      .slice(0, 8)
      .map((item) => (Array.isArray(item?.embedding) ? item.embedding.length : null)),
    truncated: data.length > 8,
  };
}

async function finish(result) {
  await mkdir(dirname(options.evidence), { recursive: true });
  await writeFile(options.evidence, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function redactRequest(request, jpeg) {
  return {
    ...request,
    input: [
      {
        content: [
          request.input[0].content[0],
          {
            type: "image_url",
            image_url: `data:image/jpeg;sha256=${createHash("sha256").update(jpeg).digest("hex")}`,
          },
        ],
      },
    ],
  };
}

function redactUrl(value) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseArgs(args) {
  let evidence = resolve("specs/photoctl/assets/gates/embed-shape.json");
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== "--evidence" || args[index + 1] === undefined) {
      throw new Error("usage: smoke:embed-shape [--evidence PATH]");
    }
    evidence = resolve(args[index + 1]);
  }
  return { evidence };
}
