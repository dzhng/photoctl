import { cacheRootForLibrary } from "@photoctl/importer";
import type { LibraryHandle } from "@photoctl/library";
import {
  prepareStandaloneGeneratedPhoto,
  resolveUpscalePolicy,
  type FillUpscaleDependencies,
} from "@photoctl/render";
import {
  buildGuardedUpscalePrompt,
  createGatewayImageModelAdapter,
  createUpscaleRegistry,
  GatewayClient,
  readProviderSettings,
  resolveModel,
  type ImageModelAdapter,
  type UpscaleRegistry,
} from "@photoctl/providers";
import { PhotoctlError, type Envelope, type GenerateData } from "@photoctl/protocol";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { parseArguments } from "../arguments.js";
import { cacheBase, openRequestLibrary, readLibraryId, type RequestEnv } from "../context.js";
import { createProgressHeartbeat } from "../progress.js";
import { importGeneratedArtifact } from "./import.js";

export interface GenerateDependencies {
  adapter: ImageModelAdapter;
  gateway: {
    imageGenerations(body: Record<string, unknown>): Promise<{
      data: unknown;
      requestId: string | null;
      attempts: number;
    }>;
  };
  model: string;
  upscaleRegistry?: UpscaleRegistry;
  upscaleSettings?: import("@photoctl/render").UpscalePolicySettings;
}

