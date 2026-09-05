import { PGlite } from "@electric-sql/pglite";
import { linearRec2020ToDisplaySrgb } from "@photoctl/img";
import { testDatabase } from "../../../library/src/migrations/test-database.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { findOrphanArtifacts, retainedArtifacts } from "../artifacts/availability.js";
import { readArtifactLinear } from "../artifacts/publication.js";
import { evaluateGraphNode, SourceEvaluationError } from "./evaluator.js";
import { canonicalNodeRecipe, logicalNodeId, recipeHash } from "./recipes.js";
import { commitRevision } from "./store.js";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c011";
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async (path) => await rm(path, { recursive: true })));
});

test("structured sources expose decode failure without masking graph errors", async () => {
  const { db, library, nodeId } = await sourceGraph();
  const sourcePath = join(library, "truncated.jpg");
  await writeFile(sourcePath, Buffer.from([0xff, 0xd8, 0xff]));
  try {
    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId,
        source: {
          orientation: 1,
          imageSource: {
            kind: "online-file",
            path: sourcePath,
            mediaType: "image/jpeg",
            copyExact: false,
          },
          locator: { kind: "online-file", volume_uuid: "card", rel_path: "truncated.jpg" },
        },
      }),
    ).rejects.toBeInstanceOf(SourceEvaluationError);
  } finally {
    await db.close();
  }
});

test("affine resample translates an intrinsic RGB image onto a protected zero canvas", async () => {
  const image = linearFixture(2, 1, [0.25, 0.75]);
  const { db, library, nodeId } = await resampleGraph(image, 2, {
    w: 4,
    h: 3,
    kernel: "lanczos3",
    matrix: [1, 0, 0, 1, 1, 1],
  });
  try {
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluationFor(image),
    });
    const output = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );
    const reused = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluationFor(image),
    });

    expect([output.w, output.h]).toEqual([4, 3]);
    expect(reused).toMatchObject({ executionId: evaluated.executionId, reused: true });
    expect(Array.from(output.data)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0.25, 0.25, 0.75, 0.75, 0.75, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  } finally {
    await db.close();
  }
});

test("affine resample applies a uniform scale directly into the output canvas", async () => {
  const image = linearFixture(1, 1, [0.5]);
  const { db, library, nodeId } = await resampleGraph(image, 2, {
    w: 10,
    h: 10,
    kernel: "lanczos3",
    matrix: [2, 0, 0, 2, 2, 2],
  });
  try {
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluationFor(image),
    });
    const output = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );

    expect([output.w, output.h]).toEqual([10, 10]);
    expect(output.data[(3 * output.w + 3) * 3]).toBeGreaterThan(0);
    expect(Array.from(output.data.slice(-3))).toEqual([0, 0, 0]);
  } finally {
    await db.close();
  }
});

test("affine resample quarter-rotates exactly and clips pixels outside the canvas", async () => {
  const image = linearFixture(2, 1, [0.25, 0.75]);
  const { db, library, nodeId } = await resampleGraph(image, 2, {
    w: 2,
    h: 2,
    kernel: "lanczos3",
    matrix: [0, 1, -1, 0, 1, 0],
  });
  try {
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluationFor(image),
    });
    const output = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );

    expect(Array.from(output.data)).toEqual([0.25, 0.25, 0.25, 0, 0, 0, 0.75, 0.75, 0.75, 0, 0, 0]);
  } finally {
    await db.close();
  }
});

test("historical resample v1 recipes remain evaluable", async () => {
  const image = linearFixture(2, 1, [0.25, 0.75]);
  const { db, library, nodeId } = await resampleGraph(image, 1, {
    w: 1,
    h: 1,
    kernel: "bilinear",
  });
  try {
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluationFor(image),
    });
    const output = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );

    expect([output.w, output.h]).toEqual([1, 1]);
    expect(Array.from(output.data)).toEqual([0.5, 0.5, 0.5]);
  } finally {
    await db.close();
  }
});

