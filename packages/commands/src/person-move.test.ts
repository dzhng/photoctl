/* eslint-disable no-await-in-loop -- Command order is the public journey under test. */
import { fillStrictDataSchema } from "@photoctl/protocol";
import {
  evaluateGraphNode,
  loadActiveDocument,
  readArtifactLinear,
  readArtifactMask,
} from "@photoctl/render";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fillUpscaleFixture, fixtureCommand, success } from "./fill-upscale-fixture.js";

test("person move keeps one vacancy until strict fill and carries both photographic layers through develop", async () => {
  const fixture = await fillUpscaleFixture({ generationUpscale: "off" });
  try {
    const segmented = success(
      await fixtureCommand(fixture, "segment", [fixture.id, "--box", "0,0,10,30"]),
    ) as { layer_id: string };
    const beforeMove = await loadActiveDocument(fixture.handle, fixture.id);
    if (!beforeMove) throw new Error("Expected active document");
    const originalMask = beforeMove.layers.find(({ id }) => id === segmented.layer_id)?.maskNodeId;

    const moved = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--move",
        segmented.layer_id,
        "--by",
        "10,0",
      ]),
    ) as { vacancy_layer_id: string; matrix: number[] };
    expect(moved.matrix).toEqual([1, 0, 0, 1, 10, 0]);
    expect(fixture.generationCalls()).toBe(0);
    expect(fixture.upscaleCalls()).toBe(0);

    const afterMove = await loadActiveDocument(fixture.handle, fixture.id);
    if (!afterMove) throw new Error("Expected moved document");
    expect(afterMove.layers).toMatchObject([
      {
        id: moved.vacancy_layer_id,
        role: "vacancy",
        ofLayer: segmented.layer_id,
        z: 0,
        maskNodeId: originalMask,
      },
      { id: segmented.layer_id, role: "subject", z: 1 },
    ]);
    const originalVacancy = afterMove.layers[0]!;
    expect(await fixtureCommand(fixture, "show", [fixture.id])).toMatchObject({
      ok: true,
      warnings: [{ code: "vacancy_unfilled", id: fixture.id }],
    });

    const delivery = join(fixture.parent, "before-fill");
    await mkdir(delivery);
    expect(await fixtureCommand(fixture, "export", [fixture.id, "--to", delivery])).toMatchObject({
      ok: true,
      warnings: [{ code: "vacancy_unfilled", id: fixture.id }],
    });

    const filledVacancy = fillStrictDataSchema.parse(
      success(
        await fixtureCommand(fixture, "fill", [
          fixture.id,
          "--layer",
          moved.vacancy_layer_id,
          "--remove",
          "--pad",
          "0",
          "--no-upscale",
        ]),
      ),
    );
    expect(fixture.generationCalls()).toBe(1);
    const afterVacancyFill = await loadActiveDocument(fixture.handle, fixture.id);
    if (!afterVacancyFill) throw new Error("Expected filled document");
    expect(afterVacancyFill.layers[0]).toMatchObject({
      id: originalVacancy.id,
      role: "vacancy",
      ofLayer: originalVacancy.ofLayer,
      z: originalVacancy.z,
      maskNodeId: originalVacancy.maskNodeId,
    });
    expect(afterVacancyFill.layers[0]!.contentNodeId).not.toBe(originalVacancy.contentNodeId);

    const graph = success(await fixtureCommand(fixture, "graph", ["show", fixture.id])) as {
      nodes: Array<{ id: string; kind: string; input_node_ids: string[] }>;
    };
    const generation = graph.nodes.find(({ id }) => id === filledVacancy.generation.node);
    const composite = graph.nodes.find(({ id }) => id === filledVacancy.composite.node);
    expect(generation?.input_node_ids).toEqual([beforeMove.roots.base]);
    expect(composite?.input_node_ids[0]).toBe(beforeMove.roots.base);
    expect(composite?.input_node_ids[0]).not.toBe(originalVacancy.contentNodeId);
    expect(composite?.input_node_ids[2]).toBe(originalVacancy.maskNodeId);
    await expectUnmaskedPixelsExact(fixture, filledVacancy.composite.node);
    expect(await fixtureCommand(fixture, "show", [fixture.id])).toMatchObject({
      ok: true,
      warnings: [],
    });

    success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--layer",
        segmented.layer_id,
        "--prompt",
        "Place a person naturally at the moved position",
        "--no-upscale",
      ]),
    );
    expect(fixture.generationCalls()).toBe(2);
    const subject = success(
      await fixtureCommand(fixture, "layer", ["show", fixture.id, segmented.layer_id]),
    ) as { chain: { content: Array<{ kind: string; parameters: unknown }> } };
    expect(subject.chain.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "transform", parameters: { matrix: moved.matrix } }),
      ]),
    );

    expect(
      await fixtureCommand(fixture, "develop", [fixture.id, "--set", "exposure=0.5"]),
    ).toMatchObject({
      ok: true,
      results: [
        {
          layers: {
            delta_applied: [moved.vacancy_layer_id, segmented.layer_id],
            stale: [],
          },
        },
      ],
    });
    expect(
      await fixtureCommand(fixture, "develop", [fixture.id, "--set", "shadows=40"]),
    ).toMatchObject({
      ok: true,
      results: [
        {
          layers: {
            delta_applied: [],
            stale: [moved.vacancy_layer_id, segmented.layer_id],
          },
        },
      ],
    });

    const staleDocument = await loadActiveDocument(fixture.handle, fixture.id);
    if (!staleDocument) throw new Error("Expected stale document");
    const finalDelivery = join(fixture.parent, "after-fill");
    const exported = await fixtureCommand(fixture, "export", [fixture.id, "--to", finalDelivery]);
    expect(exported).toMatchObject({
      ok: true,
      results: [{ render_hash: staleDocument.renderHash }],
      warnings: [{ code: "layers_stale", id: fixture.id }],
    });

    const repeated = success(
      await fixtureCommand(fixture, "fill", [
        fixture.id,
        "--move",
        segmented.layer_id,
        "--by",
        "1,0",
      ]),
    ) as { vacancy_layer_id: string };
    expect(repeated.vacancy_layer_id).toBe(moved.vacancy_layer_id);
    expect(fixture.generationCalls()).toBe(2);
    expect(fixture.upscaleCalls()).toBe(0);
    const reset = await loadActiveDocument(fixture.handle, fixture.id);
    if (!reset) throw new Error("Expected reset vacancy document");
    expect(reset.layers[0]).toMatchObject({
      id: originalVacancy.id,
      role: "vacancy",
      ofLayer: originalVacancy.ofLayer,
      z: originalVacancy.z,
      maskNodeId: originalVacancy.maskNodeId,
    });
    expect(reset.layers[0]!.contentNodeId).toBe(originalVacancy.contentNodeId);
    expect(await fixtureCommand(fixture, "show", [fixture.id])).toMatchObject({
      ok: true,
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: "vacancy_unfilled", id: fixture.id }),
      ]),
    });
  } finally {
    await fixture.close();
  }
}, 15_000);

