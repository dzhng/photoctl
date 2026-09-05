import { createHash } from "node:crypto";
import { basename, join, parse } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  buildGuardedUpscalePrompt,
  createUpscaleRegistry,
  type UpscaleArtifact,
  type UpscaleRegistry,
} from "@photoctl/providers";
import { resolveUpscalePolicy, type UpscalePolicySettings } from "@photoctl/render";

export interface UpscaleSpikeDependencies {
  upscaleRegistry?: UpscaleRegistry;
  upscaleSettings?: UpscalePolicySettings;
  upscaleControls?: {
    scale: number;
    fidelity: number;
    creativity: number;
    seed: number;
    originalOperation: string;
  };
}

export async function runUpscaleSpike(
  sources: string[],
  outputDirectory: string,
  dependencies: UpscaleSpikeDependencies,
): Promise<string> {
  const output = join(outputDirectory, "upscale-spike.json");
  const registry = dependencies.upscaleRegistry ?? createUpscaleRegistry();
  const policy = resolveUpscalePolicy({
    releaseDefaultModel: registry.releaseDefault,
    availableAdapterIds: registry.list().map(({ id }) => id),
    settings: dependencies.upscaleSettings,
    flag: "upscale",
    sourceContext: { tier: "workbench", pixelScale: 1, resolutionLimited: false },
  });
  const adapter = registry.get(policy.upscale.model);
  if (policy.upscale.action !== "upscale" || !adapter) {
    await writeEvidence(output, {
      schema: 1,
      status: "not_run",
      reason: "unconfigured",
      releaseDecision: "deferred",
      selectedAdapter: null,
      selectedModel: null,
      controls: null,
      contactSheet: null,
      comparisons: [],
    });
    return output;
  }
  if (sources.length === 0 || !dependencies.upscaleControls)
    throw new Error(
      "configured upscale-spike requires source paths and explicitly selected controls",
    );

  const controls = dependencies.upscaleControls;
  const completed = await runComparisons(sources, outputDirectory, registry, adapter, controls);
  const comparisons = completed.map(({ comparison }) => comparison);
  const sheetInputs = completed.flatMap(({ panels }) => panels);
  const contactSheet = "upscale-spike-contact-sheet.png";
  await renderContactSheet(sheetInputs, join(outputDirectory, contactSheet));
  await writeEvidence(output, {
    schema: 1,
    status: "completed",
    reason: null,
    releaseDecision: "deferred",
    selectedAdapter: adapter.id,
    selectedModel: policy.upscale.model,
    controls: publicControls(controls),
    contactSheet,
    comparisons,
  });
  return output;
}

async function runComparisons(
  sources: string[],
  outputDirectory: string,
  registry: UpscaleRegistry,
  adapter: Parameters<UpscaleRegistry["execute"]>[0],
  controls: NonNullable<UpscaleSpikeDependencies["upscaleControls"]>,
): Promise<Awaited<ReturnType<typeof runComparison>>[]> {
  const completed: Awaited<ReturnType<typeof runComparison>>[] = [];
  await sources.reduce(async (previous, source, sourceIndex) => {
    await previous;
    completed.push(
      await runComparison(source, sourceIndex, outputDirectory, registry, adapter, controls),
    );
  }, Promise.resolve());
  return completed;
}

async function runComparison(
  source: string,
  index: number,
  outputDirectory: string,
  registry: UpscaleRegistry,
  adapter: Parameters<UpscaleRegistry["execute"]>[0],
  controls: NonNullable<UpscaleSpikeDependencies["upscaleControls"]>,
) {
  const artifact = await loadArtifact(source);
  const outputStem = `${index + 1}-${parse(source).name}`;
  const guardedPrompt = buildGuardedUpscalePrompt(controls.originalOperation);
  const guarded = await runArm(
    registry,
    adapter,
    artifact,
    guardedPrompt.derived,
    controls,
    join(outputDirectory, `${outputStem}-guarded.png`),
  );
  const minimal = await runArm(
    registry,
    adapter,
    artifact,
    "Preserve the source image without adding or changing content.",
    controls,
    join(outputDirectory, `${outputStem}-minimal.png`),
  );
  return {
    comparison: {
      source: basename(source),
      sourceDimensions: artifact.dimensions,
      guarded: guarded.evidence,
      minimal: minimal.evidence,
      drift: { meanAbsoluteError: await meanAbsoluteError(guarded.bytes, minimal.bytes) },
    },
    panels: [
      { label: `${basename(source)} · guarded`, bytes: guarded.bytes },
      { label: `${basename(source)} · minimal`, bytes: minimal.bytes },
    ],
  };
}

