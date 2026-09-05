import { PGlite } from "@electric-sql/pglite";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { migrate } from "../../../library/src/migrations/runner.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  normalizeArtifact,
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactLinear,
} from "../artifacts/publication.js";
import { compositeV2Projection } from "../layers/model.js";
import { evaluateGraphNode } from "./evaluator.js";
import { commitRevision } from "./store.js";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c022";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("composite v2 folds ordered content-mask pairs without changing uncovered samples", async () => {
  const { db, library, sourceId, revisionId } = await sourceGraph();
  try {
    const leftMask = await publishMask(db, library, new Float32Array([1, 0, 0, 0, 0, 0]));
    const rightMask = await publishMask(db, library, new Float32Array([0, 0.5, 0, 0, 0, 0]));
    const layers = [
      layer("left", "left-content", "left-mask", 0, 1),
      layer("right", "right-content", "right-mask", 1, 0.5),
    ];
    const projection = compositeV2Projection({ nodeId: sourceId }, layers);
    const committed = await commitRevision(db, {
      photoId,
      expectedRevisionId: revisionId,
      nodes: [
        develop("left-content", sourceId, 1),
        mask("left-mask", leftMask.artifactHash),
        develop("right-content", sourceId, 2),
        mask("right-mask", rightMask.artifactHash),
        { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
      newLayers: [
        { localKey: "left", role: "subject" },
        { localKey: "right", role: "subject" },
      ],
      layers,
    });
    const base = new Float32Array([-1, 0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: committed.roots.output!,
      source: async () => sourceEvaluation(base),
      operations: {
        develop: async ({ parameters }) => {
          const value = (parameters as { exposure: number }).exposure * 10;
          return sourceEvaluation(new Float32Array(base.length).fill(value)).image;
        },
      },
    });
    const output = (await readArtifactLinear(evaluated.artifact.path)).data;

    expect(output.slice(0, 3)).toEqual(new Float32Array([10, 10, 10]));
    expect(output.slice(3, 6)).toEqual(new Float32Array([8, 8.75, 9.5]));
    expect(output.slice(6)).toEqual(base.slice(6));
  } finally {
    await db.close();
  }
});

