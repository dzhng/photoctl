import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import sharp from "sharp";

const execute = promisify(execFile);

test("invalid explicit smoke configuration leaves terminal failure evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-mask-smoke-"));
  try {
    await expect(
      execute(process.execPath, [resolve("scripts/smoke-mask-polarity.mjs"), "--out", directory], {
        env: {
          ...process.env,
          PHOTOCTL_MASK_SMOKE_API_KEY: "explicit-fixture-consent",
          PHOTOCTL_MASK_SMOKE_MODEL: "",
          PHOTOCTL_MASK_SMOKE_POLARITY: "",
        },
      }),
    ).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await readFile(join(directory, "report.json"), "utf8"))).toMatchObject({
      status: "failed",
      reason: "configuration",
      verifiedPolarity: null,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("failed mask smoke records a failure without retaining a stale successful verdict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-mask-smoke-"));
  try {
    await writeFile(
      join(directory, "report.json"),
      JSON.stringify({ status: "accepted", verifiedPolarity: "white-edits" }),
    );
    await expect(
      execute(process.execPath, [resolve("scripts/smoke-mask-polarity.mjs"), "--out", directory], {
        env: {
          ...process.env,
          PHOTOCTL_MASK_SMOKE_API_KEY: "explicit-fixture-consent",
          PHOTOCTL_MASK_SMOKE_MODEL: "fixture-mask-model",
          PHOTOCTL_MASK_SMOKE_POLARITY: "white-edits",
          PHOTOCTL_MASK_SMOKE_GATEWAY_URL: "http://127.0.0.1:1/v1",
        },
      }),
    ).rejects.toMatchObject({ code: 1 });
    const report = await readFile(join(directory, "report.json"), "utf8");
    expect(JSON.parse(report)).toMatchObject({
      status: "failed",
      verifiedPolarity: null,
      reason: "provider_busy",
    });
    expect(report).not.toContain("explicit-fixture-consent");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("mask smoke ignores ambient credentials and records no polarity acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "photoctl-mask-smoke-"));
  try {
    const result = await execute(
      process.execPath,
      [resolve("scripts/smoke-mask-polarity.mjs"), "--out", directory],
      {
        env: {
          ...process.env,
          AI_GATEWAY_API_KEY: "ambient-do-not-use",
          PHOTOCTL_MASK_SMOKE_API_KEY: "",
          PHOTOCTL_MASK_SMOKE_GATEWAY_URL: "http://127.0.0.1:1/v1",
        },
      },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "not_run",
      reason: "unconfigured",
      verifiedPolarity: null,
    });
    expect(JSON.parse(await readFile(join(directory, "report.json"), "utf8"))).toMatchObject({
      status: "not_run",
      verifiedPolarity: null,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test.each(["white-edits", "transparent-edits"])(
  "keyed %s smoke saves the actual wire mask and uncomposited response without blessing it",
  async (polarity) => {
    const directory = await mkdtemp(join(tmpdir(), "photoctl-mask-smoke-"));
    let uploadedMask: Buffer | undefined;
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = await new Response(Buffer.concat(chunks), {
        headers: { "content-type": request.headers["content-type"]! },
      }).formData();
      uploadedMask = Buffer.from(await (body.get("mask") as File).arrayBuffer());
      const input = Buffer.from(await (body.get("image") as File).arrayBuffer());
      response.writeHead(200, { "content-type": "application/json", "x-request-id": "mask-probe" });
      response.end(JSON.stringify({ data: [{ b64_json: input.toString("base64") }] }));
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing fixture address");
      const result = await execute(
        process.execPath,
        [resolve("scripts/smoke-mask-polarity.mjs"), "--out", directory],
        {
          env: {
            ...process.env,
            PHOTOCTL_MASK_SMOKE_API_KEY: "explicit-fixture-consent",
            PHOTOCTL_MASK_SMOKE_MODEL: "fixture-mask-model",
            PHOTOCTL_MASK_SMOKE_POLARITY: polarity,
            PHOTOCTL_MASK_SMOKE_GATEWAY_URL: `http://127.0.0.1:${address.port}/v1`,
          },
        },
      );
      const report = JSON.parse(result.stdout);
      expect(report).toMatchObject({
        status: "captured_needs_review",
        verifiedPolarity: null,
        candidatePolarity: polarity,
        model: "fixture-mask-model",
        requestId: "mask-probe",
      });
      expect(JSON.stringify(report)).not.toContain("explicit-fixture-consent");
      const mask = await readFile(join(directory, "wire-mask.png"));
      expect(mask).toEqual(uploadedMask);
      if (polarity === "transparent-edits") {
        const pixels = await sharp(mask).ensureAlpha().raw().toBuffer();
        expect(pixels[(512 * 1024 + 256) * 4 + 3]).toBe(0);
        expect(pixels[(512 * 1024 + 768) * 4 + 3]).toBe(255);
      } else {
        const pixels = await sharp(mask).greyscale().raw().toBuffer();
        expect(pixels[512 * 1024 + 256]).toBe(255);
        expect(pixels[512 * 1024 + 768]).toBe(0);
      }
      await Promise.all(
        report.artifacts.map(async (artifact: { file: string; sha256: string }) => {
          const bytes = await readFile(join(directory, artifact.file));
          expect(artifact.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        }),
      );
      const original = await sharp(join(directory, "input.png")).raw().toBuffer();
      const returned = await sharp(join(directory, "returned.png")).raw().toBuffer();
      expect(returned).toEqual(original);
    } finally {
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await rm(directory, { recursive: true });
    }
  },
);
