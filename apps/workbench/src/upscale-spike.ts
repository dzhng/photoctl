import { createHash } from "node:crypto";
import { basename, dirname, join, parse, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import {
  buildGuardedUpscalePrompt,
  createUpscaleRegistry,
  type UpscaleArtifact,
  type UpscaleRegistry,
  type UpscaleInput,
} from "@photoctl/providers";

export interface UpscaleSpikeDependencies {
  upscaleRegistry?: UpscaleRegistry;
}

const categories = [
  "face-hair",
  "fabric-foliage",
  "architecture",
  "text-logo",
  "mask-texture",
] as const;
type SpikeSource = {
  path: string;
  category?: (typeof categories)[number];
  crop?: [number, number, number, number];
  mask?: string;
};
type Controls = Required<Pick<UpscaleInput, "scale" | "fidelity" | "creativity" | "seed">> & {
  originalOperation: string;
};
type Strength = { variable: "fidelity" | "creativity"; values: number[] };
type Manifest = {
  model: string;
  controls: Controls;
  controlStrength: Strength;
  sources: SpikeSource[];
};
type SuccessfulUpscale = Extract<Awaited<ReturnType<UpscaleRegistry["execute"]>>, { ok: true }>;
type CompletedRequest = Omit<SuccessfulUpscale, "value"> & {
  value: Omit<SuccessfulUpscale["value"], "artifact">;
  output: string;
  latencyMs: number;
};
type UpscaleRequests = {
  registry: UpscaleRegistry;
  adapter: Parameters<UpscaleRegistry["execute"]>[0];
  model: string;
  completed: Map<string, CompletedRequest>;
};

const object = (item: unknown, keys: string[]) =>
  item !== null &&
  typeof item === "object" &&
  !Array.isArray(item) &&
  Object.keys(item).every((key) => keys.includes(key));
const fraction = (item: unknown) =>
  typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1;

async function readManifest(path: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (
    !object(value, ["model", "controls", "controlStrength", "sources"]) ||
    typeof value.model !== "string" ||
    !object(value.controls, ["scale", "fidelity", "creativity", "seed", "originalOperation"]) ||
    !Number.isSafeInteger(value.controls.scale) ||
    value.controls.scale < 2 ||
    !fraction(value.controls.fidelity) ||
    !fraction(value.controls.creativity) ||
    !Number.isSafeInteger(value.controls.seed) ||
    typeof value.controls.originalOperation !== "string" ||
    !object(value.controlStrength, ["variable", "values"]) ||
    !["fidelity", "creativity"].includes(value.controlStrength.variable) ||
    !Array.isArray(value.controlStrength.values) ||
    value.controlStrength.values.length < 2 ||
    !value.controlStrength.values.every(fraction) ||
    new Set(value.controlStrength.values).size !== value.controlStrength.values.length ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    !value.sources.every(
      (source: SpikeSource) =>
        object(source, ["path", "category", "crop", "mask"]) &&
        typeof source.path === "string" &&
        (source.category === undefined || categories.includes(source.category)) &&
        (source.mask === undefined || typeof source.mask === "string") &&
        (source.category !== "mask-texture" || typeof source.mask === "string") &&
        (source.crop === undefined ||
          (Array.isArray(source.crop) &&
            source.crop.length === 4 &&
            source.crop.every(Number.isSafeInteger) &&
            source.crop[0] >= 0 &&
            source.crop[1] >= 0 &&
            source.crop[2] > 0 &&
            source.crop[3] > 0)),
    )
  )
    throw new Error(
      "Invalid upscale-spike manifest: select model, explicit controls, one control variable with distinct values, and PNG sources with optional category/crop/mask",
    );
  for (const source of value.sources) {
    source.path = resolve(dirname(path), source.path);
    if (source.mask) source.mask = resolve(dirname(path), source.mask);
  }
  return value;
}

export async function runUpscaleSpike(
  args: string[],
  outputDirectory: string,
  dependencies: UpscaleSpikeDependencies,
  cwd = process.cwd(),
): Promise<string> {
  const output = join(outputDirectory, "upscale-spike.json");
  await writeEvidence(output, { status: "running", releaseDecision: "deferred" });
  try {
    return await runExperiment(args, outputDirectory, dependencies, cwd);
  } catch (error) {
    await writeEvidence(output, {
      status: "failed",
      reason: "experiment_failed",
      releaseDecision: "deferred",
      qualityAcceptance: "not_recorded",
    });
    throw error;
  }
}

async function runExperiment(
  args: string[],
  outputDirectory: string,
  dependencies: UpscaleSpikeDependencies,
  cwd: string,
): Promise<string> {
  if (args.length && (args.length !== 2 || args[0] !== "--config"))
    throw new Error("usage: wb upscale-spike --config <manifest.json>");
  const manifest = args[0] === "--config" ? await readManifest(resolve(cwd, args[1]!)) : undefined;
  const output = join(outputDirectory, "upscale-spike.json");
  const registry = dependencies.upscaleRegistry ?? createUpscaleRegistry();
  const adapter = manifest ? registry.get(manifest.model) : undefined;
  if (!manifest || !adapter) {
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
  const { sources, controls, controlStrength } = manifest;
  // Preflight the entire experiment before any potentially paid arm runs.
  await sources.reduce(async (previous, source) => {
    await previous;
    const { artifact, mask } = await prepareSource(source);
    const { w, h } = artifact.dimensions;
    if (
      w * h > adapter.limits.maxInputPixels ||
      !adapter.supportedScales.some(
        (scale) =>
          scale <= controls.scale &&
          w * scale <= adapter.limits.maxOutputEdge &&
          h * scale <= adapter.limits.maxOutputEdge &&
          w * h * scale * scale <= adapter.limits.maxOutputPixels,
      )
    )
      throw new Error(`Source cannot fit selected adapter limits: ${source.path}`);
    await sharp(artifact.bytes).stats();
    if (mask) await sharp(mask.bytes).stats();
  }, Promise.resolve());
  const completed: Awaited<ReturnType<typeof runComparison>>[] = [];
  const requests: UpscaleRequests = {
    registry,
    adapter,
    model: manifest.model,
    completed: new Map(),
  };
  await sources.reduce(async (previous, source, sourceIndex) => {
    await previous;
    completed.push(
      await runComparison(
        source,
        sourceIndex,
        outputDirectory,
        requests,
        controls,
        controlStrength,
      ),
    );
  }, Promise.resolve());
  const comparisons = completed.map(({ comparison }) => comparison);
  const sheetInputs = completed.flatMap(({ panels }) => panels);
  const contactSheet = "upscale-spike-contact-sheet.png";
  const caption = `${adapter.id} @ ${adapter.version ?? "unknown"} | quality NOT assessed; provenance in upscale-spike.json`;
  await renderContactSheet(
    sheetInputs,
    join(outputDirectory, contactSheet),
    "Prompt comparison",
    caption,
  );
  const sheets: Array<{ kind: string; path: string; category?: string }> = [
    { kind: "prompt", path: contactSheet },
  ];
  const strengthSheet = "upscale-spike-control-sheet.png";
  await renderContactSheet(
    completed.flatMap(({ strengthPanels }) => strengthPanels),
    join(outputDirectory, strengthSheet),
    `Control comparison: ${manifest.controlStrength.variable}`,
    caption,
  );
  sheets.push({ kind: "control", path: strengthSheet });
  await categories.reduce(async (previous, category) => {
    await previous;
    const panels = completed
      .filter(({ comparison }) => comparison.category === category)
      .flatMap(({ validationPanels }) => validationPanels);
    if (!panels.length) return;
    const path = `upscale-spike-validation-${category}.png`;
    await renderContactSheet(
      panels,
      join(outputDirectory, path),
      `Validation: ${category}`,
      caption,
    );
    sheets.push({ kind: "validation", category, path });
  }, Promise.resolve());
  await writeEvidence(output, {
    schema: 1,
    status: "completed",
    reason: null,
    releaseDecision: "deferred",
    qualityAcceptance: "not_recorded",
    providerRequests: requests.completed.size,
    providerCostUsd: [...requests.completed.values()].reduce(
      (sum, request) => sum + request.value.provenance.costUsd,
      0,
    ),
    categoryCoverage: {
      present: categories.filter((category) =>
        sources.some((source) => source.category === category),
      ),
      missing: categories.filter(
        (category) => !sources.some((source) => source.category === category),
      ),
    },
    selectedAdapter: adapter.id,
    selectedModel: manifest.model,
    controls: publicControls(controls),
    controlStrength,
    contactSheet,
    sheets,
    comparisons,
  });
  return output;
}

async function runComparison(
  source: SpikeSource,
  index: number,
  outputDirectory: string,
  requests: UpscaleRequests,
  controls: Controls,
  strength: Strength,
) {
  const { artifact, crop, mask } = await prepareSource(source);
  const outputStem = `${index + 1}-${parse(source.path).name}`;
  const sourceOutput = `${outputStem}-source.png`;
  await writeFile(join(outputDirectory, sourceOutput), artifact.bytes);
  const sourceDetail = await sharp(artifact.bytes)
    .extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
    .png()
    .toBuffer();
  await writeFile(join(outputDirectory, `${outputStem}-source-detail.png`), sourceDetail);
  if (mask) {
    await writeFile(join(outputDirectory, `${outputStem}-mask.png`), mask.bytes);
    await sharp(mask.bytes)
      .extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
      .png()
      .toFile(join(outputDirectory, `${outputStem}-mask-detail.png`));
  }
  const guardedPrompt = buildGuardedUpscalePrompt(controls.originalOperation);
  const guarded = await runArm(
    requests,
    artifact,
    guardedPrompt.derived,
    controls,
    join(outputDirectory, `${outputStem}-guarded-detail.png`),
    crop,
  );
  const minimal = await runArm(
    requests,
    artifact,
    "Preserve the source image without adding or changing content.",
    controls,
    join(outputDirectory, `${outputStem}-minimal-detail.png`),
    crop,
  );
  const strengthArms: Awaited<ReturnType<typeof runArm>>[] = [];
  await strength.values.reduce(async (previous, value) => {
    await previous;
    strengthArms.push(
      await runArm(
        requests,
        artifact,
        guardedPrompt.derived,
        { ...controls, [strength.variable]: value },
        join(outputDirectory, `${outputStem}-${strength.variable}-${value}-detail.png`),
        crop,
      ),
    );
  }, Promise.resolve());
  const context = [
    { label: `Source ${index + 1}`, path: join(outputDirectory, sourceOutput) },
    {
      label: "Source detail (native pixels)",
      path: join(outputDirectory, `${outputStem}-source-detail.png`),
      native: true,
    },
  ];
  return {
    comparison: {
      source: basename(source.path),
      sourceHash: artifact.hash,
      sourceOutput,
      crop,
      sourceDetail: `${outputStem}-source-detail.png`,
      category: source.category ?? null,
      mask: mask
        ? {
            path: `${outputStem}-mask.png`,
            hash: mask.hash,
            role: "inspection-only; not sent to upscaler",
          }
        : null,
      sourceDimensions: artifact.dimensions,
      guarded,
      minimal,
      strength: strengthArms,
      drift: {
        meanAbsoluteError: await meanAbsoluteError(
          join(outputDirectory, guarded.output),
          join(outputDirectory, minimal.output),
        ),
      },
    },
    panels: [
      ...context,
      ...outputPanels(guarded, "Guarded prompt", outputDirectory),
      ...outputPanels(minimal, "Minimal prompt", outputDirectory),
    ],
    strengthPanels: [
      ...context,
      ...strengthArms.flatMap((arm, armIndex) =>
        outputPanels(arm, `${strength.variable} ${strength.values[armIndex]}`, outputDirectory),
      ),
    ],
    validationPanels: [
      ...context,
      ...outputPanels(
        guarded,
        source.category === "text-logo" ? "Expected danger: text/logo" : "Guarded validation",
        outputDirectory,
      ),
      ...(mask
        ? [
            {
              label: "Mask (inspection only)",
              path: join(outputDirectory, `${outputStem}-mask.png`),
            },
            {
              label: "Mask detail (native pixels)",
              native: true,
              path: join(outputDirectory, `${outputStem}-mask-detail.png`),
            },
          ]
        : []),
    ],
  };
}

function outputPanels(
  arm: Awaited<ReturnType<typeof runArm>>,
  label: string,
  outputDirectory: string,
) {
  return [
    { label, path: join(outputDirectory, arm.output) },
    {
      label: `${label} detail (native)`,
      path: join(outputDirectory, arm.detail),
      native: true,
    },
  ];
}

async function prepareSource(source: SpikeSource) {
  const artifact = await loadArtifact(source.path);
  const crop = source.crop ?? [
    0,
    0,
    Math.min(240, artifact.dimensions.w),
    Math.min(180, artifact.dimensions.h),
  ];
  if (crop[0]! + crop[2]! > artifact.dimensions.w || crop[1]! + crop[3]! > artifact.dimensions.h)
    throw new Error(`Crop exceeds source: ${source.path}`);
  const mask = source.mask ? await loadArtifact(source.mask) : undefined;
  if (
    mask &&
    (mask.dimensions.w !== artifact.dimensions.w || mask.dimensions.h !== artifact.dimensions.h)
  )
    throw new Error(`Mask must match source dimensions: ${source.mask}`);
  return { artifact, crop: crop as [number, number, number, number], mask };
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
  requests: UpscaleRequests,
  artifact: UpscaleArtifact,
  prompt: string,
  controls: Controls,
  detailPath: string,
  crop: [number, number, number, number],
) {
  const { registry, adapter } = requests;
  const requestIdentity = createHash("sha256")
    .update(
      JSON.stringify({
        source: artifact.hash,
        adapter: adapter.id,
        version: adapter.version,
        model: requests.model,
        prompt,
        controls: publicControls(controls),
      }),
    )
    .digest("hex");
  let result = requests.completed.get(requestIdentity);
  if (!result) {
    const started = performance.now();
    const executed = await registry.execute(adapter, {
      artifact,
      prompt,
      ...publicControls(controls),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!executed.ok) throw new Error(executed.message);
    const { artifact: providerOutput, ...value } = executed.value;
    const output = join(dirname(detailPath), `request-${requestIdentity}.png`);
    await writeFile(output, providerOutput.bytes);
    result = { ...executed, value, output, latencyMs };
    requests.completed.set(requestIdentity, result);
  }
  const frame = result.value.frameMapping?.output ?? [
    0,
    0,
    result.value.dimensions.w,
    result.value.dimensions.h,
  ];
  const left = Math.floor((crop[0] * frame[2]!) / artifact.dimensions.w);
  const top = Math.floor((crop[1] * frame[3]!) / artifact.dimensions.h);
  await sharp(result.output)
    .extract({
      left: frame[0]! + left,
      top: frame[1]! + top,
      width: Math.ceil(((crop[0] + crop[2]) * frame[2]!) / artifact.dimensions.w) - left,
      height: Math.ceil(((crop[1] + crop[3]) * frame[3]!) / artifact.dimensions.h) - top,
    })
    .png()
    .toFile(detailPath);
  return {
    dimensions: result.value.dimensions,
    latencyMs: result.latencyMs,
    requestIdentity,
    costUsd: result.value.provenance.costUsd,
    sourceHash: artifact.hash,
    prompt,
    targetDimensions: {
      w: artifact.dimensions.w * controls.scale,
      h: artifact.dimensions.h * controls.scale,
    },
    requestedControls: publicControls(controls),
    resolvedControls: null,
    provenance: result.value.provenance,
    samplingDimensions: result.samplingDimensions,
    densitySatisfied: result.densitySatisfied,
    warnings: result.warnings,
    detail: basename(detailPath),
    output: basename(result.output),
    providerDurationMs: result.value.provenance.durationMs,
    requestId: result.value.provenance.requestId,
  };
}

function publicControls(controls: Controls) {
  return {
    scale: controls.scale,
    fidelity: controls.fidelity,
    creativity: controls.creativity,
    seed: controls.seed,
  };
}

async function meanAbsoluteError(left: string, right: string): Promise<number> {
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
  inputs: Array<{ label: string; path: string; native?: boolean }>,
  output: string,
  title: string,
  caption: string,
): Promise<void> {
  const panels = await Promise.all(
    inputs.map(async ({ label, path, native }) => {
      const original = await sharp(path).metadata();
      const fitted = native && (original.width! > 480 || original.height! > 360);
      const image = await sharp(path)
        .resize({ width: 480, height: 360, fit: "inside", withoutEnlargement: native })
        .png()
        .toBuffer();
      const metadata = await sharp(image).metadata();
      return {
        label: fitted
          ? `Detail: fit preview (${original.width}×${original.height} native PNG saved)`
          : native
            ? `${label} · ${original.width}×${original.height}`
            : label,
        image: await sharp(image)
          .extend({ top: 1, bottom: 1, left: 1, right: 1, background: "#aaa" })
          .png()
          .toBuffer(),
        width: metadata.width! + 2,
        height: metadata.height! + 2,
      };
    }),
  );
  const width = Math.max(480, ...panels.map((panel) => panel.width));
  const panelHeight = Math.max(...panels.map((panel) => panel.height)) + 40;
  const canvas = sharp({
    create: {
      width: width * 2 + 24,
      height: Math.ceil(panels.length / 2) * panelHeight + 72,
      channels: 3,
      background: "#fff",
    },
  });
  await canvas
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width * 2 + 24}" height="64"><text x="8" y="24" font-family="sans-serif" font-size="16">${escapeXml(title)}</text><text x="8" y="48" font-family="sans-serif" font-size="14">${escapeXml(caption)}</text></svg>`,
        ),
        left: 0,
        top: 0,
      },
      ...panels.flatMap((panel, index) => {
        const left = (index % 2) * (width + 24);
        const top = Math.floor(index / 2) * panelHeight + 72;
        const label = Buffer.from(
          `<svg width="${width}" height="32"><text x="8" y="22" font-family="sans-serif" font-size="16">${escapeXml(panel.label)}</text></svg>`,
        );
        return [
          { input: label, left, top },
          { input: panel.image, left, top: top + 36 },
        ];
      }),
    ])
    .png()
    .toFile(output);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => `&#${character.codePointAt(0)};`);
}

async function writeEvidence(path: string, evidence: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