test("evaluation failure before publication or database commit cannot create active missing state", async () => {
  const { db, library, nodeId } = await sourceGraph();
  try {
    const source = async () => sourceEvaluation();
    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId,
        source,
        hooks: { beforePublish: () => Promise.reject(new Error("normalize stopped")) },
      }),
    ).rejects.toThrow("normalize stopped");
    expect(await artifactFiles(library)).toEqual([]);
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toEqual([]);

    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId,
        source,
        hooks: { beforeCommit: () => Promise.reject(new Error("database stopped")) },
      }),
    ).rejects.toThrow("database stopped");
    expect((await db.query("SELECT 1 FROM node_executions")).rows).toEqual([]);
    const orphans = await findOrphanArtifacts(db, library);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatch(/^.*\/artifacts\/sha256\/[0-9a-f]{2}\/a_[0-9a-f]{64}\.tif$/);
  } finally {
    await db.close();
  }
});

test("deterministic evaluations reuse while nondeterministic attempts retain distinct identities", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const firstSource = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: sourceId,
      source: async () => sourceEvaluation(),
    });
    const reusedSource = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: sourceId,
      source: async () => sourceEvaluation(),
    });
    expect(reusedSource).toMatchObject({
      executionId: firstSource.executionId,
      evaluationHash: firstSource.evaluationHash,
      reused: true,
    });

    const generatedId = await insertGeneratedNode(db, sourceId);
    let operationRuns = 0;
    const operations = {
      generate: async () => {
        operationRuns += 1;
        return providerResult();
      },
    };
    const firstAttempt = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: generatedId,
      source: async () => sourceEvaluation(),
      operations,
    });
    const secondAttempt = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: generatedId,
      source: async () => sourceEvaluation(),
      operations,
    });
    const retriedAttempt = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: generatedId,
      executionId: firstAttempt.executionId,
      source: async () => sourceEvaluation(),
      operations,
    });
    const otherGeneratedId = await insertGeneratedNode(db, sourceId, "other request");
    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId: otherGeneratedId,
        executionId: firstAttempt.executionId,
        source: async () => sourceEvaluation(),
        operations,
      }),
    ).rejects.toThrow("Execution identity collision");

    expect(secondAttempt.executionId).not.toBe(firstAttempt.executionId);
    expect(secondAttempt.evaluationHash).toBe(firstAttempt.evaluationHash);
    expect(secondAttempt.artifact.artifactHash).toBe(firstAttempt.artifact.artifactHash);
    expect(retriedAttempt).toMatchObject({ executionId: firstAttempt.executionId, reused: true });
    expect(operationRuns).toBe(2);
    expect(
      (
        await db.query<{ execution_id: string }>(
          "SELECT execution_id FROM node_executions WHERE photo_id = $1 AND node_id = $2 ORDER BY execution_id",
          [photoId, generatedId],
        )
      ).rows.map((row) => row.execution_id),
    ).toEqual([firstAttempt.executionId, secondAttempt.executionId].toSorted());
  } finally {
    await db.close();
  }
});

test("external nodes cannot commit a successful execution without provider provenance", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const generatedId = await insertGeneratedNode(db, sourceId);
    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId: generatedId,
        source: async () => sourceEvaluation(),
        operations: { generate: async () => sourceEvaluation().image },
      }),
    ).rejects.toThrow("Generate evaluation requires provider execution provenance");
    expect(
      (
        await db.query("SELECT 1 FROM node_executions WHERE photo_id = $1 AND node_id = $2", [
          photoId,
          generatedId,
        ])
      ).rows,
    ).toEqual([]);
  } finally {
    await db.close();
  }
});

test("provider provenance cannot disagree with the immutable node recipe", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const generatedId = await insertGeneratedNode(db, sourceId);
    const result = providerResult();
    result.externalExecution.model = "other-model";
    await expect(
      evaluateGraphNode({
        database: db,
        libraryPath: library,
        photoId,
        nodeId: generatedId,
        source: async () => sourceEvaluation(),
        operations: { generate: async () => result },
      }),
    ).rejects.toThrow("generate provider execution does not match its immutable recipe");
  } finally {
    await db.close();
  }
});