async function loadArtifact(path: string): Promise<UpscaleArtifact> {
  const bytes = await readFile(path);
  const metadata = await sharp(bytes).metadata();
  if (metadata.format !== "png") throw new Error(`Upscale spike source must be PNG: ${path}`);
  if (!metadata.width || !metadata.height)
    throw new Error(`Cannot read source dimensions: ${path}`);
  return {
    bytes,
    mediaType: "image/png",
    hash: `a_${createHash("sha256").update(bytes).digest("hex")}`,
    dimensions: { w: metadata.width, h: metadata.height },
  };
}

async function runArm(
  registry: UpscaleRegistry,
  adapter: Parameters<UpscaleRegistry["execute"]>[0],
  artifact: UpscaleArtifact,
  prompt: string,
  controls: NonNullable<UpscaleSpikeDependencies["upscaleControls"]>,
  output: string,
) {
  const started = performance.now();
  const result = await registry.execute(adapter, { artifact, prompt, ...publicControls(controls) });
  const latencyMs = Math.round(performance.now() - started);
  if (!result.ok) throw new Error(result.message);
  await writeFile(output, result.value.artifact.bytes);
  return {
    bytes: result.value.artifact.bytes,
    evidence: {
      dimensions: result.value.dimensions,
      latencyMs,
      costUsd: result.value.provenance.costUsd,
      resolvedControls: publicControls(controls),
      output: basename(output),
      providerDurationMs: result.value.provenance.durationMs,
      requestId: result.value.provenance.requestId,
    },
  };
}

function publicControls(controls: NonNullable<UpscaleSpikeDependencies["upscaleControls"]>) {
  return {
    scale: controls.scale,
    fidelity: controls.fidelity,
    creativity: controls.creativity,
    seed: controls.seed,
  };
}

async function meanAbsoluteError(left: Buffer, right: Buffer): Promise<number> {
  const [leftImage, rightImage] = await Promise.all([
    sharp(left).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (
    leftImage.info.width !== rightImage.info.width ||
    leftImage.info.height !== rightImage.info.height
  )
    return 1;
  let sum = 0;
  for (let index = 0; index < leftImage.data.length; index += 1)
    sum += Math.abs(leftImage.data[index]! - rightImage.data[index]!);
  return Number((sum / leftImage.data.length / 255).toFixed(6));
}

async function renderContactSheet(
  inputs: Array<{ label: string; bytes: Buffer }>,
  output: string,
): Promise<void> {
  const panels = await Promise.all(
    inputs.map(async ({ label, bytes }) => {
      const image = await sharp(bytes)
        .resize({ width: 480, height: 360, fit: "inside" })
        .png()
        .toBuffer();
      const metadata = await sharp(image).metadata();
      return { label, image, width: metadata.width!, height: metadata.height! };
    }),
  );
  const width = Math.max(...panels.map((panel) => panel.width));
  const panelHeight = Math.max(...panels.map((panel) => panel.height)) + 40;
  const canvas = sharp({
    create: {
      width: width * 2 + 24,
      height: Math.ceil(panels.length / 2) * panelHeight,
      channels: 3,
      background: "#fff",
    },
  });
  await canvas
    .composite(
      panels.flatMap((panel, index) => {
        const left = (index % 2) * (width + 24);
        const top = Math.floor(index / 2) * panelHeight;
        const label = Buffer.from(
          `<svg width="${width}" height="32"><text x="8" y="22" font-family="sans-serif" font-size="16">${escapeXml(panel.label)}</text></svg>`,
        );
        return [
          { input: label, left, top },
          { input: panel.image, left, top: top + 36 },
        ];
      }),
    )
    .png()
    .toFile(output);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

async function writeEvidence(path: string, evidence: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
