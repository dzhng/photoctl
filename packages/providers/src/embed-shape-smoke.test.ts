import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { startGatewayFixture } from "@photoctl/test-harness/gateway-fixture";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

test("the embed-shape smoke ignores an ambient gateway key without explicit smoke consent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-smoke-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "embed-shape.json");

  const result = await runNode(["scripts/smoke-embed-shape.mjs", "--evidence", evidence], {
    AI_GATEWAY_API_KEY: "ambient-must-not-run",
  });

  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "not_run", reason: "unconfigured" });
  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({
    status: "not_run",
    reason: "unconfigured",
    acceptedRequest: null,
  });
});

test("an explicitly keyed smoke records the accepted redacted multimodal request", async () => {
  server = await startGatewayFixture();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-smoke-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "embed-shape.json");

  const result = await runNode(["scripts/smoke-embed-shape.mjs", "--evidence", evidence], {
    PHOTOCTL_EMBED_SMOKE_API_KEY: "explicit-fixture-key",
    PHOTOCTL_EMBED_SMOKE_GATEWAY_URL: `http://127.0.0.1:${address.port}/v1`,
  });

  expect(result.code).toBe(0);
  const recorded = JSON.parse(await readFile(evidence, "utf8")) as {
    status: string;
    dimensions: number;
    acceptedRequest: { imageSha256: string[] };
    imageWitness: { changedImageDifference: number; repeatedImageDifference: number };
  };
  expect(recorded.status).toBe("accepted");
  expect(recorded.dimensions).toBe(3_072);
  expect(recorded.acceptedRequest.imageSha256[0]).toMatch(/^[a-f0-9]{64}$/u);
  expect(recorded.imageWitness.changedImageDifference).toBeGreaterThan(0);
  expect(recorded.imageWitness.repeatedImageDifference).toBe(0);
  expect(JSON.stringify(recorded)).not.toContain("explicit-fixture-key");
  expect(JSON.stringify(recorded)).not.toContain("base64");
});

test("a caption-only provider cannot pass the image smoke with valid dimensions", async () => {
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ embeddings: [Array(3_072).fill(0.25)] }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-smoke-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "embed-shape.json");
  const result = await runNode(["scripts/smoke-embed-shape.mjs", "--evidence", evidence], {
    PHOTOCTL_EMBED_SMOKE_API_KEY: "explicit-fixture-key",
    PHOTOCTL_EMBED_SMOKE_GATEWAY_URL: `http://127.0.0.1:${address.port}/v1`,
  });
  expect(result.code).toBe(1);
  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({
    status: "rejected",
    reason: "image_content_not_demonstrated",
    acceptedRequest: null,
    imageWitness: { changedImageDifference: 0, repeatedImageDifference: 0 },
  });
});

test("an explicitly keyed transport failure is durably recorded as rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-smoke-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "embed-shape.json");

  const result = await runNode(["scripts/smoke-embed-shape.mjs", "--evidence", evidence], {
    PHOTOCTL_EMBED_SMOKE_API_KEY: "explicit-fixture-key",
    PHOTOCTL_EMBED_SMOKE_GATEWAY_URL: "http://127.0.0.1:1/v1",
  });

  expect(result.code).toBe(1);
  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({
    status: "rejected",
    reason: "transport_failure",
    acceptedRequest: null,
  });
});

test("an HTTP 200 with the wrong embedding shape records bounded shape evidence", async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        embeddings: Array.from({ length: 12 }, (_, index) =>
          Array.from({ length: index + 1 }, () => 0),
        ),
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const directory = await mkdtemp(join(tmpdir(), "photoctl-embed-smoke-"));
  temporaryDirectories.push(directory);
  const evidence = join(directory, "embed-shape.json");

  const result = await runNode(["scripts/smoke-embed-shape.mjs", "--evidence", evidence], {
    PHOTOCTL_EMBED_SMOKE_API_KEY: "explicit-fixture-key",
    PHOTOCTL_EMBED_SMOKE_GATEWAY_URL: `http://127.0.0.1:${address.port}/v1`,
  });

  expect(result.code).toBe(1);
  expect(JSON.parse(await readFile(evidence, "utf8"))).toMatchObject({
    status: "rejected",
    reason: "response_shape",
    dimensions: null,
    observed: {
      embeddingCount: 12,
      embeddingDimensions: [1, 2, 3, 4, 5, 6, 7, 8],
      truncated: true,
    },
  });
});

function runNode(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