test("source fallback keeps render state stable while recording a distinct source execution", async () => {
  const { db, library, nodeId } = await sourceGraph();
  try {
    const pinned = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluation(),
    });
    const online = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => ({
        ...sourceEvaluation(),
        provenance: {
          ...sourceEvaluation().provenance,
          locator: { kind: "online-file" as const, volume_uuid: "card", rel_path: "a.jpg" },
          tier: "online-file" as const,
        },
      }),
    });

    expect(online.evaluationHash).not.toBe(pinned.evaluationHash);
    expect(online.executionId).not.toBe(pinned.executionId);
    expect(online.artifact.artifactHash).toBe(pinned.artifact.artifactHash);
    expect(await retainedArtifacts(db)).toEqual([
      { artifactHash: pinned.artifact.artifactHash, available: true },
    ]);
    expect(
      (
        await db.query<{ source_tier: string }>(
          "SELECT source_tier FROM node_executions WHERE photo_id = $1 AND node_id = $2 ORDER BY source_tier",
          [photoId, nodeId],
        )
      ).rows,
    ).toEqual([{ source_tier: "online-file" }, { source_tier: "pinned-preview" }]);
  } finally {
    await db.close();
  }
});

test("markup and develop geometry scale from catalog space to a smaller evaluated source", async () => {
  const db = await testDatabase();
  await migrate(db);
  const library = await mkdtemp(join(tmpdir(), "photoctl-markup-source-scale-"));
  directories.push(library);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_markup_source_scale', 1, 8, 8, 1)`,
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
      {
        localKey: "develop",
        kind: "develop",
        recipeVersion: 1,
        parameters: { crop: { x: 2, y: 2, w: 4, h: 4 } },
        inputs: [{ localKey: "source" }],
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "develop" } }],
  });
  const marked = await commitRevision(db, {
    photoId,
    expectedRevisionId: initial.revisionId,
    nodes: [],
    rootUpdates: [],
    markupDocument: [
      {
        id: "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c173",
        type: "rect",
        bbox: [4, 4, 2, 2],
        width: 1,
        color: "#ffffff",
        fill: "#ffffff",
      },
    ],
  });

  try {
    const source = linearFixture(
      4,
      4,
      Array.from({ length: 16 }, () => 0),
    );
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: marked.roots.output!,
      developBaseDimensions: { w: 8, h: 8 },
      source: async () => sourceEvaluationFor(source),
    });
    const output = await readArtifactLinear(
      evaluated.artifact.path,
      evaluated.artifact.artifactHash,
    );

    expect([output.w, output.h]).toEqual([2, 2]);
    expect(output.data[(1 * output.w + 1) * 3]).toBeGreaterThan(0.5);
    expect(output.data[0]).toBe(0);
  } finally {
    await db.close();
  }
});

test("changed source pixels at the same locator create a new source evaluation", async () => {
  const { db, library, nodeId } = await sourceGraph();
  try {
    const first = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => sourceEvaluation(),
    });
    const changed = sourceEvaluation();
    changed.image.data = new Float32Array([0.4, 0.5, 0.6]);
    const second = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source: async () => changed,
    });

    expect(second.reused).toBe(false);
    expect(second.evaluationHash).not.toBe(first.evaluationHash);
    expect(second.executionId).not.toBe(first.executionId);
    expect(second.artifact.artifactHash).not.toBe(first.artifact.artifactHash);
  } finally {
    await db.close();
  }
});

test("develop nodes run the native global grade without caller-supplied operations", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const document = await db.query<{ active_revision_id: string }>(
      "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
      [photoId],
    );
    const revision = await commitRevision(db, {
      photoId,
      expectedRevisionId: document.rows[0].active_revision_id,
      nodes: [
        {
          localKey: "develop",
          kind: "develop",
          recipeVersion: 1,
          parameters: { exposure: 1 },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "develop" } }],
    });
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: revision.roots.output!,
      source: async () => ({
        ...sourceEvaluation(),
        image: { ...sourceEvaluation().image, data: new Float32Array([0.1, 0.15, 0.2]) },
      }),
    });
    expect((await readArtifactLinear(evaluated.artifact.path)).data).toEqual(
      new Float32Array([0.2, 0.3, 0.4]),
    );
  } finally {
    await db.close();
  }
});