async function expectUnmaskedPixelsExact(
  fixture: Awaited<ReturnType<typeof fillUpscaleFixture>>,
  compositeNodeId: string,
) {
  const node = await fixture.handle.query<{ input_node_id: string; input_index: number }>(
    `SELECT input_node_id, input_index FROM image_node_inputs
     WHERE photo_id = $1 AND node_id = $2 ORDER BY input_index`,
    [fixture.id, compositeNodeId],
  );
  const baseId = node.rows[0]!.input_node_id;
  const maskId = node.rows[2]!.input_node_id;
  const [resultEvaluation, baseEvaluation, maskEvaluation] = await Promise.all(
    [compositeNodeId, baseId, maskId].map(
      async (nodeId) =>
        await evaluateGraphNode({
          database: fixture.handle,
          libraryPath: fixture.handle.path,
          photoId: fixture.id,
          nodeId,
          source: fixture.sourceProducer,
        }),
    ),
  );
  const [result, base, mask] = await Promise.all([
    readArtifactLinear(resultEvaluation.artifact.path, resultEvaluation.artifact.artifactHash),
    readArtifactLinear(baseEvaluation.artifact.path, baseEvaluation.artifact.artifactHash),
    readArtifactMask(maskEvaluation.artifact.path, maskEvaluation.artifact.artifactHash),
  ]);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    if (mask.data[pixel] === 0) {
      expect(result.data.slice(pixel * 3, pixel * 3 + 3)).toEqual(
        base.data.slice(pixel * 3, pixel * 3 + 3),
      );
    }
  }
}
