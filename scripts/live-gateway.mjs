import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { DEFAULT_MODELS } from "../packages/providers/dist/index.js";
import {
  artifactPath,
  readArtifactLinear,
  readArtifactMask,
} from "../packages/render/dist/index.js";

const args = process.argv.slice(2);
if (
  args[0] !== "--out" ||
  ![2, 4].includes(args.length) ||
  (args.length === 4 &&
    (args[2] !== "--only" || !["auto-enhance", "text-grounding", "masked-edit"].includes(args[3])))
)
  throw new Error(
    "usage: live-gateway --out NEW_DIRECTORY [--only auto-enhance|text-grounding|masked-edit]",
  );
const only = args[3];
const output = resolve(args[1]);
await mkdir(output, { mode: 0o700 });
const key = process.env.OPENPHOTO_LIVE_API_KEY;
const report = {
  schema: 1,
  scope: only ?? "full-journey",
  status: "not_run",
  reason: "explicit_live_key_required",
  models: DEFAULT_MODELS,
  stages: [],
};
const home = join(output, "home");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
let activeChild;
let interrupted;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interrupted ??= signal;
    activeChild?.kill("SIGKILL");
  });
}
const env = {
  PATH: process.env.PATH,
  HOME: home,
  PHOTOCTL_LIBRARY: join(output, "library"),
  PHOTOCTL_CACHE: join(output, "cache"),
  PHOTOCTL_NO_DAEMON: "1",
  PHOTOCTL_VOLUME_MAP: `${output}=live-fixture:online`,
  ...(process.env.OPENPHOTO_LIVE_GATEWAY_URL
    ? { PHOTOCTL_GATEWAY_URL: process.env.OPENPHOTO_LIVE_GATEWAY_URL }
    : {}),
};

if (key) {
  report.status = "running";
  report.reason = null;
  await save();
  try {
    await mkdir(home, { mode: 0o700 });
    await command(["configure", "--key-stdin"], key + "\n");
    await command(["init", "--embed", "manual"]);
    const input = join(output, "input.jpg");
    await sharp(
      Buffer.from(
        '<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#163ad4"/><circle cx="512" cy="512" r="280" fill="#e22b18"/></svg>',
      ),
    )
      .jpeg()
      .toFile(input);
    const imported = await command(["import", input, "--link"]);
    const id = imported.data.ids[0];
    await stage("image-embedding", async () => await command(["embed", id]));
    await stage("vector-search", async () => {
      const result = await command(["search", "a red circle on a blue background"]);
      if (!result.data.hits.some((hit) => hit.id === id && hit.sources.includes("vector")))
        throw new Error("Vector retrieval did not return the indexed image");
      return result;
    });
    await stage("text-grounding", async () => {
      if (process.env.OPENPHOTO_LIVE_MODELS_DIRECTORY)
        await symlink(
          resolve(process.env.OPENPHOTO_LIVE_MODELS_DIRECTORY),
          join(env.PHOTOCTL_LIBRARY, "models"),
        );
      const result = await command([
        "segment",
        id,
        "--text",
        "the red circle, excluding the blue background",
        "--at",
        "0.5,0.5",
        "--norm",
      ]);
      const instances = result.data.instances;
      if (
        result.data.gateway_calls !== 1 ||
        instances.length !== 1 ||
        instances[0].mask.pixels <= 0
      )
        throw Object.assign(new Error("Grounding did not select one nonempty instance"), {
          envelope: result,
        });
      const hash = instances[0].mask.artifact_hash;
      const mask = await readArtifactMask(artifactPath(env.PHOTOCTL_LIBRARY, hash, "tif"), hash);
      // Soft alpha tails are nonzero everywhere; selection uses the CLI's center-click threshold.
      const selected = mask.data.reduce((count, alpha) => count + Number(alpha >= 0.5), 0);
      await sharp(Buffer.from(mask.data.map((alpha) => Math.round(alpha * 255))), {
        raw: { width: mask.w, height: mask.h, channels: 1 },
      })
        .png()
        .toFile(join(output, "grounded-mask.png"));
      if (selected === 0 || selected === mask.data.length)
        throw Object.assign(new Error("Grounded selection is empty or full-frame"), {
          envelope: result,
        });
      return { ...result, selectedPixels: selected, maskFile: "grounded-mask.png" };
    });
    await stage("auto-enhance", async () => await command(["develop", id, "--auto-enhance"]));
    const generated = await stage(
      "generate",
      async () =>
        await command([
          "generate",
          "--prompt",
          "A studio photograph of a single red apple on a blue background, no text",
          "--size",
          "1024x1024",
          "--no-upscale",
        ]),
    );
    if (generated)
      await stage("generated-preview", async () => await capturePurchased(generated, "generated"));
    const reimagined = await stage(
      "reimagine",
      async () =>
        await command([
          "reimagine",
          id,
          "--prompt",
          "Make the red circle look like a red glass sphere. Keep the blue background.",
          "--no-upscale",
        ]),
    );
    if (reimagined)
      await stage(
        "reimagined-preview",
        async () => await capturePurchased(reimagined, "reimagined"),
      );
    const relit = await stage(
      "relight",
      async () =>
        await command([
          "relight",
          id,
          "--azimuth",
          "45",
          "--elevation",
          "30",
          "--intensity",
          "0.3",
          "--no-upscale",
        ]),
    );
    if (relit) await stage("relit-preview", async () => await capturePurchased(relit, "relit"));
    await stage("offline-replay", async () => {
      const purchased = relit ?? reimagined;
      if (!purchased) throw new Error("No purchased edit is available to replay");
      return await verifyReplay(id, purchased);
    });
    await stage("masked-edit", async () => {
      const selected = await command(["segment", id, "--box", "0.375,0.375,0.25,0.25", "--norm"]);
      const filled = await command([
        "fill",
        id,
        "--layer",
        selected.data.layer_id,
        "--prompt",
        "Replace the selected area with bright green glass",
        "--fit",
        "strict",
        "--no-upscale",
      ]);
      const captured = await capturePurchased(filled, "masked");
      const fidelity = await verifyMaskFidelity(id, filled.data.composite.node);
      const replay = await verifyReplay(id, filled, "masked-");
      return { ...filled, capture: captured, fidelity, replay };
    });
    await stage("attempt-journal", async () => await command(["graph", "attempts"]));
  } catch (error) {
    report.stages.push({ name: "setup", status: "failed", error: safeError(error) });
  } finally {
    // Keep the disposable catalog and rendered evidence, never its live credential.
    await rm(home, { recursive: true, force: true });
  }
  report.status = interrupted
    ? "interrupted"
    : report.stages.some((entry) => entry.status !== "passed")
      ? "failed"
      : "passed";
  if (interrupted) report.reason = interrupted;
  if (report.status !== "passed") process.exitCode = 1;
}
await save();
process.stdout.write(
  JSON.stringify({ status: report.status, report: join(output, "report.json") }) + "\n",
);