test("develop exposure acts on preserved scene-linear values above the display ceiling", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const document = await db.query<{ active_revision_id: string }>(
      "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
      [photoId],
    );
    const revision = await commitRevision(db, {
      photoId,
      expectedRevisionId: document.rows[0].active_revision_id,
      nodes: [
        {
          localKey: "develop",
          kind: "develop",
          recipeVersion: 1,
          parameters: { exposure: 1 },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "develop" } }],
    });
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: revision.roots.output!,
      source: async () => ({
        ...sourceEvaluation(),
        image: {
          w: 1,
          h: 1,
          orientationApplied: true,
          space: "scene-linear-rec2020",
          data: new Float32Array([0.75, 1.25, -0.125]),
          whiteLevel: 1,
          blackLevel: 0,
          wbPreApplied: true,
        },
      }),
    });
    expect((await readArtifactLinear(evaluated.artifact.path)).data).toEqual(
      new Float32Array([1.5, 2.5, -0.25]),
    );
  } finally {
    await db.close();
  }
});

test("delta nodes compensate an existing scene-linear branch through the native evaluator", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const document = await db.query<{ active_revision_id: string }>(
      "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
      [photoId],
    );
    const oldRevision = await commitRevision(db, {
      photoId,
      expectedRevisionId: document.rows[0].active_revision_id,
      nodes: [
        {
          localKey: "old-develop",
          kind: "develop",
          recipeVersion: 1,
          parameters: { exposure: 0.25 },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "old-develop" } }],
    });
    const compensatedRevision = await commitRevision(db, {
      photoId,
      expectedRevisionId: oldRevision.revisionId,
      nodes: [
        {
          localKey: "delta",
          kind: "delta",
          recipeVersion: 1,
          parameters: { exposure: 0.5 },
          inputs: [{ nodeId: oldRevision.nodes["old-develop"].id }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "delta" } }],
    });
    const source = async () => ({
      ...sourceEvaluation(),
      image: {
        ...sourceEvaluation().image,
        data: new Float32Array([0.08, 0.2, 0.65]),
      },
    });
    const compensated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: compensatedRevision.nodes.delta.id,
      source,
    });
    const rerenderRevision = await commitRevision(db, {
      photoId,
      expectedRevisionId: compensatedRevision.revisionId,
      nodes: [
        {
          localKey: "rerender",
          kind: "develop",
          recipeVersion: 1,
          parameters: { exposure: 0.75 },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "rerender" } }],
    });
    const rerendered = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: rerenderRevision.nodes.rerender.id,
      source,
    });

    const compensatedPixels = (await readArtifactLinear(compensated.artifact.path)).data;
    const rerenderedPixels = (await readArtifactLinear(rerendered.artifact.path)).data;
    await expectDisplayLsbMatch(compensatedPixels, rerenderedPixels);
  } finally {
    await db.close();
  }
});

test("delta nodes apply bounded white-balance compensation in scene-linear space", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const document = await db.query<{ active_revision_id: string }>(
      "SELECT active_revision_id FROM photo_documents WHERE photo_id = $1",
      [photoId],
    );
    const deltaRevision = await commitRevision(db, {
      photoId,
      expectedRevisionId: document.rows[0].active_revision_id,
      nodes: [
        {
          localKey: "delta",
          kind: "delta",
          recipeVersion: 1,
          parameters: { white_balance: { temp_offset_k: 200 } },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "delta" } }],
    });
    const source = async () => ({
      ...sourceEvaluation(),
      image: {
        ...sourceEvaluation().image,
        data: new Float32Array([0.08, 0.2, 0.65]),
      },
    });
    const compensated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: deltaRevision.nodes.delta.id,
      source,
    });
    const rerenderRevision = await commitRevision(db, {
      photoId,
      expectedRevisionId: deltaRevision.revisionId,
      nodes: [
        {
          localKey: "rerender",
          kind: "develop",
          recipeVersion: 1,
          parameters: { white_balance: { temp_offset_k: 200 } },
          inputs: [{ nodeId: sourceId }],
        },
      ],
      rootUpdates: [{ root: "output", node: { localKey: "rerender" } }],
    });
    const rerendered = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: rerenderRevision.nodes.rerender.id,
      source,
    });
    const compensatedPixels = (await readArtifactLinear(compensated.artifact.path)).data;
    const rerenderedPixels = (await readArtifactLinear(rerendered.artifact.path)).data;
    await expectDisplayLsbMatch(compensatedPixels, rerenderedPixels);
  } finally {
    await db.close();
  }
});

