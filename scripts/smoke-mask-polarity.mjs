import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { GatewayClient, GatewayImageModelAdapter } from "../packages/providers/dist/index.js";

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--out")) {
  throw new Error("usage: smoke:mask-polarity [--out DIRECTORY]");
}
const output = resolve(args[1] ?? "specs/done/photoctl/assets/gates/mask-polarity");
const key = process.env.PHOTOCTL_MASK_SMOKE_API_KEY;
await mkdir(output, { recursive: true });
await writeFile(
  resolve(output, "report.json"),
  JSON.stringify({ schema: 1, status: "running", verifiedPolarity: null }),
);
let evidence = { verifiedPolarity: null };
try {
  if (!key) {
    await record({ status: "not_run", reason: "unconfigured", verifiedPolarity: null });
  } else {
    const model = process.env.PHOTOCTL_MASK_SMOKE_MODEL;
    const candidatePolarity = process.env.PHOTOCTL_MASK_SMOKE_POLARITY;
    if (!model || !["white-edits", "transparent-edits"].includes(candidatePolarity)) {
      throw Object.assign(
        new Error("Set PHOTOCTL_MASK_SMOKE_MODEL and PHOTOCTL_MASK_SMOKE_POLARITY explicitly"),
        { code: "configuration" },
      );
    }
    const gateway = new GatewayClient({
      apiKey: key,
      baseUrl: process.env.PHOTOCTL_MASK_SMOKE_GATEWAY_URL,
      maxAttempts: 1,
      requestTimeoutMs: 120_000,
    });
    const endpoint = new URL(`${gateway.baseUrl}/images/edits`);
    endpoint.username = endpoint.password = endpoint.search = endpoint.hash = "";
    const adapter = new GatewayImageModelAdapter({
      model,
      mask: "native",
      maskPolarity: candidatePolarity,
    });
    const rgb = Buffer.alloc(1024 * 1024 * 3, 128);
    const coverage = Buffer.alloc(1024 * 1024);
    for (let y = 256; y < 768; y += 1) {
      for (let x = 128; x < 896; x += 1) {
        if (x >= 384 && x < 640) continue;
        const index = y * 1024 + x;
        rgb.set(x < 384 ? [220, 30, 30] : [30, 30, 220], index * 3);
        if (x < 384) coverage[index] = 255;
      }
    }
    const input = await sharp(rgb, { raw: { width: 1024, height: 1024, channels: 3 } })
      .png()
      .toBuffer();
    const mask = await sharp(coverage, { raw: { width: 1024, height: 1024, channels: 1 } })
      .png()
      .toBuffer();
    const prompt = "Repaint every colored rectangle bright green. Keep the gray background gray.";
    const { body: form } = await adapter.buildEdit(
      "replace",
      { png: input, w: 1024, h: 1024 },
      mask,
      prompt,
      7,
    );
    const wireMask = Buffer.from(await form.get("mask").arrayBuffer());
    const artifacts = await Promise.all(
      [
        ["input.png", input],
        ["coverage.png", mask],
        ["wire-mask.png", wireMask],
      ].map(([file, bytes]) => save(file, bytes)),
    );
    evidence = {
      model,
      adapter: adapter.id,
      adapterVersion: adapter.version,
      candidatePolarity,
      verifiedPolarity: null,
      endpoint: endpoint.toString(),
      prompt,
      seed: 7,
      artifacts,
      review:
        "The prompt requests BOTH rectangles change; only the mask protects the right blue rectangle. Inspect the raw return: left should become green, right and gray background should remain unchanged. Both changing suggests an ignored mask; right-only changing suggests reversed polarity. A successful request does not verify polarity. Record independent visual review before changing the production adapter table.",
    };
    const response = await gateway.imageEdits(form);
    const normalized = await adapter.normalize(response.data, { w: 1024, h: 1024 });
    artifacts.push(await save("returned.png", normalized.png));
    await record({
      ...evidence,
      status: "captured_needs_review",
      requestId: response.requestId,
      returnedDimensions: normalized.returnedDimensions,
      wholeFrame: normalized.wholeFrame,
    });
  }
} catch (error) {
  await record({ ...evidence, status: "failed", reason: error.code ?? "capture_failed" });
  process.exitCode = 1;
}

async function save(file, bytes) {
  await writeFile(resolve(output, file), bytes);
  return { file, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function record(result) {
  const report = { schema: 1, ...result };
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