async function command(commandArgs, input, overrides = {}) {
  if (interrupted) throw new Error(`Interrupted: ${interrupted}`);
  const pending = execute(process.execPath, [join(repo, "apps/cli/dist/bin.js"), ...commandArgs], {
    cwd: output,
    env: { ...env, ...overrides },
    timeout: 150_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  activeChild = pending.child;
  pending.child.stdin.end(input);
  let response;
  try {
    response = await pending;
  } catch (error) {
    let envelope;
    try {
      envelope = JSON.parse(error.stdout);
    } catch {
      /* Process failure, not a CLI envelope. */
    }
    throw Object.assign(new Error(envelope?.data?.message ?? "CLI command failed"), {
      envelope,
      code: envelope?.code ?? "process_failure",
    });
  } finally {
    activeChild = undefined;
  }
  const envelope = JSON.parse(response.stdout);
  if (!envelope.ok)
    throw Object.assign(new Error("CLI operation failed"), { envelope, code: envelope.code });
  return envelope;
}

async function capturePurchased(result, name) {
  const captured = await capture(result.data.id, name);
  const node = await command(["graph", "node", result.data.id, result.data.generation.node]);
  return { ...captured, executions: node.data.executions };
}

async function verifyMaskFidelity(id, compositeId) {
  const composite = (await command(["graph", "node", id, compositeId])).data;
  const baseNode = (await command(["graph", "node", id, composite.input_node_ids[0]])).data;
  const maskNode = (await command(["graph", "node", id, composite.input_node_ids[2]])).data;
  const artifacts = await Promise.all(
    [
      [composite, readArtifactLinear],
      [baseNode, readArtifactLinear],
      [maskNode, readArtifactMask],
    ].map(async ([node, read]) => {
      const hash = node.executions[0].output_artifact_hash;
      return { hash, image: await read(artifactPath(env.PHOTOCTL_LIBRARY, hash, "tif"), hash) };
    }),
  );
  const [result, base, mask] = artifacts.map(({ image }) => image);
  if (result.w !== base.w || result.h !== base.h || mask.w !== base.w || mask.h !== base.h)
    throw new Error("Composite inputs have mismatched dimensions");
  let outsidePixels = 0,
    changedOutsidePixels = 0,
    changedInsidePixels = 0;
  for (let pixel = 0; pixel < mask.data.length; pixel++) {
    const offset = pixel * 3;
    const changed =
      result.data[offset] !== base.data[offset] ||
      result.data[offset + 1] !== base.data[offset + 1] ||
      result.data[offset + 2] !== base.data[offset + 2];
    if (mask.data[pixel] === 0) {
      outsidePixels++;
      changedOutsidePixels += Number(changed);
    } else changedInsidePixels += Number(changed);
  }
  const evidence = {
    outsidePixels,
    changedOutsidePixels,
    changedInsidePixels,
    artifacts: artifacts.map(({ hash }) => hash),
  };
  if (!outsidePixels || changedOutsidePixels || !changedInsidePixels)
    throw Object.assign(
      new Error(
        "Masked edit did not change selected pixels while preserving protected pixels exactly",
      ),
      { envelope: evidence },
    );
  return evidence;
}

async function verifyReplay(id, purchased, prefix = "") {
  const before = await capture(id, prefix + "edited");
  const graph = await command(["graph", "show", id, "--history"]);
  const node = purchased.data.generation.node;
  const executions = (await command(["graph", "node", id, node])).data.executions;
  const purchaseIds = executions
    .filter((entry) => entry.provider_image_attempt_id)
    .map((entry) => entry.execution_id);
  if (!purchaseIds.length) throw new Error("Purchased execution identity is missing");
  const attempts = (await command(["graph", "attempts"])).data;
  // A new cache forces reconstruction; an empty key suppresses saved credentials.
  const offline = { AI_GATEWAY_API_KEY: "", PHOTOCTL_CACHE: join(output, prefix + "replay-cache") };
  await command(["undo", id], undefined, offline);
  const undone = (await command(["graph", "show", id], undefined, offline)).data;
  if (undone.revision_id === graph.data.revision_id)
    throw new Error("Undo did not change revision");
  await command(["redo", id], undefined, offline);
  const restored = (await command(["graph", "show", id], undefined, offline)).data;
  if (restored.revision_id !== graph.data.revision_id)
    throw new Error("Redo did not restore revision");
  const after = await capture(id, prefix + "replayed", offline);
  if (before.pixelSha256 !== after.pixelSha256)
    throw new Error("Undo/redo changed purchased pixels");
  const replayExecutions = (await command(["graph", "node", id, node], undefined, offline)).data
    .executions;
  const replayAttempts = (await command(["graph", "attempts"], undefined, offline)).data;
  if (
    JSON.stringify(executions) !== JSON.stringify(replayExecutions) ||
    JSON.stringify(attempts) !== JSON.stringify(replayAttempts)
  )
    throw new Error("Replay changed purchased executions or attempts");
  return {
    samePixels: true,
    pixelSha256: before.pixelSha256,
    purchaseIds,
    beforeRevision: graph.data.revision_id,
    undoRevision: undone.revision_id,
    afterRevision: restored.revision_id,
  };
}

async function capture(id, name, overrides = {}) {
  const shown = await command(["show", id, "--preview-size", "1024"], undefined, overrides);
  const bytes = await readFile(shown.data.preview);
  const image = sharp(bytes);
  const metadata = await image.metadata();
  const pixels = await image.raw().toBuffer();
  const file = name + ".jpg";
  await writeFile(join(output, file), bytes);
  return {
    file,
    dimensions: { w: metadata.width, h: metadata.height },
    pixelSha256: createHash("sha256").update(pixels).digest("hex"),
  };
}

async function stage(name, operation) {
  if (only && only !== name) return undefined;
  const started = performance.now();
  try {
    const result = await operation();
    report.stages.push({
      name,
      status: "passed",
      durationMs: performance.now() - started,
      ...result,
    });
    return result;
  } catch (error) {
    if (interrupted) throw error;
    report.stages.push({
      name,
      status: "failed",
      durationMs: performance.now() - started,
      error: safeError(error),
    });
    return undefined;
  } finally {
    await save();
  }
}

function safeError(error) {
  return {
    code: error.code ?? "verification_failed",
    message: error.message,
    envelope: error.envelope,
  };
}

async function save() {
  const text = JSON.stringify(
    report,
    (_name, value) =>
      key && typeof value === "string" ? value.replaceAll(key, "[redacted]") : value,
    2,
  );
  await writeFile(join(output, "report.json"), text + "\n");
}
