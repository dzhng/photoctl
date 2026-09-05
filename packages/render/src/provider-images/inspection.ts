import { PhotoctlError } from "@photoctl/protocol";
import { z } from "zod";
import type { GraphTransaction } from "../graph/store.js";
import {
  artifactExtensions,
  artifactPath,
  readEncodedArtifactBytes,
  type NormalizedArtifact,
} from "../artifacts/publication.js";

const cursorSchema = z.object({ at: z.iso.datetime(), id: z.uuid() }).strict();
export async function inspectProviderImageAttempts(
  database: GraphTransaction,
  request: { limit?: number; cursor?: string },
) {
  const limit = request.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new PhotoctlError("usage", "Attempt limit must be between 1 and 100");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (request.cursor) {
    try {
      if (request.cursor.length > 512) throw new Error();
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, "base64url").toString()));
    } catch {
      throw new PhotoctlError("usage", "Invalid provider image attempt cursor");
    }
  }
  const result = await database.query<{
    id: string;
    state: string;
    created_at: string;
    operation: string;
    model: string;
    artifact_hash: string | null;
    artifact_available: boolean | null;
  }>(
    `SELECT attempt.id, attempt.state, to_char(attempt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at, left(attempt.request->>'operation', 32) AS operation,
       left(attempt.request->>'model', 256) AS model, artifact.artifact_hash, artifact.artifact_available
     FROM provider_image_attempts attempt LEFT JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash
     WHERE $1::timestamptz IS NULL OR (attempt.created_at, attempt.id) < ($1::timestamptz, $2::uuid)
     ORDER BY attempt.created_at DESC, attempt.id DESC LIMIT $3`,
    [cursor?.at ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = result.rows.slice(0, limit);
  const last = page.at(-1);
  return {
    attempts: page.map((row) => ({
      id: row.id,
      state: row.state,
      created_at: new Date(row.created_at).toISOString(),
      operation: row.operation,
      model: row.model,
      original: row.artifact_hash
        ? { artifact_hash: row.artifact_hash, recorded_available: row.artifact_available === true }
        : null,
    })),
    next_cursor:
      result.rows.length > limit && last
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
        : null,
  };
}

export async function inspectProviderImageAttempt(
  database: GraphTransaction,
  libraryPath: string,
  id: string,
) {
  if (!z.uuid().safeParse(id).success)
    throw new PhotoctlError("usage", "graph attempt requires a full attempt UUID");
  const result = await database.query<{
    id: string;
    state: string;
    created_at: string;
    updated_at: string;
    request: unknown;
    provenance: unknown;
    outcome: unknown;
    truncated: boolean;
    artifact_hash: string | null;
    media_type: NormalizedArtifact["mediaType"];
    validation_profile: NormalizedArtifact["validationProfile"];
    w: number;
    h: number;
  }>(
    `SELECT attempt.id, attempt.state, attempt.created_at::text, attempt.updated_at::text,
       CASE WHEN octet_length(attempt.request::text) <= 65536 THEN attempt.request ELSE NULL END AS request,
       CASE WHEN octet_length(attempt.provenance::text) <= 65536 THEN attempt.provenance ELSE NULL END AS provenance,
       CASE WHEN octet_length(attempt.outcome::text) <= 65536 THEN attempt.outcome ELSE NULL END AS outcome,
       (octet_length(attempt.request::text) > 65536 OR octet_length(attempt.provenance::text) > 65536 OR coalesce(octet_length(attempt.outcome::text), 0) > 65536) AS truncated,
       artifact.artifact_hash, artifact.media_type, artifact.validation_profile, artifact.w, artifact.h
     FROM provider_image_attempts attempt LEFT JOIN image_artifacts artifact ON artifact.artifact_hash = attempt.original_artifact_hash WHERE attempt.id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row)
    throw new PhotoctlError("not_found", "Provider image attempt does not exist", {
      attempt_id: id,
    });
  let original = null;
  if (row.artifact_hash) {
    const path = artifactPath(libraryPath, row.artifact_hash, artifactExtensions[row.media_type]);
    let available = false;
    try {
      await readEncodedArtifactBytes(path, row.artifact_hash, {
        w: row.w,
        h: row.h,
        mediaType: row.media_type,
        validationProfile: row.validation_profile,
      });
      available = true;
    } catch {
      /* Inspection reports absence/corruption without repairing or replaying. */
    }
    original = {
      artifact_hash: row.artifact_hash,
      path,
      media_type: row.media_type,
      validation_profile: row.validation_profile,
      w: row.w,
      h: row.h,
      available,
    };
  }
  const executions = await database.query<{ photo_id: string; execution_id: string }>(
    "SELECT photo_id, execution_id FROM node_executions WHERE provider_image_attempt_id = $1 ORDER BY photo_id, execution_id LIMIT 65",
    [id],
  );
  return {
    id,
    state: row.state,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    request: row.request,
    provenance: row.provenance,
    outcome: row.outcome,
    original,
    executions: executions.rows.slice(0, 64),
    record_truncated: row.truncated || executions.rows.length > 64,
  };
}
