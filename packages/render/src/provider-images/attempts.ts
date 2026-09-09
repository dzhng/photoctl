import { randomUUID } from "node:crypto";
import { PhotoctlError, type ErrorCode } from "@photoctl/protocol";
import { ProviderImageCaptureError, InvalidProviderImageError } from "@photoctl/providers";
import type { PreparedImageEdit, PreparedImageGeneration } from "@photoctl/providers";
import {
  normalizeEncodedArtifact,
  publishArtifact,
  registerPublishedArtifact,
} from "../artifacts/publication.js";
import type { GraphDatabase, GraphTransaction } from "../graph/store.js";

export interface ProviderImageRequest {
  operation: "generate" | "edit" | "upscale";
  adapter: string;
  adapter_version: string | null;
  model: string;
  prompt: string;
  seed?: number;
  scale?: number;
  fidelity?: number;
  creativity?: number;
  provider_prompt?: string | null;
  prompt_version?: number;
  route?: "generations" | "edits";
  applied_controls?: PreparedImageEdit["appliedControls"];
  negative_prompt?: PreparedImageGeneration["negativePrompt"];
  reference_strength?: PreparedImageGeneration["referenceStrength"];
  dimensions: { w: number; h: number };
  frame_mapping?: PreparedImageEdit["frameMapping"] | null;
  input_artifact_hashes: string[];
}

export interface ProviderImageProvenance {
  request_id: string | null;
  transport_attempts: number | null;
  cost_usd: number | null;
  service?: string;
  model?: string;
  model_version?: string | null;
  seed?: number | null;
  duration_ms?: number;
  native_tiling?: { tiles: number; overlap_px: number } | null;
  frame_mapping?: { source: number[]; output: number[] } | null;
}

/** Keep inspectable request semantics, never multipart image bytes or transport credentials. */
export function imageAttemptRequestDetails(prepared: PreparedImageEdit | PreparedImageGeneration) {
  const prompt =
    prepared.body instanceof FormData ? prepared.body.get("prompt") : prepared.body.prompt;
  return {
    provider_prompt: typeof prompt === "string" ? prompt : null,
    route: "route" in prepared ? prepared.route : ("edits" as const),
    ...("negativePrompt" in prepared && prepared.negativePrompt
      ? { negative_prompt: prepared.negativePrompt }
      : {}),
    ...("referenceStrength" in prepared && prepared.referenceStrength
      ? { reference_strength: prepared.referenceStrength }
      : {}),
    applied_controls: {
      reference: prepared.appliedControls.reference,
      init: prepared.appliedControls.init,
    },
    frame_mapping: prepared.frameMapping ? { ...prepared.frameMapping } : null,
  };
}

export class ProviderImageAttemptError extends PhotoctlError {
  constructor(
    readonly attemptId: string,
    readonly captureFailed: boolean,
    error: unknown,
  ) {
    super(
      attemptErrorCode(error) ?? "provider_busy",
      error instanceof Error ? error.message : "Provider image failed",
      {
        ...(error instanceof PhotoctlError && typeof error.data === "object" && error.data
          ? error.data
          : {}),
        attempt_id: attemptId,
        ...(captureFailed ? { retention_failed: true } : {}),
      },
    );
  }
}

export async function runProviderImageAttempt<T>(
  database: GraphDatabase,
  libraryPath: string,
  request: ProviderImageRequest,
  work: (attempt: {
    id: string;
    retain(bytes: Buffer, provenance: ProviderImageProvenance): Promise<void>;
  }) => Promise<T>,
): Promise<{ value: T; attemptId: string }> {
  const id = randomUUID();
  await database.query(
    "INSERT INTO provider_image_attempts (id, request, state) VALUES ($1, $2::jsonb, 'started')",
    [
      id,
      JSON.stringify({
        schema: 1,
        ...request,
        dimensions: { w: request.dimensions.w, h: request.dimensions.h },
      }),
    ],
  );
  let retained = false;
  try {
    const value = await work({
      id,
      retain: async (bytes, provenance) => {
        let normalized;
        try {
          normalized = await normalizeEncodedArtifact(bytes);
        } catch (error) {
          throw new InvalidProviderImageError(
            error instanceof Error ? error.message : "Invalid provider image",
          );
        }
        try {
          const artifact = await publishArtifact(libraryPath, normalized);
          await database.transaction(async (transaction) => {
            await registerPublishedArtifact(transaction, artifact);
            await transaction.query(
              "UPDATE provider_image_attempts SET original_artifact_hash = $2, provenance = $3::jsonb, state = 'retained', updated_at = now() WHERE id = $1",
              [id, artifact.artifactHash, JSON.stringify({ schema: 1, ...provenance })],
            );
          });
          retained = true;
        } catch (error) {
          throw new ProviderImageCaptureError(error);
        }
      },
    });
    if (!retained)
      throw new RequiredImageCaptureError(
        "The selected adapter did not honor the required original-image capture contract",
      );
    return { value, attemptId: id };
  } catch (error) {
    const state =
      retained && error instanceof PhotoctlError && error.code === "provider_whole_frame"
        ? "rejected"
        : "failed";
    try {
      await failProviderImageAttempts(database, [id], error, state);
    } catch {
      /* The last durable state remains inspectable when the database itself fails. */
    }
    throw new ProviderImageAttemptError(id, captureFailed(error), error);
  }
}

export async function failProviderImageAttempts(
  database: GraphTransaction,
  ids: string[],
  error: unknown,
  state: "failed" | "rejected" = "failed",
) {
  if (!ids.length) return;
  const details =
    error instanceof PhotoctlError && typeof error.data === "object" && error.data
      ? (error.data as Record<string, unknown>)
      : {};
  const provenance = {
    ...(typeof details.attempts === "number" &&
    Number.isSafeInteger(details.attempts) &&
    details.attempts > 0
      ? { transport_attempts: details.attempts }
      : {}),
    ...(typeof details.requestId === "string"
      ? { request_id: details.requestId.slice(0, 256) }
      : {}),
  };
  await database.query(
    "UPDATE provider_image_attempts SET state = $2, outcome = $3::jsonb, provenance = provenance || $4::jsonb, updated_at = now() WHERE id = ANY($1::uuid[]) AND state <> 'committed'",
    [
      ids,
      state,
      JSON.stringify({
        schema: 1,
        code: attemptErrorCode(error),
        retention_failed: captureFailed(error),
        message: error instanceof Error ? error.message : "Provider image failed",
      }),
      JSON.stringify(provenance),
    ],
  );
}

class RequiredImageCaptureError extends Error {}

function captureFailed(error: unknown): boolean {
  return error instanceof ProviderImageCaptureError || error instanceof RequiredImageCaptureError;
}

function attemptErrorCode(error: unknown): ErrorCode | null {
  if (error instanceof RequiredImageCaptureError) return "provider_unconfigured";
  if (error instanceof ProviderImageCaptureError) return "catalog_unreadable";
  return error instanceof PhotoctlError ? error.code : null;
}
