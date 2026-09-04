import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { migrate } from "../../../library/src/migrations/runner.js";
import type { ProviderEvent } from "@photoctl/protocol";
import { evaluateGraphNode } from "./evaluator.js";
import { inspectGraphNode } from "./inspection.js";
import { canonicalNodeRecipe, logicalNodeId, recipeHash } from "./recipes.js";
import { commitRevision } from "./store.js";

const photoId = "0199a7c2-3b1e-7c40-8f2a-1d0e5a91c031";

test("generate and upscale attempts emit distinct events and retain bounded redacted provenance", async () => {
  const db = await PGlite.create();
  const libraryPath = await mkdtemp(join(tmpdir(), "photoctl-provider-events-"));
  try {
    await migrate(db);
    await db.query(
      `INSERT INTO photos (id, content_key, size, w, h, orientation)
       VALUES ($1, 'ck_34567890abcdef12', 3, 1, 1, 1)`,
      [photoId],
    );
    const sourceRevision = await commitRevision(db, {
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
    const generatedId = await insertNode(db, "generate", sourceRevision.roots.output!);
    const upscaledId = await insertNode(db, "upscale", generatedId);
    const events: ProviderEvent[] = [];

    await evaluateGraphNode({
      database: db,
      libraryPath,
      photoId,
      nodeId: upscaledId,
      source: async () => sourceEvaluation(),
      emit: (event) => events.push(event),
      operations: {
        generate: async () => externalResult("gateway-image-v1", "vercel", "openai/gpt-image-2", 1),
        upscale: async () =>
          externalResult("fake-upscale-v1", "fake", "photoctl/fake-upscale-v1", 2),
      },
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.node_kind)).toEqual(["generate", "upscale"]);
    expect(events[0]!.execution_id).not.toBe(events[1]!.execution_id);
    expect(events[1]).toMatchObject({
      event: "provider",
      adapter: "fake-upscale-v1",
      service: "fake",
      model: "photoctl/fake-upscale-v1",
      input_px: 1,
      target_px: 4,
      attempt: 2,
    });

    const node = await inspectGraphNode(db, { photoId, nodeId: upscaledId });
    expect(node.executions[0]!.providerProvenance).toMatchObject({
      parameters: {
        adapter: "fake-upscale-v1",
        adapter_version: null,
        model: "photoctl/fake-upscale-v1",
        model_version: null,
        scale: 2,
        controls: {},
      },
      input_node_ids: [generatedId],
      input_artifact_hashes: [expect.stringMatching(/^a_[0-9a-f]{64}$/)],
      recipe_version: 1,
      adapter: "fake-upscale-v1",
      adapter_version: null,
      model_version: null,
      provider_request_id: "req_fixture",
      output: {
        dimensions: { w: 1, h: 1 },
        artifact_hash: expect.stringMatching(/^a_[0-9a-f]{64}$/),
        available: true,
      },
      density_verdict: "limited",
      warnings: [{ code: "upscale_resolution_limited", message: "fixture limit" }],
    });
    expect(Buffer.byteLength(JSON.stringify(node))).toBeLessThan(1024 * 1024);
    expect(JSON.stringify(node)).not.toMatch(/secret|authorization|signed_url|raw_body/);
  } finally {
    await db.close();
    await rm(libraryPath, { recursive: true });
  }
});

function externalResult(adapter: string, service: string, model: string, attempt: number) {
  return {
    image: sourceEvaluation().image,
    externalExecution: {
      adapter,
      adapterVersion: null,
      service,
      model,
      modelVersion: null,
      providerRequestId: "req_fixture",
      seed: 7,
      durationMs: 12,
      costUsd: 0,
      inputPx: 1,
      targetPx: 4,
      attempt,
      densityVerdict: "limited" as const,
      warnings: [{ code: "upscale_resolution_limited" as const, message: "fixture limit" }],
      authorization: "Bearer secret",
      signedUrl: "https://signed.example/secret",
      rawBody: "secret debug body",
    },
  };
}

function sourceEvaluation() {
  return {
    image: {
      w: 1,
      h: 1,
      channels: 3 as const,
      data: new Uint16Array([1, 2, 3]),
      space: "display-srgb" as const,
      orientationApplied: true as const,
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

async function insertNode(db: PGlite, kind: "generate" | "upscale", inputId: string) {
  const parameters =
    kind === "generate"
      ? {
          adapter: "gateway-image-v1",
          adapter_version: null,
          model: "openai/gpt-image-2",
          model_version: null,
          prompt: "",
          prompt_version: 1,
          request: {},
        }
      : {
          adapter: "fake-upscale-v1",
          adapter_version: null,
          model: "photoctl/fake-upscale-v1",
          model_version: null,
          scale: 2,
          controls: {},
        };
  const recipe = recipeHash(
    canonicalNodeRecipe({ kind, recipeVersion: 1, parameters, inputNodeIds: [inputId] }),
  );
  const nodeId = logicalNodeId(recipe);
  await db.query(
    `INSERT INTO image_nodes (photo_id, id, kind, recipe_version, parameters, recipe_hash)
     VALUES ($1, $2, $3, 1, $4::jsonb, $5)`,
    [photoId, nodeId, kind, JSON.stringify(parameters), recipe],
  );
  await db.query(
    `INSERT INTO image_node_inputs (photo_id, node_id, input_index, input_node_id)
     VALUES ($1, $2, 0, $3)`,
    [photoId, nodeId, inputId],
  );
  return nodeId;
}
