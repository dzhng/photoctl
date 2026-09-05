/* eslint-disable no-await-in-loop -- Sweeps bound filesystem and catalog pressure by processing one artifact at a time. */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  artifactPath,
  artifactExtensions,
  readEncodedArtifactBytes,
  type NormalizedArtifact,
} from "./publication.js";

interface ArtifactDatabase {
  query<Row>(sql: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

/** Reports collectible canonical files; policy deliberately does not delete them yet. */
export async function findOrphanArtifacts(
  database: ArtifactDatabase,
  libraryPath: string,
): Promise<string[]> {
  const registered = await database.query<{ artifact_hash: string }>(
    "SELECT artifact_hash FROM image_artifacts",
  );
  const known = new Set(registered.rows.map((row) => row.artifact_hash));
  const root = join(libraryPath, "artifacts", "sha256");
  let prefixes: string[];
  try {
    prefixes = await readdir(root);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  }
  const paths: string[] = [];
  for (const prefix of prefixes.toSorted()) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const name of (await readdir(join(root, prefix))).toSorted()) {
      const match = /^(a_[0-9a-f]{64})\.(?:tif|png|jpg|webp|gif|svg|avif|heif)$/.exec(name);
      if (match && !known.has(match[1])) paths.push(join(root, prefix, name));
    }
  }
  return paths;
}

export async function reconcileArtifactAvailability(
  database: ArtifactDatabase,
  libraryPath: string,
): Promise<{ available: number; unavailable: number }> {
  const artifacts = await database.query<{
    artifact_hash: string;
    media_type: string;
    validation_profile: NormalizedArtifact["validationProfile"];
    w: number;
    h: number;
  }>(
    "SELECT artifact_hash, media_type, validation_profile, w, h FROM image_artifacts ORDER BY artifact_hash",
  );
  let available = 0;
  let unavailable = 0;
  for (const artifact of artifacts.rows) {
    let present = false;
    if (artifact.media_type in artifactExtensions) {
      try {
        const mediaType = artifact.media_type as NormalizedArtifact["mediaType"];
        await readEncodedArtifactBytes(
          artifactPath(libraryPath, artifact.artifact_hash, artifactExtensions[mediaType]),
          artifact.artifact_hash,
          { ...artifact, mediaType, validationProfile: artifact.validation_profile },
        );
        present = true;
      } catch {
        present = false;
      }
    }
    await database.query(
      "UPDATE image_artifacts SET artifact_available = $2 WHERE artifact_hash = $1",
      [artifact.artifact_hash, present],
    );
    if (present) available += 1;
    else unavailable += 1;
  }
  return { available, unavailable };
}

export async function retainedArtifacts(
  database: ArtifactDatabase,
): Promise<Array<{ artifactHash: string; available: boolean }>> {
  const result = await database.query<{
    artifact_hash: string;
    artifact_available: boolean;
  }>(
    `WITH RECURSIVE retained_nodes(photo_id, node_id) AS (
       SELECT root.photo_id, root.node_id
       FROM document_revision_roots AS root
       JOIN document_revisions AS revision
         ON (revision.photo_id, revision.id) = (root.photo_id, root.revision_id)
       UNION
       SELECT layer.photo_id, layer.content_node_id
       FROM document_revision_layers AS layer
       UNION
       SELECT layer.photo_id, layer.mask_node_id
       FROM document_revision_layers AS layer
       UNION
       SELECT photo_id, authored_checkpoint_node_id FROM layers
       WHERE authored_checkpoint_node_id IS NOT NULL
       UNION
       SELECT edge.photo_id, edge.input_node_id
       FROM image_node_inputs AS edge
       JOIN retained_nodes AS retained
         ON (retained.photo_id, retained.node_id) = (edge.photo_id, edge.node_id)
     ), retained_artifacts(artifact_hash) AS (
       SELECT original_artifact_hash FROM provider_image_attempts WHERE original_artifact_hash IS NOT NULL
       UNION
       SELECT execution.output_artifact_hash
       FROM retained_nodes AS retained
       JOIN node_executions AS execution
         ON (execution.photo_id, execution.node_id) = (retained.photo_id, retained.node_id)
       UNION
       SELECT node.parameters->>'artifact_hash'
       FROM retained_nodes AS retained
       JOIN image_nodes AS node
         ON (node.photo_id, node.id) = (retained.photo_id, retained.node_id)
       WHERE (node.kind = 'mask' AND node.recipe_version = 1)
         OR (node.kind = 'source' AND node.recipe_version = 2)
       UNION
       SELECT node.parameters->>'encoded_artifact_hash'
       FROM retained_nodes AS retained
       JOIN image_nodes AS node
         ON (node.photo_id, node.id) = (retained.photo_id, retained.node_id)
       WHERE node.kind = 'source' AND node.recipe_version = 2
     )
     SELECT DISTINCT artifact.artifact_hash, artifact.artifact_available
     FROM retained_artifacts AS retained
     JOIN image_artifacts AS artifact
       ON artifact.artifact_hash = retained.artifact_hash
     ORDER BY artifact.artifact_hash`,
  );
  return result.rows.map((row) => ({
    artifactHash: row.artifact_hash,
    available: row.artifact_available,
  }));
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