export async function generateCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: GenerateDependencies,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, {
    flags: ["--upscale"],
    options: ["--prompt", "--ref", "--size", "--seed", "--model"],
  });
  if (parsed.positionals.length !== 0)
    throw new PhotoctlError("usage", "generate does not accept positional arguments");
  const prompt = parsed.options.get("--prompt")?.trim();
  if (!prompt) throw new PhotoctlError("usage", "generate requires --prompt");
  const dimensions = parseSize(parsed.options.get("--size") ?? "1024x1024");
  const seed = parseSeed(parsed.options.get("--seed"));
  const reference = await readReference(parsed.options.get("--ref"), cwd);
  const lease = await openRequestLibrary(env, cwd, provided);
  const progress = createProgressHeartbeat({
    emit:
      emit &&
      (async (event) => {
        try {
          await emit(event);
        } catch {
          // Progress is advisory; a broken side channel must not misreport a committed import.
        }
      }),
    phase: "generate",
    total: 1,
  });
  let progressStarted = false;
  try {
    await progress.start();
    progressStarted = true;
    const settings = await readProviderSettings(lease.handle);
    const model =
      providedDependencies?.model ??
      resolveModel("generate", settings.models, parsed.options.get("--model"));
    const adapter = providedDependencies?.adapter ?? createGatewayImageModelAdapter({ model });
    const gateway =
      providedDependencies?.gateway ??
      new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl });
    const registry = providedDependencies?.upscaleRegistry ?? createUpscaleRegistry();
    const explicitUpscale = parsed.flags.has("--upscale");
    let upscale: FillUpscaleDependencies | undefined;
    if (explicitUpscale) {
      const policy = resolveUpscalePolicy({
        releaseDefaultModel: registry.releaseDefault,
        availableAdapterIds: registry.list().map(({ id }) => id),
        settings: providedDependencies?.upscaleSettings ?? settings,
        flag: "upscale",
        sourceContext: { tier: "standalone", pixelScale: 1, resolutionLimited: false },
      });
      const selected = registry.get(policy.upscale.model);
      const guarded = buildGuardedUpscalePrompt(prompt);
      upscale = {
        policy,
        prompt: guarded,
        ...(selected
          ? {
              adapter: {
                id: selected.id,
                version: selected.version,
                supportedScales: selected.supportedScales,
                limits: selected.limits,
                execute: async (input) => await registry.execute(selected, input),
              },
            }
          : {}),
      };
    }
    const prepared = await prepareStandaloneGeneratedPhoto(lease.handle.path, {
      dimensions,
      prompt,
      promptVersion: 1,
      ...(seed === undefined ? {} : { seed }),
      referencePixels: reference?.pixels ?? 0,
      referenceUsed: reference !== undefined,
      dependencies: { adapter, gateway, model },
      body: adapter.buildGeneration(prompt, dimensions, seed, reference),
      ...(upscale ? { upscale } : {}),
    });
    const cacheRoot = cacheRootForLibrary(await readLibraryId(lease.handle), cacheBase(env, cwd));
    const imported = await importGeneratedArtifact({
      path: prepared.finalArtifact.path,
      handle: lease.handle,
      cacheRoot,
      revision: () => ({
        expectedRevisionId: null,
        nodes: prepared.nodes,
        rootUpdates: [
          { root: "base", node: prepared.output },
          { root: "output", node: prepared.output },
        ],
        artifacts: prepared.artifacts,
        executions: prepared.executions,
        metadata: { operation: "generate", version: 1 },
      }),
    });
    await progress.advance(1);
    const outputNode = imported.revision.roots.output! as `node_${string}`;
    const resultUpscale = {
      ...prepared.upscale,
      model: upscale?.policy.upscale.model ?? registry.releaseDefault,
      node: prepared.upscale.nodeId,
      density_satisfied: prepared.upscale.densitySatisfied,
    };
    return {
      schema: 1,
      ok: true,
      data: {
        id: imported.photoId,
        revision_id: imported.revision.revisionId,
        render_hash: imported.revision.renderHash! as `r_${string}`,
        output_node: outputNode,
        tag: "generated",
        requested: dimensions,
        reference: { used: reference !== undefined },
        artifact: {
          hash: prepared.finalArtifact.artifactHash,
          media_type: "image/tiff",
          w: prepared.finalArtifact.w,
          h: prepared.finalArtifact.h,
        },
        generation: {
          node: prepared.generation.nodeId,
          adapter: adapter.id,
          model,
          returned: prepared.generation.returnedDimensions,
        },
        upscale: {
          enabled: resultUpscale.enabled,
          executed: resultUpscale.executed,
          node: resultUpscale.node,
          adapter: resultUpscale.adapter,
          model: resultUpscale.model,
          input: resultUpscale.input,
          target: resultUpscale.target,
          generated: resultUpscale.generated,
          final: resultUpscale.final,
          density_satisfied: resultUpscale.density_satisfied,
          warnings: resultUpscale.warnings,
        },
        executions: [
          {
            kind: "generate" as const,
            node: prepared.generation.nodeId,
            adapter: prepared.generation.provider.adapter,
            model: prepared.generation.provider.model,
            duration_ms: prepared.generation.provider.durationMs,
            cost_usd: prepared.generation.provider.costUsd,
            reused: false as const,
          },
          ...(prepared.upscale.nodeId && prepared.upscale.provider
            ? [
                {
                  kind: "upscale" as const,
                  node: prepared.upscale.nodeId,
                  adapter: prepared.upscale.provider.adapter,
                  model: prepared.upscale.provider.model,
                  duration_ms: prepared.upscale.provider.durationMs,
                  cost_usd: prepared.upscale.provider.costUsd,
                  reused: false as const,
                },
              ]
            : []),
        ],
      } satisfies GenerateData,
      warnings: prepared.warnings,
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    throw new PhotoctlError("catalog_unreadable", "Could not commit generated photo", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      if (progressStarted) await progress.stop();
    } finally {
      await lease.release();
    }
  }
}

function parseSize(value: string): { w: number; h: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  const w = Number(match?.[1]);
  const h = Number(match?.[2]);
  if (
    !Number.isSafeInteger(w) ||
    !Number.isSafeInteger(h) ||
    w < 1 ||
    h < 1 ||
    w > 16_384 ||
    h > 16_384 ||
    w * h > 64_000_000
  )
    throw new PhotoctlError("usage", "--size must be WxH with at most 64 million pixels");
  return { w, h };
}

function parseSeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new PhotoctlError("usage", "--seed must be a non-negative integer");
  return seed;
}

async function readReference(value: string | undefined, cwd: string) {
  if (value === undefined) return undefined;
  const path = resolve(cwd, value);
  try {
    await access(path);
    const image = sharp(await readFile(path), { failOn: "error" }).rotate();
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) throw new Error("dimensions are missing");
    return { png: await image.png().toBuffer(), pixels: metadata.width * metadata.height };
  } catch (error) {
    throw new PhotoctlError("usage", `Could not read --ref image: ${path}`, {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
