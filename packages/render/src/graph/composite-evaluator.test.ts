import { PGlite } from "@electric-sql/pglite";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { migrate } from "../../../library/src/migrations/runner.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  normalizeArtifact,
  normalizeMaskArtifact,
  publishArtifact,
  readArtifactLinear,
} from "../artifacts/publication.js";
import { compositeV2Projection } from "./output.js";
import { evaluateGraphNode } from "./evaluator.js";
import { commitRevision } from "./store.js";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c022";
const directories: string[] = [];

test.each([4, 3])(
  "intrinsic mask composition uses exact raster coverage independently of catalog dimensions (mask width=%s)",
  async (maskWidth) => {
    const { db, library, sourceId, revisionId } = await sourceGraph();
    try {
      const data = new Float32Array(maskWidth * 2);
      data[maskWidth - 1] = 1;
      data[maskWidth * 2 - 1] = 1;
      const pinned = await publishArtifact(
        library,
        await normalizeMaskArtifact({ w: maskWidth, h: 2, data }),
      );
      const committed = await commitRevision(db, {
        photoId,
        expectedRevisionId: revisionId,
        artifacts: [pinned],
        nodes: [
          {
            localKey: "base",
            kind: "resample",
            recipeVersion: 2,
            parameters: { w: 4, h: 2, kernel: "lanczos3", matrix: [1, 0, 0, 1, 0, 0] },
            inputs: [{ nodeId: sourceId }],
          },
          {
            localKey: "content",
            kind: "solid",
            recipeVersion: 1,
            parameters: { w: 4, h: 2, space: "scene-linear-rec2020", rgb: [1, 0.5, 0.25] },
            inputs: [],
          },
          mask("coverage", pinned.artifactHash),
          {
            localKey: "composite",
            kind: "mask_composite",
            recipeVersion: 2,
            parameters: { feather: 0, mask_space: "intrinsic" },
            inputs: [{ localKey: "base" }, { localKey: "content" }, { localKey: "coverage" }],
          },
        ],
        rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
      });
      const base = new Float32Array(Array.from({ length: 18 }, (_, index) => index / 32));
      const result = evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId: committed.roots.output!,
        source: async () => sourceEvaluation(base),
      });
      if (maskWidth !== 4) {
        await expect(result).rejects.toThrow("Composite mask artifact dimensions do not match");
      } else {
        const evaluated = await result;
        const output = await readArtifactLinear(evaluated.artifact.path);
        expect([output.w, output.h]).toEqual([4, 2]);
        expect(output.data).toEqual(
          new Float32Array([...base.slice(0, 9), 1, 0.5, 0.25, ...base.slice(9), 1, 0.5, 0.25]),
        );
      }
    } finally {
      await db.close();
    }
  },
);

test("schema 21 upgrades without changing a stored catalog-mask composite or its output", async () => {
  const { db, library, sourceId, revisionId } = await sourceGraph(21);
  try {
    const pinned = await publishMask(db, library, new Float32Array([0, 1, 0, 0, 0, 0]));
    const committed = await commitRevision(db, {
      photoId,
      expectedRevisionId: revisionId,
      nodes: [
        {
          localKey: "content",
          kind: "solid",
          recipeVersion: 1,
          parameters: { w: 3, h: 2, space: "scene-linear-rec2020", rgb: [1, 0.5, 0.25] },
          inputs: [],
        },
        mask("coverage", pinned.artifactHash),
        {
          localKey: "composite",
          kind: "mask_composite",
          recipeVersion: 1,
          parameters: { feather: 0 },
          inputs: [{ nodeId: sourceId }, { localKey: "content" }, { localKey: "coverage" }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "composite" } }],
    });
    const request = {
      database: db,
      libraryPath: library,
      photoId,
      nodeId: committed.roots.output!,
      source: async () => sourceEvaluation(new Float32Array(18).fill(0.125)),
    };
    const before = await evaluateGraphNode(request);
    const nodeBefore = (
      await db.query("SELECT * FROM image_nodes WHERE id = $1", [committed.roots.output])
    ).rows;
    expect(await migrate(db)).toMatchObject({ fromVersion: 21, applied: [22] });
    expect(
      (await db.query("SELECT * FROM image_nodes WHERE id = $1", [committed.roots.output])).rows,
    ).toEqual(nodeBefore);
    const after = await evaluateGraphNode(request);
    expect(after.artifact.artifactHash).toBe(before.artifact.artifactHash);
    expect((await readArtifactLinear(after.artifact.path)).data).toEqual(
      new Float32Array([
        0.125,
        0.125,
        0.125,
        1,
        0.5,
        0.25,
        ...Array.from({ length: 12 }, () => 0.125),
      ]),
    );
  } finally {
    await db.close();
  }
});

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
    ).rejects.toThrow("wrong media type");
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

async function sourceGraph(schema?: 21): Promise<{
  db: PGlite;
  library: string;
  sourceId: string;
  revisionId: string;
}> {
  const db = await testDatabase();
  if (schema === 21) {
    await db.exec(
      await readFile(
        new URL("../../../../fixtures/libraries/schema-v21.pgsql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec("SET search_path TO public");
  } else await migrate(db);
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
  artifact: {
    artifactHash: string;
    mediaType: string;
    validationProfile: string;
    storageBytes: number;
    w: number;
    h: number;
  },
) {
  await db.query(
    `INSERT INTO image_artifacts (artifact_hash, media_type, bytes, w, h, artifact_available, validation_profile)
     VALUES ($1, $2, $3, $4, $5, true, $6)`,
    [
      artifact.artifactHash,
      artifact.mediaType,
      artifact.storageBytes,
      artifact.w,
      artifact.h,
      artifact.validationProfile,
    ],
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
