import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import sharp from "sharp";

const ROUTES = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/images/edits",
  "/v1/images/generations",
]);

export async function startGatewayFixture(port = 0): Promise<Server> {
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : "fixture error" }),
      );
    });
  });
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://gateway.fixture").pathname;
  if (request.method !== "POST" || !ROUTES.has(path)) {
    sendJson(response, 404, { error: "route not found" });
    return;
  }
  const bytes = await readBody(request);
  if (path === "/v1/embeddings") {
    const body = parseJson(bytes);
    const inputs = Array.isArray(body.input) ? body.input : [body.input];
    sendJson(response, 200, {
      object: "list",
      model: body.model,
      data: inputs.map((_input, index) => ({
        object: "embedding",
        index,
        embedding: deterministicVector(bytes, index),
      })),
    });
    return;
  }
  if (path === "/v1/chat/completions") {
    const body = parseJson(bytes);
    const responseFormat = body.response_format as { type?: unknown } | undefined;
    if (responseFormat?.type !== "json_schema") {
      sendJson(response, 400, { error: "json_schema response_format required" });
      return;
    }
    sendJson(response, 200, {
      id: requestId(bytes),
      choices: [
        {
          message: {
            role: "assistant",
            content: JSON.stringify({ box_2d: [100, 200, 300, 400] }),
          },
        },
      ],
    });
    return;
  }
  const multipart = path === "/v1/images/edits";
  const fields = multipart
    ? parseMultipartFields(bytes, request.headers["content-type"])
    : parseJson(bytes);
  const sent = parseDimensions(fields);
  const mode = String(
    fields.fixture_mode ?? request.headers["x-photoctl-fixture-mode"] ?? "normal",
  );
  const output =
    mode === "wrongdims"
      ? { w: sent.w * 2, h: sent.h * 2 }
      : mode === "smallerdims"
        ? { w: Math.max(1, Math.floor(sent.w / 2)), h: Math.max(1, Math.floor(sent.h / 2)) }
        : mode === "wrongaspect"
          ? { w: sent.w + 1, h: sent.h }
          : sent;
  const png = await sharp({
    create: { width: output.w, height: output.h, channels: 4, background: "#336699ff" },
  })
    .png()
    .toBuffer();
  sendJson(response, 200, {
    created: 0,
    data: [{ b64_json: png.toString("base64") }],
    photoctl_fixture: { wholeframe: mode === "wholeframe" },
  });
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    length += bytes.length;
    if (length > 32 * 1024 * 1024) throw new Error("fixture request exceeds 32 MiB");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function parseJson(bytes: Buffer): Record<string, unknown> {
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("object required");
  return value as Record<string, unknown>;
}

function parseMultipartFields(
  bytes: Buffer,
  contentType: string | undefined,
): Record<string, unknown> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/
    .exec(contentType ?? "")
    ?.slice(1)
    .find(Boolean);
  if (!boundary) throw new Error("multipart boundary required");
  const text = bytes.toString("latin1");
  const fields: Record<string, unknown> = {};
  for (const part of text.split(`--${boundary}`)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    const split = part.indexOf("\r\n\r\n");
    if (!name || split < 0 || /filename=/.test(part.slice(0, split))) continue;
    fields[name] = part.slice(split + 4).replace(/\r\n$/, "");
  }
  return fields;
}

function parseDimensions(fields: Record<string, unknown>): { w: number; h: number } {
  const size = typeof fields.size === "string" ? /^(\d+)x(\d+)$/.exec(fields.size) : null;
  const w = Number(size?.[1] ?? fields.width);
  const h = Number(size?.[2] ?? fields.height);
  if (!Number.isSafeInteger(w) || w < 1 || !Number.isSafeInteger(h) || h < 1) {
    throw new Error("positive image dimensions required");
  }
  return { w, h };
}

function deterministicVector(bytes: Buffer, index: number): number[] {
  const digest = createHash("sha256").update(bytes).update(String(index)).digest();
  return Array.from(
    { length: 3_072 },
    (_, offset) => (digest[offset % digest.length]! - 127.5) / 127.5,
  );
}

function requestId(bytes: Buffer): string {
  return `req_${createHash("sha256").update(bytes).digest("hex")}`;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const bytes = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(bytes),
    "x-request-id": requestId(Buffer.from(bytes)),
  });
  response.end(bytes);
}