test("a requested execution id belongs only to the top nondeterministic node", async () => {
  const { db, library, nodeId: sourceId } = await sourceGraph();
  try {
    const ancestorId = await insertGeneratedNode(db, sourceId, "ancestor");
    const requestedId = await insertGeneratedNode(db, ancestorId, "requested");
    const executionId = `exec_${"7".repeat(64)}`;
    const evaluated = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId: requestedId,
      executionId,
      source: async () => sourceEvaluation(),
      operations: { generate: async () => providerResult() },
    });

    expect(evaluated.executionId).toBe(executionId);
    const executions = await db.query<{ node_id: string; execution_id: string }>(
      `SELECT node_id, execution_id FROM node_executions
       WHERE photo_id = $1 AND node_id IN ($2, $3) ORDER BY node_id`,
      [photoId, ancestorId, requestedId],
    );
    expect(executions.rows).toHaveLength(2);
    expect(executions.rows.find((row) => row.node_id === requestedId)?.execution_id).toBe(
      executionId,
    );
    expect(executions.rows.find((row) => row.node_id === ancestorId)?.execution_id).not.toBe(
      executionId,
    );
  } finally {
    await db.close();
  }
});

test("reevaluation repairs missing and corrupt canonical artifacts", async () => {
  const { db, library, nodeId } = await sourceGraph();
  try {
    const source = async () => sourceEvaluation();
    const first = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source,
    });
    const expectedBytes = await readFile(first.artifact.path);

    await rm(first.artifact.path);
    const repairedMissing = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source,
    });
    expect(repairedMissing.artifact.artifactHash).toBe(first.artifact.artifactHash);
    expect(await readFile(first.artifact.path)).toEqual(expectedBytes);

    await writeFile(first.artifact.path, "corrupt canonical bytes");
    const repairedCorrupt = await evaluateGraphNode({
      database: db,
      libraryPath: library,
      photoId,
      nodeId,
      source,
    });
    expect(repairedCorrupt.artifact.artifactHash).toBe(first.artifact.artifactHash);
    expect(await readFile(first.artifact.path)).toEqual(expectedBytes);
    expect(
      (
        await db.query<{ artifact_available: boolean }>(
          "SELECT artifact_available FROM image_artifacts WHERE artifact_hash = $1",
          [first.artifact.artifactHash],
        )
      ).rows,
    ).toEqual([{ artifact_available: true }]);
  } finally {
    await db.close();
  }
});

function sourceEvaluation() {
  return {
    image: {
      w: 1,
      h: 1,
      data: new Float32Array([0.1, 0.2, 0.3]),
      space: "scene-linear-rec2020" as const,
      orientationApplied: true as const,
      whiteLevel: 1,
      blackLevel: 0,
      wbPreApplied: true,
    },
    provenance: {
      locator: { kind: "pinned-preview" as const, cache_path: "emb/photo.jpg" },
      tier: "pinned-preview" as const,
      w: 1,
      h: 1,
      decoderId: "sharp",
      decoderVersion: "0.35.4",
    },
  };
}

function linearFixture(w: number, h: number, samples: number[]) {
  return {
    w,
    h,
    data: new Float32Array(samples.flatMap((sample) => [sample, sample, sample])),
    space: "scene-linear-rec2020" as const,
    orientationApplied: true as const,
    whiteLevel: 1 as const,
    blackLevel: 0 as const,
    wbPreApplied: true as const,
  };
}

function sourceEvaluationFor(image: ReturnType<typeof linearFixture>) {
  return {
    image,
    provenance: {
      locator: { kind: "pinned-preview" as const, cache_path: "emb/photo.jpg" },
      tier: "pinned-preview" as const,
      w: image.w,
      h: image.h,
      decoderId: "fixture",
      decoderVersion: "1",
    },
  };
}

