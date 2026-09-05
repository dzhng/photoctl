import { resolvePhotoId, type LibraryHandle } from "@photoctl/library";
import {
  createReimagineLayer,
  resolveUpscalePolicy,
  RevisionConflictError,
} from "@photoctl/render";
import {
  buildGuardedUpscalePrompt,
  createGatewayImageModelAdapter,
  createUpscaleRegistry,
  GatewayClient,
  readProviderSettings,
  resolveModel,
} from "@photoctl/providers";
import { generationSourceTierSchema, PhotoctlError } from "@photoctl/protocol";
import { openRequestLibrary, type RequestEnv } from "../context.js";
import { loadPhoto } from "../photo.js";
import { createProgressHeartbeat } from "../progress.js";
import { withGenerationSource, type GenerationCommandDependencies } from "./generation-source.js";

interface FullFrameGenerationRequest {
  id: string;
  prompt: string;
  providerPrompt: string;
  promptVersion: number;
  strength: number;
  operation: "reimagine" | "relight";
}

export async function executeFullFrameGeneration(
  request: FullFrameGenerationRequest,
  env: RequestEnv,
  cwd: string,
  provided?: LibraryHandle,
  providedDependencies?: GenerationCommandDependencies,
  emit?: (event: import("@photoctl/protocol").StderrEvent) => void | Promise<void>,
) {
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
    phase: request.operation,
    total: 1,
  });
  let progressStarted = false;
  try {
    await progress.start();
    progressStarted = true;
    const id = await resolvePhotoId(lease.handle, request.id);
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
    const guardedPrompt = buildGuardedUpscalePrompt(request.prompt);
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
          prompt: request.prompt,
          promptVersion: request.promptVersion,
          providerPrompt: request.providerPrompt,
          strength: request.strength,
          layerName: request.operation === "reimagine" ? "Reimagine" : "Relight",
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
      id,
      result,
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
        reused: false as const,
      })),
    };
  } catch (error) {
    if (error instanceof PhotoctlError) throw error;
    if (error instanceof RevisionConflictError)
      throw new PhotoctlError("library_locked", error.message, {
        id: request.id,
        reason: "revision_conflict",
      });
    if (
      error instanceof Error &&
      error.message ===
        "Full-frame generation requires the current develop output to retain the oriented base dimensions"
    )
      throw new PhotoctlError("usage", error.message, { id: request.id });
    throw new PhotoctlError("catalog_unreadable", `Could not commit ${request.operation}`, {
      id: request.id,
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
