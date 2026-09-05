import { PhotoctlError, type Warning } from "@photoctl/protocol";
import type { UpscaleInput, UpscaleExecutionAdapter } from "@photoctl/providers";
import { normalizeArtifact, publishArtifact } from "../artifacts/publication.js";
import { cropMappedExternalImage, decodeExternalImage } from "../fill/external-pixels.js";
import type { GraphDatabase } from "../graph/store.js";
import { runProviderImageAttempt, ProviderImageAttemptError } from "./attempts.js";

/** Retains the complete returned image before registry policy or mapped working-image extraction. */
export async function executeRetainedUpscale(
  database: GraphDatabase,
  libraryPath: string,
  adapter: UpscaleExecutionAdapter,
  input: UpscaleInput,
) {
  try {
    const attempt = await runProviderImageAttempt(
      database,
      libraryPath,
      {
        operation: "upscale",
        adapter: adapter.id,
        adapter_version: adapter.version,
        model: adapter.id,
        prompt: input.prompt ?? "",
        dimensions: input.artifact.dimensions,
        input_artifact_hashes: [input.artifact.hash],
        scale: input.scale,
        ...(input.seed === undefined ? {} : { seed: input.seed }),
        ...(input.fidelity === undefined ? {} : { fidelity: input.fidelity }),
        ...(input.creativity === undefined ? {} : { creativity: input.creativity }),
      },
      async (attempt) => {
        const result = await adapter.execute(
          input,
          async (value) =>
            await attempt.retain(value.artifact.bytes, {
              request_id: value.provenance.requestId,
              service: value.provenance.service,
              model: value.provenance.model,
              model_version: value.provenance.modelVersion,
              seed: value.provenance.seed,
              duration_ms: value.provenance.durationMs,
              cost_usd: value.provenance.costUsd,
              native_tiling: value.provenance.nativeTiling
                ? {
                    tiles: value.provenance.nativeTiling.tiles,
                    overlap_px: value.provenance.nativeTiling.overlapPx,
                  }
                : null,
              frame_mapping: value.frameMapping
                ? { source: [...value.frameMapping.source], output: [...value.frameMapping.output] }
                : null,
              transport_attempts: null,
            }),
        );
        if (!result.ok) throw new PhotoctlError("provider_whole_frame", result.message);
        const bytes = result.value.frameMapping
          ? await cropMappedExternalImage(
              result.value.artifact.bytes,
              result.value.frameMapping.output,
            )
          : result.value.artifact.bytes;
        const image = await decodeExternalImage(bytes, result.samplingDimensions);
        const artifact = await publishArtifact(libraryPath, await normalizeArtifact(image));
        return { ...result, image, artifact };
      },
    );
    return { ...attempt.value, attemptId: attempt.attemptId };
  } catch (error) {
    if (!(error instanceof ProviderImageAttemptError) || error.captureFailed) throw error;
    return {
      ok: false as const,
      code: "upscale_failed" as const,
      message: error.message,
      warnings: [
        {
          code: "upscale_failed",
          message: `${error.message} (attempt ${error.attemptId})`,
          attempt_id: error.attemptId,
        },
      ] satisfies Warning[],
    };
  }
}