async function resampleGraph(
  image: ReturnType<typeof linearFixture>,
  recipeVersion: 1 | 2,
  parameters:
    | { w: number; h: number; kernel: "bilinear" | "lanczos3" }
    | {
        w: number;
        h: number;
        kernel: "lanczos3";
        matrix: [number, number, number, number, number, number];
      },
): Promise<{ db: PGlite; library: string; nodeId: string }> {
  const db = await testDatabase();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_1234567890abcdef', 1, $2, $3, 1)`,
    [photoId, image.w, image.h],
  );
  const revision = await commitRevision(db, {
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
      {
        localKey: "resample",
        kind: "resample",
        recipeVersion,
        parameters,
        inputs: [{ localKey: "source" }],
      },
    ],
    rootUpdates: [{ root: "output", node: { localKey: "resample" } }],
  });
  const library = await mkdtemp(join(tmpdir(), "photoctl-affine-resample-"));
  directories.push(library);
  return { db, library, nodeId: revision.nodes.resample.id };
}

function providerResult() {
  return {
    image: {
      w: 1,
      h: 1,
      channels: 3 as const,
      data: new Uint16Array([1, 2, 3]),
      space: "display-srgb" as const,
      orientationApplied: true as const,
    },
    externalExecution: {
      adapter: "fake-gateway-v1",
      adapterVersion: "1",
      service: "fake-gateway",
      model: "fake-v1",
      modelVersion: null,
      providerRequestId: "req_fixture",
      seed: null,
      durationMs: 0,
      costUsd: 0,
      inputPx: 1,
      targetPx: 1,
      attempt: 1,
      densityVerdict: "not-applicable" as const,
      warnings: [],
    },
  };
}

async function sourceGraph(): Promise<{ db: PGlite; library: string; nodeId: string }> {
  const db = await testDatabase();
  await migrate(db);
  await db.query(
    `INSERT INTO photos (id, content_key, size, w, h, orientation)
     VALUES ($1, 'ck_1234567890abcdef', 1, 1, 1, 1)`,
    [photoId],
  );
  const revision = await commitRevision(db, {
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
  const library = await mkdtemp(join(tmpdir(), "photoctl-evaluator-"));
  directories.push(library);
  return { db, library, nodeId: revision.nodes.source.id };
}

async function insertGeneratedNode(db: PGlite, sourceId: string, prompt = ""): Promise<string> {
  const parameters = {
    adapter: "fake-gateway-v1",
    adapter_version: "1",
    model: "fake-v1",
    model_version: null,
    prompt,
    prompt_version: 1,
    request: {},
  };
  const recipe = recipeHash(
    canonicalNodeRecipe({
      kind: "generate",
      recipeVersion: 1,
      parameters,
      inputNodeIds: [sourceId],
    }),
  );
  const nodeId = logicalNodeId(recipe);
  await db.query(
    `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
     VALUES ($1, $2, 'generate', 1, $3::jsonb, $4)`,
    [photoId, nodeId, JSON.stringify(parameters), recipe],
  );
  await db.query(
    `INSERT INTO image_node_inputs (photo_id, node_id, input_index, input_node_id)
     VALUES ($1, $2, 0, $3)`,
    [photoId, nodeId, sourceId],
  );
  return nodeId;
}

async function artifactFiles(library: string): Promise<string[]> {
  try {
    const prefixes = await readdir(join(library, "artifacts", "sha256"));
    return (
      await Promise.all(
        prefixes.map(async (prefix) =>
          (await readdir(join(library, "artifacts", "sha256", prefix))).map((name) =>
            join(library, "artifacts", "sha256", prefix, name),
          ),
        ),
      )
    ).flat();
  } catch {
    return [];
  }
}

async function expectDisplayLsbMatch(
  actualLinear: Float32Array,
  expectedLinear: Float32Array,
): Promise<void> {
  const actual = await linearRec2020ToDisplaySrgb(actualLinear);
  const expected = await linearRec2020ToDisplaySrgb(expectedLinear);
  expect(actual.length).toBe(expected.length);
  for (const [index, sample] of actual.entries()) {
    expect(
      Math.abs(Math.round(sample * 65_535) - Math.round(expected[index] * 65_535)),
    ).toBeLessThanOrEqual(1);
  }
}
