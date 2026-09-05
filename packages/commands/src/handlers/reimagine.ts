import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  createReimagineLayer,
  resolveUpscalePolicy,
  RevisionConflictError,
} from "@photoctl/render";
import {
  buildGuardedUpscalePrompt,
  buildReimaginePrompt,
  createGatewayImageModelAdapter,
  createUpscaleRegistry,
  GatewayClient,
  readProviderSettings,
  resolveModel,
} from "@photoctl/providers";
import {
  generationSourceTierSchema,
  PhotoctlError,
  type Envelope,
  type ReimagineData,
} from "@photoctl/protocol";
import { parseArguments } from "../arguments.js";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";
import { createProgressHeartbeat } from "../progress.js";
import { withGenerationSource, type GenerationCommandDependencies } from "./generation-source.js";

export async function reimagineCommand(
  args: string[],
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: GenerationCommandDependencies,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
): Promise<Envelope> {
  const parsed = parseArguments(args, { options: ["--prompt", "--strength"] });
  if (parsed.positionals.length !== 1)
    throw new PhotoctlError("usage", "reimagine requires exactly one photo ID or prefix");
  const prompt = parsed.options.get("--prompt");
  if (!prompt) throw new PhotoctlError("usage", "reimagine requires --prompt");
  const strength = parseStrength(parsed.options.get("--strength"));
  const reimaginePrompt = buildReimaginePrompt(prompt, strength);
  const lease = await openRequestLibrary(env, cwd, provided);
  const progress = createProgressHeartbeat({
    emit:
      emit &&
      (async (event) => {
        try {
          await emit(event);
        } catch {
          // Progress is advisory; a broken side channel must not misreport a committed mutation.
        }
      }),
    phase: "reimagine",
    total: 1,
  });
  let progressStarted = false;
  try {
    await progress.start();
    progressStarted = true;
    const id = await resolvePhotoId(lease.handle, parsed.positionals[0]!);
    const photo = await loadPhoto(lease.handle, id);
    const settings = await readProviderSettings(lease.handle);
    const model = providedDependencies?.model ?? resolveModel("edit", settings.models, undefined);
    const adapter = createGatewayImageModelAdapter({ model });
    const dependencies = providedDependencies
      ? { ...providedDependencies, adapter: providedDependencies.adapter }
      : {
          adapter,
          gateway: new GatewayClient({ apiKey: env.gatewayApiKey, baseUrl: env.gatewayUrl }),
          model,
        };
    const upscaleRegistry = providedDependencies?.upscaleRegistry ?? createUpscaleRegistry();
    const guardedPrompt = buildGuardedUpscalePrompt(prompt);
    const result = await withGenerationSource(
      lease.handle,
      env,
      cwd,
      photo,
      dependencies,
      async ({ source, sourceContext }) => {
        const policy = resolveUpscalePolicy({
          releaseDefaultModel: upscaleRegistry.releaseDefault,
          availableAdapterIds: upscaleRegistry.list().map(({ id: adapterId }) => adapterId),
          settings: providedDependencies?.upscaleSettings ?? settings,
          sourceContext,
        });
        const selected = upscaleRegistry.get(policy.upscale.model);
        return await createReimagineLayer(lease.handle, lease.handle.path, {
          photoId: id,
          orientation: photo.orientation,
          dimensions: { w: photo.w, h: photo.h },
          prompt,
          promptVersion: reimaginePrompt.version,
          providerPrompt: reimaginePrompt.derived,
          strength,
          source,
          sourceContext,
          dependencies,
          upscale: {
            policy,
            prompt: guardedPrompt,
            ...(selected
              ? {
                  adapter: {
                    id: selected.id,
                    version: selected.version,
                    supportedScales: selected.supportedScales,
                    limits: selected.limits,
                    execute: async (input) => await upscaleRegistry.execute(selected, input),
                  },
                }
              : {}),
          },
        });
      },
    );
    await progress.advance(1);
    return {
      schema: 1,
      ok: true,
      data: {
        id,
        layer_id: result.layerId,
        revision_id: result.revisionId,
        render_hash: result.renderHash,
        output_node: result.outputNodeId,
        drift: "full-frame",
        strength,
        generation: {
          node: result.generationNodeId,
          adapter: dependencies.adapter.id,
          model: dependencies.model,
          returned: result.returnedDimensions,
        },
        source_context: {
          tier: generationSourceTierSchema.parse(result.sourceContext.tier),
          pixel_scale: result.sourceContext.pixelScale,
          resolution_limited: result.sourceContext.resolutionLimited,
        },
        upscale: {
          enabled: result.upscale.enabled,
          executed: result.upscale.executed,
          node: result.upscale.nodeId,
          adapter: result.upscale.adapter,
          model: result.upscale.model,
          input: result.upscale.input,
          target: result.upscale.target,
          generated: result.upscale.generated,
          final: result.upscale.final,
          density_satisfied: result.upscale.densitySatisfied,
          warnings: result.upscale.warnings,
        },
        executions: result.executions.map(({ kind, nodeId, provider }) => ({
          kind,
          node: nodeId,
          adapter: provider.adapter,
          model: provider.model,
          duration_ms: provider.durationMs,
          cost_usd: provider.costUsd,
          reused: false,
        })),
      } satisfies ReimagineData,
      warnings: result.warnings,
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (error instanceof RevisionConflictError)
      throw new PhotoctlError("library_locked", error.message, {
        id: parsed.positionals[0],
        reason: "revision_conflict",
      });
    if (
      error instanceof Error &&
      error.message ===
        "Reimagine requires the current develop output to retain the oriented base dimensions"
    )
      throw new PhotoctlError("usage", error.message, { id: parsed.positionals[0] });
    throw new PhotoctlError("catalog_unreadable", "Could not commit reimagine", {
      id: parsed.positionals[0],
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

function parseStrength(value: string | undefined): number {
  if (value === undefined) return 1;
  const strength = Number(value);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new PhotoctlError("usage", "--strength must be between 0 and 1");
  return strength;
}
