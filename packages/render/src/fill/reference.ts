import type { SentImage } from "@photoctl/providers";
import {
  artifactPath,
  normalizeArtifact,
  normalizeEncodedArtifact,
  publishArtifact,
  readEncodedArtifactBytes,
} from "../artifacts/publication.js";
import { canonicalNodeRecipe, logicalNodeId, recipeHash } from "../graph/recipes.js";
import type { NodeDraft } from "../graph/store.js";
import type { GraphDatabase } from "../graph/store.js";
import { decodeExternalImage } from "./external-pixels.js";

/** The paid graph retains reference pixels even after the caller's file disappears. */
export async function prepareReferenceArtifact(libraryPath: string, image: SentImage) {
  const encodedArtifact = await publishArtifact(
    libraryPath,
    await normalizeEncodedArtifact(image.png),
  );
  const artifact = await publishArtifact(
    libraryPath,
    await normalizeArtifact(await decodeExternalImage(image.png, image)),
  );
  const node: NodeDraft = {
    localKey: "generation-reference",
    kind: "source",
    recipeVersion: 2,
    parameters: {
      artifact_hash: artifact.artifactHash,
      encoded_artifact_hash: encodedArtifact.artifactHash,
    },
    inputs: [],
  };
  const nodeId = logicalNodeId(
    recipeHash(
      canonicalNodeRecipe({
        kind: node.kind,
        recipeVersion: node.recipeVersion,
        parameters: node.parameters,
        inputNodeIds: [],
      }),
    ),
  );
  return { artifact, encodedArtifact, node, nodeId };
}

export async function readReferenceArtifact(
  database: GraphDatabase,
  libraryPath: string,
  photoId: string,
  nodeId: string,
) {
  const result = await database.query<{
    artifact_hash: string;
    working_artifact_hash: `a_${string}`;
    w: number;
    h: number;
    artifact_available: boolean;
  }>(
    `
    SELECT artifact.artifact_hash, working.artifact_hash AS working_artifact_hash, artifact.w, artifact.h, artifact.artifact_available
    FROM image_nodes AS node
    JOIN image_artifacts AS artifact ON artifact.artifact_hash = node.parameters->>'encoded_artifact_hash'
    JOIN image_artifacts AS working ON working.artifact_hash = node.parameters->>'artifact_hash'
    WHERE node.photo_id = $1 AND node.id = $2 AND node.kind = 'source' AND node.recipe_version = 2
      AND artifact.media_type = 'image/png'
      AND working.media_type = 'image/tiff' AND working.artifact_available
  `,
    [photoId, nodeId],
  );
  const artifact = result.rows[0];
  if (!artifact?.artifact_available) throw new Error("Pinned reference artifact is unavailable");
  const path = artifactPath(libraryPath, artifact.artifact_hash, "png");
  try {
    return {
      png: await readEncodedArtifactBytes(path, artifact.artifact_hash, {
        ...artifact,
        mediaType: "image/png",
        validationProfile: "encoded-image",
      }),
      w: artifact.w,
      h: artifact.h,
      workingArtifactHash: artifact.working_artifact_hash,
    };
  } catch (error) {
    await database.query(
      "UPDATE image_artifacts SET artifact_available = false WHERE artifact_hash = $1",
      [artifact.artifact_hash],
    );
    throw error;
  }
}