test("a permanent mask pin refuses an RGB artifact with the same file extension", async () => {
  const { db, library, sourceId, revisionId } = await sourceGraph();
  try {
    const rgb = await publishArtifact(
      library,
      await normalizeArtifact(sourceEvaluation(new Float32Array(18)).image),
    );
    await registerArtifact(db, rgb);
    const layers = [
      {
        layer: { localKey: "wrong" },
        name: "wrong",
        z: 0,
        contentNode: { nodeId: sourceId },
        maskNode: { localKey: "wrong-mask" },
        opacity: 1,
        blend: "normal" as const,
        enabled: true,
      },
    ];
    const projection = compositeV2Projection({ nodeId: sourceId }, layers);
    await expect(
      commitRevision(db, {
        photoId,
        expectedRevisionId: revisionId,
        nodes: [
          mask("wrong-mask", rgb.artifactHash),
          { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
        newLayers: [{ localKey: "wrong", role: "subject" }],
        layers,
      }),
    ).rejects.toThrow("Mask artifact");
  } finally {
    await db.close();
  }
});

test("strict mask composite copies every zero-coverage base sample exactly", async () => {
  const { db, library, sourceId, revisionId } = await sourceGraph();
  try {
    const pinned = await publishMask(db, library, new Float32Array([0, 1, 0, 0.5, 0, 0]));
    const committed = await commitRevision(db, {
      photoId,
      expectedRevisionId: revisionId,
      nodes: [
        develop("content", sourceId, 2),
        mask("mask", pinned.artifactHash),
        {
          localKey: "masked",
          kind: "mask_composite",
          recipeVersion: 1,
          parameters: { feather: 0 },
          inputs: [{ nodeId: sourceId }, { localKey: "content" }, { localKey: "mask" }],
        },
      ],
      rootUpdates: [
        { root: "base", node: { localKey: "masked" } },
        { root: "output", node: { localKey: "masked" } },
      ],
    });
    const base = new Float32Array([-1, 0, 1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: committed.roots.output!,
      source: async () => sourceEvaluation(base),
      operations: {
        develop: async () => sourceEvaluation(new Float32Array(base.length).fill(20)).image,
      },
    });
    const output = (await readArtifactLinear(evaluated.artifact.path)).data;
    for (const pixel of [0, 2, 4, 5]) {
      expect(output.slice(pixel * 3, pixel * 3 + 3)).toEqual(base.slice(pixel * 3, pixel * 3 + 3));
    }
    expect(output.slice(3, 6)).toEqual(new Float32Array([20, 20, 20]));
    expect(output.slice(9, 12)).toEqual(new Float32Array([15, 15.5, 16]));
  } finally {
    await db.close();
  }
});

test("a corrupt permanent mask is marked unavailable on its first evaluation", async () => {
  const { db, library, sourceId, revisionId } = await sourceGraph();
  try {
    const pinned = await publishMask(db, library, new Float32Array([0, 1, 0, 0, 0, 0]));
    const layers = [
      {
        layer: { localKey: "subject" },
        name: "subject",
        z: 0,
        contentNode: { nodeId: sourceId },
        maskNode: { localKey: "mask" },
        opacity: 1,
        blend: "normal" as const,
        enabled: true,
      },
    ];
    const projection = compositeV2Projection({ nodeId: sourceId }, layers);
    const committed = await commitRevision(db, {
      photoId,
      expectedRevisionId: revisionId,
      nodes: [
        mask("mask", pinned.artifactHash),
        { localKey: "composite", kind: "composite", recipeVersion: 2, ...projection },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
      newLayers: [{ localKey: "subject", role: "subject" }],
      layers,
    });
    await writeFile(pinned.path, "corrupt before evaluation");

    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId: committed.roots.output!,
        source: async () => sourceEvaluation(new Float32Array(18)),
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.query<{ artifact_available: boolean }>(
          "SELECT artifact_available FROM image_artifacts WHERE artifact_hash = $1",
          [pinned.artifactHash],
        )
      ).rows,
    ).toEqual([{ artifact_available: false }]);
  } finally {
    await db.close();
  }
});

async function sourceGraph(): Promise<{
  db: PGlite;
  library: string;
  sourceId: string;
  revisionId: string;
}> {
  const db = await testDatabase();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_10b2_composite', 1, 3, 2, 1)`,
    [photoId],
  );
  const initial = await commitRevision(db, {
    photoId,
    expectedRevisionId: null,
    nodes: [
      {
        localKey: "source",
        kind: "source",
        recipeVersion: 1,
        parameters: { orientation: 1 },
        inputs: [],
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "source" } }],
  });
  const library = await mkdtemp(join(tmpdir(), "photoctl-composite-"));
  directories.push(library);
  return { db, library, sourceId: initial.nodes.source.id, revisionId: initial.revisionId };
}

async function publishMask(db: PGlite, library: string, data: Float32Array) {
  const artifact = await publishArtifact(
    library,
    await normalizeMaskArtifact({ w: 3, h: 2, data }),
  );
  await registerArtifact(db, artifact);
  return artifact;
}

async function registerArtifact(
  db: PGlite,
  artifact: { artifactHash: string; mediaType: string; storageBytes: number; w: number; h: number },
) {
  await db.query(
    `INSERT INTO image_artifacts (artifact_hash, media_type, bytes, w, h, artifact_available)
     VALUES ($1, $2, $3, $4, $5, true)`,
    [artifact.artifactHash, artifact.mediaType, artifact.storageBytes, artifact.w, artifact.h],
  );
}

function sourceEvaluation(data: Float32Array) {
  return {
    image: {
      w: 3,
      h: 2,
      data,
      space: "scene-linear-rec2020" as const,
      orientationApplied: true as const,
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    },
    provenance: {
      locator: { kind: "pinned-preview" as const, cache_path: "emb/composite.jpg" },
      tier: "pinned-preview" as const,
      w: 3,
      h: 2,
      decoderId: "fixture",
      decoderVersion: "1",
    },
  };
}

function develop(localKey: string, sourceId: string, exposure: number) {
  return {
    localKey,
    kind: "develop" as const,
    recipeVersion: 1,
    parameters: { exposure },
    inputs: [{ nodeId: sourceId }],
  };
}

function mask(localKey: string, artifactHash: string) {
  return {
    localKey,
    kind: "mask" as const,
    recipeVersion: 1,
    parameters: { artifact_hash: artifactHash },
    inputs: [],
  };
}

function layer(layerKey: string, contentKey: string, maskKey: string, z: number, opacity: number) {
  return {
    layer: { localKey: layerKey },
    name: layerKey,
    z,
    contentNode: { localKey: contentKey },
    maskNode: { localKey: maskKey },
    opacity,
    blend: "normal" as const,
    enabled: true,
  };
}
