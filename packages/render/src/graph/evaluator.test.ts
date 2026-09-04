import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import { findOrphanArtifacts, retainedArtifacts } from "../artifacts/availability.js";
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
  const db = await PGlite.create();
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
